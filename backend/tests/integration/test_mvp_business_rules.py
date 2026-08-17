from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.coins.service import coin_balance
from app.common.database import Base
from app.common.enums import (
    CoinRuleTrigger,
    CoinTransactionType,
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
    SignupStatus,
)
from app.common.permissions import PermissionDeniedError
from app.events.service import complete_event
from app.models import (
    CoinRule,
    CoinTransaction,
    Event,
    EventSignup,
    Organization,
    StoreItem,
    Team,
    TeamMembership,
    User,
)
from app.store.schemas import RedemptionCreateRequest
from app.store.service import create_redemption, fulfill_redemption, refund_redemption
from app.teams.service import signup_board


@pytest.fixture()
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with SessionLocal() as db:
        yield db
    Base.metadata.drop_all(engine)
    engine.dispose()


def _user(name: str) -> User:
    normalized = name.lower().replace(" ", ".")
    return User(auth_id=uuid4(), name=name, email=f"{normalized}@example.com")


def _seed_team(session: Session) -> tuple[Team, User, User, User]:
    organization = Organization(name="Test Org", slug=f"test-org-{uuid4().hex[:8]}")
    captain = _user("Captain")
    player = _user("Player")
    missing_player = _user("Missing Player")
    session.add_all([organization, captain, player, missing_player])
    session.flush()

    team = Team(organization_id=organization.id, name="MVP Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=captain.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=missing_player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
        ]
    )
    session.commit()
    return team, captain, player, missing_player


def _add_signup_rules(session: Session, team: Team, captain: User) -> None:
    session.add_all(
        [
            CoinRule(
                team_id=team.id,
                name="训练报名",
                trigger_type=CoinRuleTrigger.training_signup,
                amount=10,
                created_by=captain.id,
            ),
            CoinRule(
                team_id=team.id,
                name="比赛报名",
                trigger_type=CoinRuleTrigger.match_signup,
                amount=20,
                created_by=captain.id,
            ),
        ]
    )
    session.commit()


def _add_signup(
    session: Session,
    event: Event,
    user: User,
    status: SignupStatus,
    note: str | None = None,
) -> EventSignup:
    signup = EventSignup(event_id=event.id, user_id=user.id, status=status, note=note)
    session.add(signup)
    session.commit()
    return signup


def test_completion_rewards_going_signups_and_treats_missing_as_maybe(
    session: Session,
) -> None:
    team, captain, player, missing_player = _seed_team(session)
    _add_signup_rules(session, team, captain)
    event = Event(
        team_id=team.id,
        type=EventType.training,
        title="周三训练",
        start_time=datetime.now(UTC) + timedelta(days=1),
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add(event)
    session.commit()

    _add_signup(session, event, player, SignupStatus.going)
    result = complete_event(session, event.id, captain)

    assert result["status"] == EventStatus.completed
    assert result["going_count"] == 1
    assert result["reward_count"] == 1

    assert (
        session.scalars(
            select(EventSignup).where(EventSignup.event_id == event.id, EventSignup.user_id == missing_player.id)
        ).all()
        == []
    )
    assert coin_balance(session, team.id, captain, player.id) == 10
    assert coin_balance(session, team.id, captain, missing_player.id) == 0
    assert coin_balance(session, team.id, captain, captain.id) == 0


def test_signup_reward_uses_configured_coin_rule_amount(session: Session) -> None:
    team, captain, player, _ = _seed_team(session)
    _add_signup_rules(session, team, captain)
    training_rule = session.scalar(
        select(CoinRule).where(
            CoinRule.team_id == team.id,
            CoinRule.trigger_type == CoinRuleTrigger.training_signup,
        )
    )
    assert training_rule is not None
    training_rule.amount = 17
    event = Event(
        team_id=team.id,
        type=EventType.training,
        title="自定义金币训练",
        start_time=datetime.now(UTC) + timedelta(days=1),
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add(event)
    session.commit()

    _add_signup(session, event, player, SignupStatus.going)
    complete_event(session, event.id, captain)

    reward = session.scalar(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.signup_reward,
            CoinTransaction.reference_type == "event",
            CoinTransaction.reference_id == event.id,
        )
    )
    assert reward is not None
    assert reward.amount == 17
    assert coin_balance(session, team.id, captain, player.id) == 17


def test_match_going_uses_match_signup_rule_instead_of_training_rule(session: Session) -> None:
    team, captain, player, _ = _seed_team(session)
    _add_signup_rules(session, team, captain)
    training_event = Event(
        team_id=team.id,
        type=EventType.training,
        title="训练报名奖励",
        start_time=datetime.now(UTC) + timedelta(days=1),
        status=EventStatus.published,
        created_by=captain.id,
    )
    match_event = Event(
        team_id=team.id,
        type=EventType.match,
        title="比赛报名奖励",
        start_time=datetime.now(UTC) + timedelta(days=2),
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add_all([training_event, match_event])
    session.commit()

    _add_signup(session, training_event, player, SignupStatus.going)
    _add_signup(session, match_event, player, SignupStatus.going)
    complete_event(session, training_event.id, captain)
    complete_event(session, match_event.id, captain)

    rewards = session.scalars(
        select(CoinTransaction)
        .where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.signup_reward,
            CoinTransaction.reference_type == "event",
        )
        .order_by(CoinTransaction.amount)
    ).all()

    assert [reward.amount for reward in rewards] == [10, 20]
    assert {reward.reference_id for reward in rewards} == {training_event.id, match_event.id}
    assert {reward.metadata_["status"] for reward in rewards} == {"going"}
    assert coin_balance(session, team.id, captain, player.id) == 30


def test_maybe_and_not_going_do_not_receive_signup_rewards(session: Session) -> None:
    team, captain, player, missing_player = _seed_team(session)
    _add_signup_rules(session, team, captain)
    event = Event(
        team_id=team.id,
        type=EventType.training,
        title="非 going 不发币",
        start_time=datetime.now(UTC) + timedelta(days=1),
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add(event)
    session.commit()

    _add_signup(session, event, player, SignupStatus.maybe)
    _add_signup(session, event, missing_player, SignupStatus.not_going, note="有课")
    result = complete_event(session, event.id, captain)

    assert result["going_count"] == 0
    assert result["reward_count"] == 0
    assert (
        session.scalars(
            select(CoinTransaction).where(
                CoinTransaction.team_id == team.id,
                CoinTransaction.type == CoinTransactionType.signup_reward,
            )
        ).all()
        == []
    )


def test_repeating_completed_event_settlement_is_idempotent(session: Session) -> None:
    team, captain, player, _ = _seed_team(session)
    _add_signup_rules(session, team, captain)
    event = Event(
        team_id=team.id,
        type=EventType.training,
        title="重复完成不重复发币",
        start_time=datetime.now(UTC) + timedelta(days=1),
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add(event)
    session.commit()

    _add_signup(session, event, player, SignupStatus.going)
    first_result = complete_event(session, event.id, captain)
    second_result = complete_event(session, event.id, captain)

    assert first_result["reward_count"] == 1
    assert first_result["going_count"] == 1
    assert second_result["status"] == EventStatus.completed
    assert second_result["going_count"] == first_result["going_count"]
    assert second_result["reward_count"] == 0
    rewards = session.scalars(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.signup_reward,
            CoinTransaction.reference_type == "event",
            CoinTransaction.reference_id == event.id,
        )
    ).all()
    assert [reward.amount for reward in rewards] == [10]
    assert coin_balance(session, team.id, captain, player.id) == 10


def test_completion_rewards_only_members_eligible_at_event_start(
    session: Session,
) -> None:
    team, captain, _, _ = _seed_team(session)
    _add_signup_rules(session, team, captain)
    event_start = datetime.now(UTC) + timedelta(days=2)
    former_player = _user("Former Player")
    late_joiner = _user("Late Joiner")
    old_inactive_player = _user("Old Inactive Player")
    event = Event(
        team_id=team.id,
        type=EventType.training,
        title="按历史成员资格结算报名",
        start_time=event_start,
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add_all([former_player, late_joiner, old_inactive_player, event])
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=former_player.id,
                role=MembershipRole.member,
                status=MembershipStatus.inactive,
                joined_at=event_start - timedelta(days=30),
                left_at=event_start + timedelta(hours=1),
            ),
            TeamMembership(
                team_id=team.id,
                user_id=late_joiner.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
                joined_at=event_start + timedelta(hours=1),
            ),
            TeamMembership(
                team_id=team.id,
                user_id=old_inactive_player.id,
                role=MembershipRole.member,
                status=MembershipStatus.inactive,
                joined_at=event_start - timedelta(days=30),
                left_at=event_start - timedelta(days=1),
            ),
            EventSignup(
                event_id=event.id,
                user_id=former_player.id,
                status=SignupStatus.going,
            ),
            EventSignup(
                event_id=event.id,
                user_id=late_joiner.id,
                status=SignupStatus.going,
            ),
            EventSignup(
                event_id=event.id,
                user_id=old_inactive_player.id,
                status=SignupStatus.going,
            ),
        ]
    )
    session.commit()

    result = complete_event(session, event.id, captain)

    assert result["status"] == EventStatus.completed
    # Seeded team has captain + 2 active members + former_player eligible; only former_player is going.
    assert result["going_count"] == 1
    assert result["reward_count"] == 1
    assert coin_balance(session, team.id, captain, former_player.id) == 10
    assert coin_balance(session, team.id, captain, late_joiner.id) == 0
    assert coin_balance(session, team.id, captain, old_inactive_player.id) == 0


def test_signup_board_returns_rates_and_date_filters(session: Session) -> None:
    team, captain, player, missing_player = _seed_team(session)
    now = datetime.now(UTC)
    for membership in session.scalars(select(TeamMembership).where(TeamMembership.team_id == team.id)):
        membership.joined_at = now - timedelta(days=30)
    old_event = Event(
        team_id=team.id,
        type=EventType.training,
        title="旧训练",
        start_time=now - timedelta(days=10),
        status=EventStatus.completed,
        created_by=captain.id,
    )
    recent_event = Event(
        team_id=team.id,
        type=EventType.training,
        title="近期训练",
        start_time=now - timedelta(days=1),
        status=EventStatus.completed,
        created_by=captain.id,
    )
    session.add_all([old_event, recent_event])
    session.flush()
    session.add_all(
        [
            EventSignup(
                event_id=old_event.id,
                user_id=player.id,
                status=SignupStatus.not_going,
                note="请假",
            ),
            EventSignup(
                event_id=recent_event.id,
                user_id=player.id,
                status=SignupStatus.going,
            ),
            EventSignup(
                event_id=recent_event.id,
                user_id=missing_player.id,
                status=SignupStatus.maybe,
            ),
        ]
    )
    session.commit()

    all_rows = signup_board(session, team.id, captain)
    player_row = next(row for row in all_rows if row["user_id"] == player.id)
    assert player_row["user"]["name"] == player.name
    assert player_row["user"]["email"] == player.email
    assert player_row["going"] == 1
    assert player_row["not_going"] == 1
    assert player_row["total"] == 2
    assert player_row["going_rate"] == 0.5

    recent_rows = signup_board(session, team.id, captain, starts_after=now - timedelta(days=2))
    recent_player_row = next(row for row in recent_rows if row["user_id"] == player.id)
    assert recent_player_row["going"] == 1
    assert recent_player_row["not_going"] == 0
    assert recent_player_row["going_rate"] == 1.0


def test_signup_board_requires_current_team_membership(session: Session) -> None:
    team, captain, player, _missing_player = _seed_team(session)
    other_org = Organization(name="Other Signup Org", slug=f"other-signup-{uuid4().hex[:8]}")
    session.add(other_org)
    session.flush()
    other_team = Team(organization_id=other_org.id, name="Other Signup Team")
    session.add(other_team)
    session.flush()
    session.add(
        TeamMembership(
            team_id=other_team.id,
            user_id=captain.id,
            role=MembershipRole.admin,
            status=MembershipStatus.active,
        )
    )
    session.commit()

    with pytest.raises(PermissionDeniedError):
        signup_board(session, other_team.id, player)

    assert signup_board(session, team.id, captain) == []


def test_refunding_fulfilled_redemption_restores_stock_and_coin_balance(session: Session) -> None:
    team, captain, player, _ = _seed_team(session)
    session.add(
        CoinTransaction(
            team_id=team.id,
            user_id=player.id,
            amount=50,
            type=CoinTransactionType.admin_adjustment,
            reason="Seed balance",
            created_by=captain.id,
        )
    )
    item = StoreItem(
        team_id=team.id,
        name="队袜",
        price=15,
        stock=2,
        is_active=True,
        created_by=captain.id,
    )
    session.add(item)
    session.commit()

    redemption = create_redemption(
        session,
        team.id,
        player,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
    )
    assert coin_balance(session, team.id, captain, player.id) == 35
    assert session.get(StoreItem, item.id).stock == 1

    fulfill_redemption(session, redemption.id, captain)
    refunded = refund_redemption(session, redemption.id, captain)

    assert refunded.status == "refunded"
    assert coin_balance(session, team.id, captain, player.id) == 50
    assert session.get(StoreItem, item.id).stock == 2
