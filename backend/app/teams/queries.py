from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import EventStatus, MembershipRole, MembershipStatus, SignupStatus
from app.models import CoinTransaction, Event, EventSignup, TeamMembership, User


@dataclass(frozen=True)
class SignupBoardData:
    events: list[Event]
    memberships: list[TeamMembership]
    signups: list[EventSignup]
    users: list[User]


@dataclass(frozen=True)
class TeamHomeData:
    member_count: int
    upcoming_events: list[Event]
    signup_counts: list[tuple[SignupStatus, int]]
    user_balance: int
    team_ledger_total: int


def load_signup_board_data(
    session: Session,
    *,
    team_id: UUID,
    starts_after: datetime | None,
    starts_before: datetime | None,
) -> SignupBoardData:
    event_stmt = select(Event).where(Event.team_id == team_id, Event.status == EventStatus.completed)
    if starts_after is not None:
        event_stmt = event_stmt.where(Event.start_time >= starts_after)
    if starts_before is not None:
        event_stmt = event_stmt.where(Event.start_time <= starts_before)
    events = list(session.scalars(event_stmt.order_by(Event.start_time)).all())

    memberships = list(
        session.scalars(
            select(TeamMembership).where(
                TeamMembership.team_id == team_id,
                TeamMembership.role == MembershipRole.member,
            )
        ).all()
    )
    event_ids = [event.id for event in events]
    signups = list(
        session.scalars(select(EventSignup).where(EventSignup.event_id.in_(event_ids))).all()
    )
    user_ids = [membership.user_id for membership in memberships]
    users = list(session.scalars(select(User).where(User.id.in_(user_ids))).all())
    return SignupBoardData(events=events, memberships=memberships, signups=signups, users=users)


def load_team_home_data(session: Session, *, team_id: UUID, user_id: UUID) -> TeamHomeData:
    member_count = session.scalar(
        select(func.count()).select_from(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.status == MembershipStatus.active,
        )
    ) or 0
    upcoming_events = list(
        session.scalars(
            select(Event)
            .where(
                Event.team_id == team_id,
                Event.status == EventStatus.published,
                Event.start_time >= datetime.now(UTC),
            )
            .order_by(Event.start_time)
            .limit(5)
        )
    )
    signup_counts = [
        (status, count)
        for status, count in session.execute(
            select(EventSignup.status, func.count().label("count"))
            .join(Event, Event.id == EventSignup.event_id)
            .join(
                TeamMembership,
                (TeamMembership.team_id == Event.team_id)
                & (TeamMembership.user_id == EventSignup.user_id),
            )
            .where(
                Event.team_id == team_id,
                Event.status == EventStatus.completed,
                TeamMembership.role == MembershipRole.member,
            )
            .group_by(EventSignup.status)
        )
    ]
    user_balance = session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.team_id == team_id,
            CoinTransaction.user_id == user_id,
        )
    ) or 0
    team_ledger_total = session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.team_id == team_id
        )
    ) or 0
    return TeamHomeData(
        member_count=member_count,
        upcoming_events=upcoming_events,
        signup_counts=signup_counts,
        user_balance=user_balance,
        team_ledger_total=team_ledger_total,
    )
