from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.common.enums import (
    CoinTransactionType,
    EventStatus,
    EventType,
    MatchEntryType,
    MembershipRole,
    enum_value,
)
from app.events.match_schemas import MatchLogEntryCreateRequest
from app.events.service import (
    EventNotFoundError,
    _ensure_event_visible,
    _get_match_details,
    _read_event_with_details,
)
from app.models import Attendance, CoinTransaction, Event, MatchLogEntry, User
from app.teams.service import require_team_role


class MatchLogNotFoundError(Exception):
    pass


class MatchLogConflictError(Exception):
    pass


class MatchStateError(Exception):
    pass


def _get_match_event(session: Session, event_id: UUID) -> Event:
    event = session.get(Event, event_id)
    if event is None:
        raise EventNotFoundError("Event not found")
    if event.type != EventType.match:
        raise MatchStateError("Event is not a match")
    return event


def _ensure_match_published(event: Event) -> None:
    if event.status != EventStatus.published:
        raise MatchStateError("Match logs require a published match")


def create_match_log(
    session: Session,
    event_id: UUID,
    user: User,
    payload: MatchLogEntryCreateRequest,
) -> MatchLogEntry:
    event = _get_match_event(session, event_id)
    _ensure_event_visible(session, event, user)
    _ensure_match_published(event)
    require_team_role(session, event.team_id, user.id, MembershipRole.captain)

    create_data = payload.model_dump(exclude={"id"})
    if payload.id is not None:
        existing = session.get(MatchLogEntry, payload.id)
        if existing is not None:
            if existing.event_id != event_id or existing.created_by != user.id:
                raise MatchLogConflictError("Match log id already belongs to another request")
            for field, value in create_data.items():
                if getattr(existing, field) != value:
                    raise MatchLogConflictError("Match log id already belongs to another request")
            return existing

    log = MatchLogEntry(id=payload.id, event_id=event_id, created_by=user.id, **create_data)
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


def list_match_logs(session: Session, event_id: UUID, user: User, after: UUID | None = None) -> list[MatchLogEntry]:
    event = _get_match_event(session, event_id)
    _ensure_event_visible(session, event, user)
    stmt = select(MatchLogEntry).where(MatchLogEntry.event_id == event_id)
    if after is not None:
        after_log = session.get(MatchLogEntry, after)
        if after_log is not None and after_log.event_id == event_id:
            stmt = stmt.where(
                (MatchLogEntry.minute > after_log.minute)
                | (
                    (MatchLogEntry.minute == after_log.minute)
                    & (MatchLogEntry.created_at > after_log.created_at)
                )
                | (
                    (MatchLogEntry.minute == after_log.minute)
                    & (MatchLogEntry.created_at == after_log.created_at)
                    & (MatchLogEntry.id > after_log.id)
                )
            )
    return list(session.scalars(stmt.order_by(MatchLogEntry.minute, MatchLogEntry.created_at, MatchLogEntry.id)))


def delete_match_log(session: Session, log_id: UUID, user: User) -> None:
    log = session.get(MatchLogEntry, log_id)
    if log is None:
        raise MatchLogNotFoundError("Match log not found")
    event = _get_match_event(session, log.event_id)
    _ensure_match_published(event)
    require_team_role(session, event.team_id, user.id, MembershipRole.captain)
    session.delete(log)
    session.commit()


def match_log_counts(logs: list[MatchLogEntry]) -> dict[str, int]:
    counts = {entry_type.value: 0 for entry_type in MatchEntryType}
    for log in logs:
        counts[enum_value(log.entry_type)] += 1
    return counts


def live_board(session: Session, event_id: UUID, user: User) -> dict[str, object]:
    event = _get_match_event(session, event_id)
    _ensure_event_visible(session, event, user)
    logs = list_match_logs(session, event_id, user)
    return {
        "event": _read_event_with_details(session, event),
        "match_details": _get_match_details(session, event.id),
        "logs": logs,
        "counts": match_log_counts(logs),
    }


def match_summary(session: Session, event_id: UUID, user: User) -> dict[str, object]:
    event = _get_match_event(session, event_id)
    _ensure_event_visible(session, event, user)
    logs = list_match_logs(session, event_id, user)
    attendance = session.scalars(select(Attendance).where(Attendance.event_id == event_id)).all()
    attendance_ids = [row.id for row in attendance]
    reward_filters = [
        (CoinTransaction.reference_type == "event") & (CoinTransaction.reference_id == event_id),
    ]
    if attendance_ids:
        reward_filters.append(
            (CoinTransaction.reference_type == "attendance_correction")
            & (CoinTransaction.reference_id.in_(attendance_ids))
        )
    rewards = session.scalars(
        select(CoinTransaction).where(
            CoinTransaction.team_id == event.team_id,
            CoinTransaction.type == CoinTransactionType.attendance_reward,
            or_(*reward_filters),
        )
    ).all()
    return {
        "event": _read_event_with_details(session, event),
        "match_details": _get_match_details(session, event.id),
        "counts": match_log_counts(logs),
        "attendance": [
            {"user_id": row.user_id, "status": enum_value(row.status), "recorded_at": row.recorded_at}
            for row in attendance
        ],
        "rewards": [
            {"user_id": row.user_id, "amount": row.amount, "created_at": row.created_at}
            for row in rewards
        ],
    }
