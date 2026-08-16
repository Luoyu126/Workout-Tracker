from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.common.database import Base
from app.common.enums import (
    AttendanceStatus,
    CoinTransactionType,
    EventStatus,
    EventType,
    MatchEntryType,
    MembershipRole,
    MembershipStatus,
)
from app.events.match_router import (
    delete_match_log_route,
    post_match_log,
    read_live_board,
    read_match_logs,
    read_match_summary,
)
from app.events.match_schemas import MatchLogEntryCreateRequest
from app.models import (
    Attendance,
    CoinTransaction,
    Event,
    MatchDetails,
    Organization,
    Team,
    TeamMembership,
    User,
)


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
    return User(auth_id=uuid4(), name=name, email=f"{normalized}-{uuid4().hex[:8]}@example.com")


def _seed_team(session: Session) -> tuple[Team, User, User]:
    organization = Organization(name="Match API Org", slug=f"match-api-{uuid4().hex[:8]}")
    captain = _user("Match Captain")
    player = _user("Match Player")
    session.add_all([organization, captain, player])
    session.flush()

    team = Team(organization_id=organization.id, name="Match MVP Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=captain.id,
                role=MembershipRole.captain,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
        ]
    )
    session.commit()
    return team, captain, player


def _match_event(session: Session, team: Team, captain: User, status: EventStatus) -> Event:
    event = Event(
        team_id=team.id,
        type=EventType.match,
        title="友谊赛",
        start_time=datetime.now(UTC) + timedelta(days=2),
        status=status,
        created_by=captain.id,
    )
    session.add(event)
    session.flush()
    session.add(MatchDetails(event_id=event.id, opponent="隔壁队"))
    session.commit()
    return event


def test_match_router_allows_live_logging_and_captain_deletion(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = _match_event(session, team, captain, EventStatus.published)
    member_payload = MatchLogEntryCreateRequest(
        entry_type=MatchEntryType.goal,
        minute=18,
        player_name="小陈",
        player_number="9",
    )

    with pytest.raises(HTTPException) as member_create_exc:
        post_match_log(event.id, member_payload, player, session)
    assert member_create_exc.value.status_code == 403
    assert member_create_exc.value.detail["code"] == "MATCH_PERMISSION_DENIED"

    goal = post_match_log(
        event.id,
        member_payload,
        captain,
        session,
    )
    yellow = post_match_log(
        event.id,
        MatchLogEntryCreateRequest(
            entry_type=MatchEntryType.yellow_card,
            minute=31,
            player_name="小王",
            player_number="6",
        ),
        captain,
        session,
    )

    assert read_match_logs(event.id, None, player, session) == [goal, yellow]
    board = read_live_board(event.id, player, session)
    assert board["counts"] == {
        "goal": 1,
        "yellow_card": 1,
        "red_card": 0,
        "substitution": 0,
    }
    assert board["match_details"].opponent == "隔壁队"

    with pytest.raises(HTTPException) as member_delete_exc:
        delete_match_log_route(goal.id, player, session)
    assert member_delete_exc.value.status_code == 403
    assert member_delete_exc.value.detail["code"] == "MATCH_PERMISSION_DENIED"

    delete_match_log_route(goal.id, captain, session)
    assert read_live_board(event.id, captain, session)["counts"]["goal"] == 0


def test_match_log_create_is_idempotent_by_client_id(session: Session) -> None:
    team, captain, _ = _seed_team(session)
    event = _match_event(session, team, captain, EventStatus.published)
    log_id = uuid4()
    payload = MatchLogEntryCreateRequest(
        id=log_id,
        entry_type=MatchEntryType.goal,
        minute=18,
        player_name="小陈",
        player_number="9",
    )

    created = post_match_log(event.id, payload, captain, session)
    repeated = post_match_log(event.id, payload, captain, session)

    assert repeated.id == created.id == log_id
    assert read_live_board(event.id, captain, session)["counts"]["goal"] == 1
    assert read_match_logs(event.id, None, captain, session) == [created]

    with pytest.raises(HTTPException) as mismatch_exc:
        post_match_log(
            event.id,
            MatchLogEntryCreateRequest(
                id=log_id,
                entry_type=MatchEntryType.yellow_card,
                minute=18,
                player_name="小陈",
                player_number="9",
            ),
            captain,
            session,
        )
    assert mismatch_exc.value.status_code == 409
    assert mismatch_exc.value.detail["code"] == "MATCH_LOG_CONFLICT"
    assert read_live_board(event.id, captain, session)["counts"] == {
        "goal": 1,
        "yellow_card": 0,
        "red_card": 0,
        "substitution": 0,
    }


def test_match_router_rejects_draft_or_non_match_event_logging(session: Session) -> None:
    team, captain, player = _seed_team(session)
    draft_match = _match_event(session, team, captain, EventStatus.draft)
    training = Event(
        team_id=team.id,
        type=EventType.training,
        title="训练不是比赛",
        start_time=datetime.now(UTC) + timedelta(days=1),
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add(training)
    session.commit()
    payload = MatchLogEntryCreateRequest(
        entry_type=MatchEntryType.goal,
        minute=8,
        player_name="小陈",
        player_number="9",
    )

    with pytest.raises(HTTPException) as member_draft_exc:
        post_match_log(draft_match.id, payload, player, session)
    assert member_draft_exc.value.status_code == 403
    assert member_draft_exc.value.detail["code"] == "MATCH_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as captain_draft_exc:
        post_match_log(draft_match.id, payload, captain, session)
    assert captain_draft_exc.value.status_code == 409
    assert captain_draft_exc.value.detail["code"] == "MATCH_STATE_CONFLICT"

    with pytest.raises(HTTPException) as non_match_exc:
        post_match_log(training.id, payload, player, session)
    assert non_match_exc.value.status_code == 409
    assert non_match_exc.value.detail["code"] == "MATCH_STATE_CONFLICT"


def test_match_router_keeps_draft_match_subresources_hidden_from_members(session: Session) -> None:
    team, captain, player = _seed_team(session)
    draft_match = _match_event(session, team, captain, EventStatus.draft)

    assert read_match_logs(draft_match.id, None, captain, session) == []
    assert read_live_board(draft_match.id, captain, session)["event"]["id"] == draft_match.id
    assert read_match_summary(draft_match.id, captain, session)["event"]["id"] == draft_match.id

    with pytest.raises(HTTPException) as logs_exc:
        read_match_logs(draft_match.id, None, player, session)
    assert logs_exc.value.status_code == 403
    assert logs_exc.value.detail["code"] == "MATCH_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as board_exc:
        read_live_board(draft_match.id, player, session)
    assert board_exc.value.status_code == 403
    assert board_exc.value.detail["code"] == "MATCH_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as summary_exc:
        read_match_summary(draft_match.id, player, session)
    assert summary_exc.value.status_code == 403
    assert summary_exc.value.detail["code"] == "MATCH_PERMISSION_DENIED"


def test_completed_match_logs_are_read_only_but_still_visible(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = _match_event(session, team, captain, EventStatus.published)
    goal = post_match_log(
        event.id,
        MatchLogEntryCreateRequest(
            entry_type=MatchEntryType.goal,
            minute=12,
            player_name="小李",
            player_number="10",
        ),
        captain,
        session,
    )
    event.status = EventStatus.completed
    session.commit()

    board = read_live_board(event.id, player, session)
    assert board["counts"]["goal"] == 1
    assert read_match_logs(event.id, None, captain, session) == [goal]

    with pytest.raises(HTTPException) as create_exc:
        post_match_log(
            event.id,
            MatchLogEntryCreateRequest(
                entry_type=MatchEntryType.yellow_card,
                minute=88,
                player_name="小李",
                player_number="10",
            ),
            player,
            session,
        )
    assert create_exc.value.status_code == 409
    assert create_exc.value.detail["code"] == "MATCH_STATE_CONFLICT"

    with pytest.raises(HTTPException) as delete_exc:
        delete_match_log_route(goal.id, captain, session)
    assert delete_exc.value.status_code == 409
    assert delete_exc.value.detail["code"] == "MATCH_STATE_CONFLICT"
    assert read_live_board(event.id, captain, session)["counts"]["goal"] == 1


def test_match_summary_includes_attendance_correction_reward_transactions(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = _match_event(session, team, captain, EventStatus.completed)
    attendance = Attendance(
        event_id=event.id,
        user_id=player.id,
        status=AttendanceStatus.absent,
        recorded_by=captain.id,
    )
    session.add(attendance)
    session.flush()
    initial_reward = CoinTransaction(
        team_id=team.id,
        user_id=player.id,
        amount=20,
        type=CoinTransactionType.attendance_reward,
        reason="Initial match attendance reward",
        reference_type="event",
        reference_id=event.id,
        created_by=captain.id,
    )
    correction_clawback = CoinTransaction(
        team_id=team.id,
        user_id=player.id,
        amount=-20,
        type=CoinTransactionType.attendance_reward,
        reason="Corrected to absent",
        reference_type="attendance_correction",
        reference_id=attendance.id,
        created_by=captain.id,
    )
    other_event = _match_event(session, team, captain, EventStatus.completed)
    unrelated_reward = CoinTransaction(
        team_id=team.id,
        user_id=player.id,
        amount=99,
        type=CoinTransactionType.attendance_reward,
        reason="Other match reward",
        reference_type="event",
        reference_id=other_event.id,
        created_by=captain.id,
    )
    session.add_all([initial_reward, correction_clawback, unrelated_reward])
    session.commit()

    summary = read_match_summary(event.id, captain, session)

    assert summary["attendance"] == [
        {"user_id": player.id, "status": "absent", "recorded_at": attendance.recorded_at}
    ]
    assert [
        {"user_id": reward["user_id"], "amount": reward["amount"]}
        for reward in summary["rewards"]
    ] == [
        {"user_id": player.id, "amount": 20},
        {"user_id": player.id, "amount": -20},
    ]


def test_match_log_after_cursor_is_scoped_to_the_current_match(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = _match_event(session, team, captain, EventStatus.published)
    other_event = _match_event(session, team, captain, EventStatus.published)

    current_goal = post_match_log(
        event.id,
        MatchLogEntryCreateRequest(
            entry_type=MatchEntryType.goal,
            minute=8,
            player_name="小陈",
            player_number="9",
        ),
        captain,
        session,
    )
    other_goal = post_match_log(
        other_event.id,
        MatchLogEntryCreateRequest(
            entry_type=MatchEntryType.goal,
            minute=90,
            player_name="隔壁队员",
            player_number="11",
        ),
        captain,
        session,
    )

    assert read_match_logs(event.id, other_goal.id, player, session) == [current_goal]
    assert read_match_logs(event.id, current_goal.id, player, session) == []
