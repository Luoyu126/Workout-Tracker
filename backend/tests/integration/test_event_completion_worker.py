from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.common.database import Base
from app.common.enums import (
    CoinRuleTrigger,
    CoinTransactionType,
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
    NotificationType,
    SignupStatus,
)
from app.config import Settings
from app.events.worker import run_event_completion_sweep
from app.models import (
    CoinRule,
    CoinTransaction,
    Event,
    EventSignup,
    MatchDetails,
    Notification,
    Organization,
    Team,
    TeamMembership,
    User,
)


@pytest.fixture()
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    yield factory
    Base.metadata.drop_all(engine)
    engine.dispose()


def _seed_team(session: Session, cutoff: datetime) -> tuple[Team, User, User]:
    organization = Organization(name="Worker Org", slug=f"worker-{uuid4().hex[:8]}")
    admin = User(auth_id=uuid4(), name="Worker Admin", email=f"admin-{uuid4()}@example.test")
    member = User(auth_id=uuid4(), name="Worker Member", email=f"member-{uuid4()}@example.test")
    session.add_all([organization, admin, member])
    session.flush()
    team = Team(organization_id=organization.id, name="Worker Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=admin.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
                joined_at=cutoff - timedelta(days=30),
            ),
            TeamMembership(
                team_id=team.id,
                user_id=member.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
                joined_at=cutoff - timedelta(days=30),
            ),
        ]
    )
    session.commit()
    return team, admin, member


def _settings(*, batch_size: int = 100, poll_seconds: float = 60) -> Settings:
    return Settings(
        EVENT_COMPLETION_WORKER_ENABLED=True,
        EVENT_COMPLETION_BATCH_SIZE=batch_size,
        EVENT_COMPLETION_POLL_SECONDS=poll_seconds,
    )


def test_sweep_completes_due_event_types_and_is_idempotent(
    session_factory: sessionmaker[Session],
) -> None:
    cutoff = datetime(2026, 9, 2, 18, 0, tzinfo=UTC)
    with session_factory() as session:
        team, admin, member = _seed_team(session, cutoff)
        session.add_all(
            [
                CoinRule(
                    team_id=team.id,
                    name="训练报名",
                    trigger_type=CoinRuleTrigger.training_signup,
                    amount=10,
                    created_by=admin.id,
                ),
                CoinRule(
                    team_id=team.id,
                    name="比赛报名",
                    trigger_type=CoinRuleTrigger.match_signup,
                    amount=20,
                    created_by=admin.id,
                ),
            ]
        )
        session.flush()
        training = Event(
            team_id=team.id,
            type=EventType.training,
            title="到期训练",
            start_time=cutoff - timedelta(hours=3),
            end_time=cutoff - timedelta(hours=2),
            status=EventStatus.published,
            created_by=admin.id,
        )
        match = Event(
            team_id=team.id,
            type=EventType.match,
            title="到期比赛",
            start_time=cutoff - timedelta(hours=2),
            end_time=cutoff - timedelta(hours=1),
            status=EventStatus.published,
            created_by=admin.id,
        )
        other = Event(
            team_id=team.id,
            type=EventType.other,
            title="到期其他活动",
            start_time=cutoff - timedelta(hours=1),
            end_time=cutoff,
            status=EventStatus.published,
            created_by=admin.id,
        )
        future = Event(
            team_id=team.id,
            type=EventType.training,
            title="未到期训练",
            start_time=cutoff + timedelta(hours=1),
            end_time=cutoff + timedelta(hours=2),
            status=EventStatus.published,
            created_by=admin.id,
        )
        session.add_all([training, match, other, future])
        session.flush()
        session.add(MatchDetails(event_id=match.id, opponent="Worker United"))
        session.add_all(
            [
                EventSignup(event_id=training.id, user_id=member.id, status=SignupStatus.going),
                EventSignup(event_id=match.id, user_id=member.id, status=SignupStatus.going),
            ]
        )
        session.commit()
        due_ids = {training.id, match.id, other.id}
        future_id = future.id
        match_id = match.id
        member_id = member.id

    first = run_event_completion_sweep(
        _settings(),
        due_at=cutoff,
        session_factory=session_factory,
    )
    second = run_event_completion_sweep(
        _settings(),
        due_at=cutoff,
        session_factory=session_factory,
    )

    assert first.candidates == 3
    assert first.completed == 3
    assert first.failed == 0
    assert second.candidates == 0
    with session_factory() as session:
        assert {
            event.id
            for event in session.scalars(select(Event).where(Event.status == EventStatus.completed))
        } == due_ids
        assert session.get(Event, future_id).status == EventStatus.published
        rewards = list(
            session.scalars(
                select(CoinTransaction)
                .where(CoinTransaction.type == CoinTransactionType.signup_reward)
                .order_by(CoinTransaction.amount)
            )
        )
        assert [reward.amount for reward in rewards] == [10, 20]
        assert {reward.user_id for reward in rewards} == {member_id}
        assert {reward.created_by for reward in rewards} == {None}
        notifications = list(
            session.scalars(
                select(Notification).where(Notification.type == NotificationType.coin_earned)
            )
        )
        assert len(notifications) == 2
        match_details = session.scalar(select(MatchDetails).where(MatchDetails.event_id == match_id))
        assert match_details is not None
        assert match_details.team_score is None
        assert match_details.opponent_score is None
        assert match_details.result is None


def test_missing_rule_rolls_back_that_event_without_blocking_later_candidates(
    session_factory: sessionmaker[Session],
) -> None:
    cutoff = datetime(2026, 9, 2, 18, 0, tzinfo=UTC)
    with session_factory() as session:
        team, admin, member = _seed_team(session, cutoff)
        training = Event(
            team_id=team.id,
            type=EventType.training,
            title="等待规则的训练",
            start_time=cutoff - timedelta(hours=3),
            end_time=cutoff - timedelta(hours=2),
            status=EventStatus.published,
            created_by=admin.id,
        )
        other = Event(
            team_id=team.id,
            type=EventType.other,
            title="可独立完成的活动",
            start_time=cutoff - timedelta(hours=2),
            end_time=cutoff - timedelta(hours=1),
            status=EventStatus.published,
            created_by=admin.id,
        )
        session.add_all([training, other])
        session.flush()
        session.add(EventSignup(event_id=training.id, user_id=member.id, status=SignupStatus.going))
        session.commit()
        training_id = training.id
        other_id = other.id
        team_id = team.id
        admin_id = admin.id

    first = run_event_completion_sweep(
        _settings(),
        due_at=cutoff,
        session_factory=session_factory,
    )
    assert first.completed == 1
    assert first.failed == 1
    with session_factory() as session:
        assert session.get(Event, training_id).status == EventStatus.published
        assert session.get(Event, other_id).status == EventStatus.completed
        assert list(session.scalars(select(CoinTransaction))) == []
        session.add(
            CoinRule(
                team_id=team_id,
                name="恢复训练奖励",
                trigger_type=CoinRuleTrigger.training_signup,
                amount=12,
                created_by=admin_id,
            )
        )
        session.commit()

    retry = run_event_completion_sweep(
        _settings(),
        due_at=cutoff,
        session_factory=session_factory,
    )
    assert retry.completed == 1
    assert retry.failed == 0
    with session_factory() as session:
        assert session.get(Event, training_id).status == EventStatus.completed
        reward = session.scalar(select(CoinTransaction))
        assert reward is not None
        assert reward.amount == 12
        assert reward.created_by is None


def test_zero_amount_active_rule_still_allows_completion(
    session_factory: sessionmaker[Session],
) -> None:
    cutoff = datetime(2026, 9, 2, 18, 0, tzinfo=UTC)
    with session_factory() as session:
        team, admin, member = _seed_team(session, cutoff)
        session.add(
            CoinRule(
                team_id=team.id,
                name="零金币训练规则",
                trigger_type=CoinRuleTrigger.training_signup,
                amount=0,
                created_by=admin.id,
            )
        )
        event = Event(
            team_id=team.id,
            type=EventType.training,
            title="零金币训练",
            start_time=cutoff - timedelta(hours=2),
            end_time=cutoff - timedelta(hours=1),
            status=EventStatus.published,
            created_by=admin.id,
        )
        session.add(event)
        session.flush()
        session.add(EventSignup(event_id=event.id, user_id=member.id, status=SignupStatus.going))
        session.commit()
        event_id = event.id

    result = run_event_completion_sweep(
        _settings(),
        due_at=cutoff,
        session_factory=session_factory,
    )

    assert result.completed == 1
    assert result.failed == 0
    with session_factory() as session:
        assert session.get(Event, event_id).status == EventStatus.completed
        assert list(session.scalars(select(CoinTransaction))) == []
        assert list(session.scalars(select(Notification))) == []
