from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.attendance.service import attendance_board, complete_event, upsert_attendance
from app.coins.service import coin_balance
from app.common.database import Base
from app.common.enums import (
    AttendanceStatus,
    CoinRuleTrigger,
    CoinTransactionType,
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
)
from app.common.permissions import PermissionDeniedError
from app.models import (
    Attendance,
    CoinRule,
    CoinTransaction,
    Event,
    Organization,
    StoreItem,
    Team,
    TeamMembership,
    User,
)
from app.store.schemas import RedemptionCreateRequest
from app.store.service import create_redemption, fulfill_redemption, refund_redemption


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


def _add_attendance_rules(session: Session, team: Team, captain: User) -> None:
    session.add_all(
        [
            CoinRule(
                team_id=team.id,
                name="训练出勤",
                trigger_type=CoinRuleTrigger.training_attendance,
                amount=10,
                created_by=captain.id,
            ),
            CoinRule(
                team_id=team.id,
                name="比赛出勤",
                trigger_type=CoinRuleTrigger.match_attendance,
                amount=20,
                created_by=captain.id,
            ),
            CoinRule(
                team_id=team.id,
                name="迟到",
                trigger_type=CoinRuleTrigger.late_attendance,
                amount=3,
                created_by=captain.id,
            ),
        ]
    )
    session.commit()


def test_completion_auto_marks_missing_attendance_and_reconciles_coin_rewards(
    session: Session,
) -> None:
    team, captain, player, missing_player = _seed_team(session)
    _add_attendance_rules(session, team, captain)
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

    upsert_attendance(session, event.id, player.id, captain, AttendanceStatus.present, None)
    result = complete_event(session, event.id, captain)

    assert result["status"] == EventStatus.completed
    assert result["attendance_count"] == 3
    assert result["reward_count"] == 1

    missing_attendance = session.scalar(
        select(Attendance).where(Attendance.event_id == event.id, Attendance.user_id == missing_player.id)
    )
    assert missing_attendance is not None
    assert missing_attendance.status == AttendanceStatus.absent
    assert coin_balance(session, team.id, captain, player.id) == 10
    assert coin_balance(session, team.id, captain, missing_player.id) == 0

    upsert_attendance(session, event.id, player.id, captain, AttendanceStatus.absent, "误记修正")

    assert coin_balance(session, team.id, captain, player.id) == 0
    transactions = session.scalars(
        select(CoinTransaction)
        .where(CoinTransaction.team_id == team.id, CoinTransaction.user_id == player.id)
        .order_by(CoinTransaction.created_at)
    ).all()
    assert [transaction.amount for transaction in transactions] == [10, -10]
    assert transactions[-1].reference_type == "attendance_correction"


def test_attendance_reward_uses_configured_coin_rule_amount(session: Session) -> None:
    team, captain, player, _ = _seed_team(session)
    _add_attendance_rules(session, team, captain)
    training_rule = session.scalar(
        select(CoinRule).where(
            CoinRule.team_id == team.id,
            CoinRule.trigger_type == CoinRuleTrigger.training_attendance,
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

    upsert_attendance(session, event.id, player.id, captain, AttendanceStatus.present, None)
    complete_event(session, event.id, captain)

    reward = session.scalar(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.attendance_reward,
            CoinTransaction.reference_type == "event",
            CoinTransaction.reference_id == event.id,
        )
    )
    assert reward is not None
    assert reward.amount == 17
    assert coin_balance(session, team.id, captain, player.id) == 17


def test_late_attendance_uses_late_rule_instead_of_training_or_match_present_rules(session: Session) -> None:
    team, captain, player, _ = _seed_team(session)
    _add_attendance_rules(session, team, captain)
    training_event = Event(
        team_id=team.id,
        type=EventType.training,
        title="迟到训练",
        start_time=datetime.now(UTC) + timedelta(days=1),
        status=EventStatus.published,
        created_by=captain.id,
    )
    match_event = Event(
        team_id=team.id,
        type=EventType.match,
        title="迟到比赛",
        start_time=datetime.now(UTC) + timedelta(days=2),
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add_all([training_event, match_event])
    session.commit()

    upsert_attendance(session, training_event.id, player.id, captain, AttendanceStatus.late, None)
    upsert_attendance(session, match_event.id, player.id, captain, AttendanceStatus.late, None)
    complete_event(session, training_event.id, captain)
    complete_event(session, match_event.id, captain)

    rewards = session.scalars(
        select(CoinTransaction)
        .where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.attendance_reward,
            CoinTransaction.reference_type == "event",
        )
        .order_by(CoinTransaction.created_at)
    ).all()

    assert [reward.amount for reward in rewards] == [3, 3]
    assert [reward.metadata_["status"] for reward in rewards] == ["late", "late"]
    assert coin_balance(session, team.id, captain, player.id) == 6


def test_repeating_completed_event_settlement_is_idempotent(session: Session) -> None:
    team, captain, player, _ = _seed_team(session)
    _add_attendance_rules(session, team, captain)
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

    upsert_attendance(session, event.id, player.id, captain, AttendanceStatus.present, None)
    first_result = complete_event(session, event.id, captain)
    second_result = complete_event(session, event.id, captain)

    assert first_result["reward_count"] == 1
    assert second_result["status"] == EventStatus.completed
    assert second_result["attendance_count"] == first_result["attendance_count"]
    assert second_result["reward_count"] == 0
    rewards = session.scalars(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.attendance_reward,
            CoinTransaction.reference_type == "event",
            CoinTransaction.reference_id == event.id,
        )
    ).all()
    assert [reward.amount for reward in rewards] == [10]
    assert coin_balance(session, team.id, captain, player.id) == 10


def test_completion_auto_marks_members_eligible_at_event_start(
    session: Session,
) -> None:
    team, captain, _, _ = _seed_team(session)
    event_start = datetime.now(UTC) + timedelta(days=2)
    former_player = _user("Former Player")
    late_joiner = _user("Late Joiner")
    old_inactive_player = _user("Old Inactive Player")
    event = Event(
        team_id=team.id,
        type=EventType.training,
        title="按历史成员资格补考勤",
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
        ]
    )
    session.commit()

    result = complete_event(session, event.id, captain)

    attendance_by_user_id = {
        attendance.user_id: attendance
        for attendance in session.scalars(select(Attendance).where(Attendance.event_id == event.id))
    }
    assert result["status"] == EventStatus.completed
    assert attendance_by_user_id[former_player.id].status == AttendanceStatus.absent
    assert late_joiner.id not in attendance_by_user_id
    assert old_inactive_player.id not in attendance_by_user_id


def test_attendance_correction_can_make_coin_balance_negative_after_reward_is_spent(
    session: Session,
) -> None:
    team, captain, player, _ = _seed_team(session)
    _add_attendance_rules(session, team, captain)
    event = Event(
        team_id=team.id,
        type=EventType.training,
        title="奖励已消费后修正",
        start_time=datetime.now(UTC) + timedelta(days=1),
        status=EventStatus.published,
        created_by=captain.id,
    )
    item = StoreItem(
        team_id=team.id,
        name="训练贴纸",
        price=10,
        stock=1,
        is_active=True,
        created_by=captain.id,
    )
    session.add_all([event, item])
    session.commit()

    upsert_attendance(session, event.id, player.id, captain, AttendanceStatus.present, None)
    complete_event(session, event.id, captain)
    assert coin_balance(session, team.id, captain, player.id) == 10

    redemption = create_redemption(
        session,
        team.id,
        player,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
    )
    assert redemption.total_price == 10
    assert coin_balance(session, team.id, captain, player.id) == 0
    assert session.get(StoreItem, item.id).stock == 0

    membership = session.scalar(
        select(TeamMembership).where(TeamMembership.team_id == team.id, TeamMembership.user_id == player.id)
    )
    assert membership is not None
    membership.status = MembershipStatus.inactive
    session.commit()

    upsert_attendance(session, event.id, player.id, captain, AttendanceStatus.absent, "奖励已兑换后追回")

    assert coin_balance(session, team.id, captain, player.id) == -10
    correction = session.scalar(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.reference_type == "attendance_correction",
        )
    )
    assert correction is not None
    assert correction.amount == -10


def test_attendance_board_returns_rates_and_date_filters(session: Session) -> None:
    team, captain, player, missing_player = _seed_team(session)
    now = datetime.now(UTC)
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
            Attendance(
                event_id=old_event.id,
                user_id=player.id,
                status=AttendanceStatus.absent,
                recorded_by=captain.id,
            ),
            Attendance(
                event_id=recent_event.id,
                user_id=player.id,
                status=AttendanceStatus.present,
                recorded_by=captain.id,
            ),
            Attendance(
                event_id=recent_event.id,
                user_id=missing_player.id,
                status=AttendanceStatus.late,
                recorded_by=captain.id,
            ),
        ]
    )
    session.commit()

    all_rows = attendance_board(session, team.id, captain)
    player_row = next(row for row in all_rows if row["user_id"] == player.id)
    assert player_row["user"]["name"] == player.name
    assert player_row["user"]["email"] == player.email
    assert player_row["present"] == 1
    assert player_row["absent"] == 1
    assert player_row["total"] == 2
    assert player_row["attendance_rate"] == 0.5

    recent_rows = attendance_board(session, team.id, captain, starts_after=now - timedelta(days=2))
    recent_player_row = next(row for row in recent_rows if row["user_id"] == player.id)
    assert recent_player_row["present"] == 1
    assert recent_player_row["absent"] == 0
    assert recent_player_row["attendance_rate"] == 1.0


def test_attendance_board_requires_current_team_membership(session: Session) -> None:
    team, captain, player, _missing_player = _seed_team(session)
    other_org = Organization(name="Other Attendance Org", slug=f"other-attendance-{uuid4().hex[:8]}")
    session.add(other_org)
    session.flush()
    other_team = Team(organization_id=other_org.id, name="Other Attendance Team")
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
        attendance_board(session, other_team.id, player)

    assert attendance_board(session, team.id, captain) == []


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
