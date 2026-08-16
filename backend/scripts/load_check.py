from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Any, cast
from uuid import uuid4

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
    NotificationType,
)
from app.events.match_service import live_board
from app.models import (
    Attendance,
    CoinTransaction,
    Event,
    MatchDetails,
    MatchLogEntry,
    Notification,
    Organization,
    Team,
    TeamMembership,
    User,
)
from app.notifications.service import list_notifications, unread_count
from app.teams.service import build_team_home

TEAM_HOME_ITERATIONS = 80
INBOX_ITERATIONS = 80
LIVE_BOARD_ITERATIONS = 80
LOAD_CHECK_MAX_SECONDS = 5.0


@contextmanager
def load_check_session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    try:
        with SessionLocal() as session:
            yield session
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def _user(index: int) -> User:
    return User(auth_id=uuid4(), name=f"Load Player {index}", email=f"load-player-{index}@example.test")


def seed_load_check_data(session: Session) -> tuple[Team, User, User, Event]:
    organization = Organization(name="Load Club", slug="load-club")
    captain = User(auth_id=uuid4(), name="Load Captain", email="load-captain@example.test")
    player = User(auth_id=uuid4(), name="Load Player", email="load-player@example.test")
    extra_players = [_user(index) for index in range(30)]
    session.add_all([organization, captain, player, *extra_players])
    session.flush()

    team = Team(organization_id=organization.id, name="Load FC", logo_url="https://cdn.example.test/load-fc.png")
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
            *[
                TeamMembership(
                    team_id=team.id,
                    user_id=extra_player.id,
                    role=MembershipRole.member,
                    status=MembershipStatus.active,
                )
                for extra_player in extra_players
            ],
        ]
    )

    now = datetime.now(UTC)
    completed_events: list[Event] = []
    upcoming_events: list[Event] = []
    for index in range(12):
        completed_events.append(
            Event(
                team_id=team.id,
                type=EventType.training,
                title=f"Completed training {index}",
                start_time=now - timedelta(days=index + 1),
                status=EventStatus.completed,
                created_by=captain.id,
            )
        )
        upcoming_events.append(
            Event(
                team_id=team.id,
                type=EventType.training,
                title=f"Upcoming training {index}",
                start_time=now + timedelta(days=index + 1),
                status=EventStatus.published,
                created_by=captain.id,
            )
        )
    match = Event(
        team_id=team.id,
        type=EventType.match,
        title="Load match",
        start_time=now + timedelta(days=3),
        status=EventStatus.published,
        created_by=captain.id,
    )
    session.add_all([*completed_events, *upcoming_events, match])
    session.flush()
    session.add(MatchDetails(event_id=match.id, opponent="Load United"))

    attendance_rows: list[Attendance] = []
    coin_rows: list[CoinTransaction] = []
    for index, event in enumerate(completed_events):
        status = AttendanceStatus.present if index % 3 else AttendanceStatus.late
        attendance_rows.append(
            Attendance(event_id=event.id, user_id=player.id, status=status, recorded_by=captain.id)
        )
        coin_rows.append(
            CoinTransaction(
                team_id=team.id,
                user_id=player.id,
                amount=10,
                type=CoinTransactionType.attendance_reward,
                reason="Load reward",
                reference_type="event",
                reference_id=event.id,
                created_by=captain.id,
            )
        )
    session.add_all(attendance_rows)
    session.add_all(coin_rows)

    notifications = [
        Notification(
            user_id=player.id,
            team_id=team.id,
            type=NotificationType.new_event if index % 2 else NotificationType.team_announcement,
            title=f"Load notification {index}",
            body="Load notification body",
            reference_type="team",
            reference_id=team.id,
        )
        for index in range(120)
    ]
    session.add_all(notifications)

    match_logs = [
        MatchLogEntry(
            event_id=match.id,
            entry_type=MatchEntryType.goal if index % 2 == 0 else MatchEntryType.yellow_card,
            minute=index,
            player_name=player.name,
            player_number="9",
            created_by=player.id,
        )
        for index in range(40)
    ]
    session.add_all(match_logs)
    session.commit()
    return team, captain, player, match


def run_load_check() -> dict[str, object]:
    with load_check_session() as session:
        team, _, player, match = seed_load_check_data(session)
        started_at = perf_counter()

        team_home = None
        for _ in range(TEAM_HOME_ITERATIONS):
            team_home = build_team_home(session, team.id, player)
        assert team_home is not None
        assert team_home["member_count"] == 32
        team_home_upcoming_events = cast(list[dict[str, Any]], team_home["upcoming_events"])
        team_home_attendance_summary = cast(dict[str, int], team_home["attendance_summary"])
        assert len(team_home_upcoming_events) == 5
        assert team_home_attendance_summary["total"] == 12

        notifications = []
        unread = 0
        for _ in range(INBOX_ITERATIONS):
            notifications = list_notifications(session, player, team.id, None, unread_only=True)
            unread = unread_count(session, player, team.id)
        assert len(notifications) == 120
        assert unread == 120

        board = None
        for _ in range(LIVE_BOARD_ITERATIONS):
            board = live_board(session, match.id, player)
        assert board is not None
        board_logs = cast(list[MatchLogEntry], board["logs"])
        board_counts = cast(dict[str, int], board["counts"])
        assert len(board_logs) == 40
        assert board_counts["goal"] == 20
        assert board_counts["yellow_card"] == 20

        elapsed_seconds = perf_counter() - started_at
        if elapsed_seconds > LOAD_CHECK_MAX_SECONDS:
            raise RuntimeError(
                f"Load check exceeded {LOAD_CHECK_MAX_SECONDS:.1f}s: {elapsed_seconds:.3f}s"
            )

        return {
            "team_home_iterations": TEAM_HOME_ITERATIONS,
            "inbox_iterations": INBOX_ITERATIONS,
            "live_board_iterations": LIVE_BOARD_ITERATIONS,
            "elapsed_seconds": round(elapsed_seconds, 3),
            "notifications": unread,
            "match_logs": len(board_logs),
        }


def main() -> int:
    result = run_load_check()
    print("Backend load check passed:")
    for key, value in result.items():
        print(f"- {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
