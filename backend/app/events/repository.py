from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.common.enums import EventStatus, EventType, SignupStatus
from app.models import Event, EventSignup, MatchDetails, MatchLogEntry, TeamMembership, User


def get_event(session: Session, event_id: UUID) -> Event | None:
    return session.get(Event, event_id)


def get_event_for_update(session: Session, event_id: UUID) -> Event | None:
    return session.scalar(select(Event).where(Event.id == event_id).with_for_update())


def get_match_details(session: Session, event_id: UUID) -> MatchDetails | None:
    return session.scalar(select(MatchDetails).where(MatchDetails.event_id == event_id))


def list_match_details(session: Session, event_ids: list[UUID]) -> list[MatchDetails]:
    return list(session.scalars(select(MatchDetails).where(MatchDetails.event_id.in_(event_ids))).all())


def list_events(
    session: Session,
    team_id: UUID,
    *,
    event_type: EventType | None,
    status: EventStatus | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
) -> list[Event]:
    stmt = select(Event).where(Event.team_id == team_id).order_by(Event.start_time)
    if event_type is not None:
        stmt = stmt.where(Event.type == event_type)
    if status is not None:
        stmt = stmt.where(Event.status == status)
    if starts_after is not None:
        stmt = stmt.where(Event.start_time >= starts_after)
    if starts_before is not None:
        stmt = stmt.where(Event.start_time <= starts_before)
    return list(session.scalars(stmt))


def find_signup(session: Session, event_id: UUID, user_id: UUID) -> EventSignup | None:
    return session.scalar(
        select(EventSignup).where(EventSignup.event_id == event_id, EventSignup.user_id == user_id)
    )


def list_event_signups(session: Session, event_id: UUID) -> list[EventSignup]:
    return list(session.scalars(select(EventSignup).where(EventSignup.event_id == event_id)).all())


def list_signups_with_users(
    session: Session,
    event_id: UUID,
    team_id: UUID,
    status: SignupStatus | None,
) -> list[tuple[EventSignup, User]]:
    stmt = (
        select(EventSignup, User)
        .join(User, User.id == EventSignup.user_id)
        .join(
            TeamMembership,
            (TeamMembership.team_id == team_id)
            & (TeamMembership.user_id == EventSignup.user_id),
        )
        .where(EventSignup.event_id == event_id, TeamMembership.role == "member")
        .order_by(EventSignup.created_at)
    )
    if status is not None:
        stmt = stmt.where(EventSignup.status == status)
    return [(signup, user) for signup, user in session.execute(stmt).all()]


def add(session: Session, value: object) -> None:
    session.add(value)


def flush(session: Session) -> None:
    session.flush()


def refresh(session: Session, value: object) -> None:
    session.refresh(value)


def delete_event_graph(session: Session, event: Event) -> None:
    session.execute(delete(EventSignup).where(EventSignup.event_id == event.id))
    session.execute(delete(MatchLogEntry).where(MatchLogEntry.event_id == event.id))
    session.execute(delete(MatchDetails).where(MatchDetails.event_id == event.id))
    session.delete(event)
