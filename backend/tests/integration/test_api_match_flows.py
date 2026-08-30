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
    CoinTransactionType,
    EventStatus,
    EventType,
    MatchEntryType,
    MembershipRole,
    MembershipStatus,
    SignupStatus,
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
    CoinTransaction,
    Event,
    EventSignup,
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
    admin = _user("Match Admin")
    player = _user("Match Player")
    session.add_all([organization, admin, player])
    session.flush()

    team = Team(organization_id=organization.id, name="Match MVP Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=admin.id,
                role=MembershipRole.admin,
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
    return team, admin, player


def _match_event(session: Session, team: Team, admin: User, status: EventStatus) -> Event:
    event = Event(
        team_id=team.id,
        type=EventType.match,
        title="友谊赛",
        start_time=datetime.now(UTC) + timedelta(days=2),
        end_time=datetime.now(UTC) + timedelta(days=2) + timedelta(hours=2),
        status=status,
        created_by=admin.id,
    )
    session.add(event)
    session.flush()
    session.add(MatchDetails(event_id=event.id, opponent="隔壁队"))
    session.commit()
    return event


def test_match_router_allows_live_logging_and_admin_deletion(session: Session) -> None:
    team, admin, player = _seed_team(session)
    event = _match_event(session, team, admin, EventStatus.published)
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
        admin,
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
        admin,
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

    delete_match_log_route(goal.id, admin, session)
    assert read_live_board(event.id, admin, session)["counts"]["goal"] == 0


def test_match_log_create_is_idempotent_by_client_id(session: Session) -> None:
    team, admin, _ = _seed_team(session)
    event = _match_event(session, team, admin, EventStatus.published)
    log_id = uuid4()
    payload = MatchLogEntryCreateRequest(
        id=log_id,
        entry_type=MatchEntryType.goal,
        minute=18,
        player_name="小陈",
        player_number="9",
    )

    created = post_match_log(event.id, payload, admin, session)
    repeated = post_match_log(event.id, payload, admin, session)

    assert repeated.id == created.id == log_id
    assert read_live_board(event.id, admin, session)["counts"]["goal"] == 1
    assert read_match_logs(event.id, None, admin, session) == [created]

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
            admin,
            session,
        )
    assert mismatch_exc.value.status_code == 409
    assert mismatch_exc.value.detail["code"] == "MATCH_LOG_CONFLICT"
    assert read_live_board(event.id, admin, session)["counts"] == {
        "goal": 1,
        "yellow_card": 0,
        "red_card": 0,
        "substitution": 0,
    }


def test_match_router_rejects_completed_or_non_match_event_logging(session: Session) -> None:
    team, admin, player = _seed_team(session)
    completed_match = _match_event(session, team, admin, EventStatus.completed)
    training = Event(
        team_id=team.id,
        type=EventType.training,
        title="训练不是比赛",
        start_time=datetime.now(UTC) + timedelta(days=1),
        end_time=datetime.now(UTC) + timedelta(days=1) + timedelta(hours=2),
        status=EventStatus.published,
        created_by=admin.id,
    )
    session.add(training)
    session.commit()
    payload = MatchLogEntryCreateRequest(
        entry_type=MatchEntryType.goal,
        minute=8,
        player_name="小陈",
        player_number="9",
    )

    with pytest.raises(HTTPException) as member_completed_exc:
        post_match_log(completed_match.id, payload, player, session)
    assert member_completed_exc.value.status_code == 409
    assert member_completed_exc.value.detail["code"] == "MATCH_STATE_CONFLICT"

    with pytest.raises(HTTPException) as admin_completed_exc:
        post_match_log(completed_match.id, payload, admin, session)
    assert admin_completed_exc.value.status_code == 409
    assert admin_completed_exc.value.detail["code"] == "MATCH_STATE_CONFLICT"

    with pytest.raises(HTTPException) as non_match_exc:
        post_match_log(training.id, payload, player, session)
    assert non_match_exc.value.status_code == 409
    assert non_match_exc.value.detail["code"] == "MATCH_STATE_CONFLICT"


def test_completed_match_logs_are_read_only_but_still_visible(session: Session) -> None:
    team, admin, player = _seed_team(session)
    event = _match_event(session, team, admin, EventStatus.published)
    goal = post_match_log(
        event.id,
        MatchLogEntryCreateRequest(
            entry_type=MatchEntryType.goal,
            minute=12,
            player_name="小李",
            player_number="10",
        ),
        admin,
        session,
    )
    event.status = EventStatus.completed
    session.commit()

    board = read_live_board(event.id, player, session)
    assert board["counts"]["goal"] == 1
    assert read_match_logs(event.id, None, admin, session) == [goal]

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
        delete_match_log_route(goal.id, admin, session)
    assert delete_exc.value.status_code == 409
    assert delete_exc.value.detail["code"] == "MATCH_STATE_CONFLICT"
    assert read_live_board(event.id, admin, session)["counts"]["goal"] == 1


def test_match_summary_includes_signups_and_signup_reward_transactions(session: Session) -> None:
    team, admin, player = _seed_team(session)
    event = _match_event(session, team, admin, EventStatus.completed)
    signup = EventSignup(
        event_id=event.id,
        user_id=player.id,
        status=SignupStatus.going,
    )
    session.add(signup)
    session.flush()
    initial_reward = CoinTransaction(
        team_id=team.id,
        user_id=player.id,
        amount=20,
        type=CoinTransactionType.signup_reward,
        reason="Initial match signup reward",
        reference_type="event",
        reference_id=event.id,
        created_by=admin.id,
    )
    other_event = _match_event(session, team, admin, EventStatus.completed)
    unrelated_reward = CoinTransaction(
        team_id=team.id,
        user_id=player.id,
        amount=99,
        type=CoinTransactionType.signup_reward,
        reason="Other match reward",
        reference_type="event",
        reference_id=other_event.id,
        created_by=admin.id,
    )
    session.add_all([initial_reward, unrelated_reward])
    session.commit()

    summary = read_match_summary(event.id, admin, session)

    assert summary["signups"] == [
        {"user_id": player.id, "status": "going", "updated_at": signup.updated_at}
    ]
    assert [
        {"user_id": reward["user_id"], "amount": reward["amount"]}
        for reward in summary["rewards"]
    ] == [
        {"user_id": player.id, "amount": 20},
    ]


def test_match_log_after_cursor_is_scoped_to_the_current_match(session: Session) -> None:
    team, admin, player = _seed_team(session)
    event = _match_event(session, team, admin, EventStatus.published)
    other_event = _match_event(session, team, admin, EventStatus.published)

    current_goal = post_match_log(
        event.id,
        MatchLogEntryCreateRequest(
            entry_type=MatchEntryType.goal,
            minute=8,
            player_name="小陈",
            player_number="9",
        ),
        admin,
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
        admin,
        session,
    )

    assert read_match_logs(event.id, other_goal.id, player, session) == [current_goal]
    assert read_match_logs(event.id, current_goal.id, player, session) == []
