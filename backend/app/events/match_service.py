from uuid import UUID

from sqlalchemy.orm import Session

from app.common.enums import EventStatus, EventType, MatchEntryType, MembershipRole, enum_value
from app.common.transactions import transaction_boundary
from app.events import match_repository
from app.events import repository as event_repository
from app.events.match_errors import (
    MatchEventNotFoundError,
    MatchLogConflictError,
    MatchLogNotFoundError,
    MatchStateError,
)
from app.events.match_schemas import MatchLogEntryCreateRequest
from app.events.service import _ensure_event_visible, _get_match_details, _read_event_with_details
from app.models import Event, MatchLogEntry, User
from app.teams.service import require_team_role


def _get_match_event(session: Session, event_id: UUID) -> Event:
    event = event_repository.get_event(session, event_id)
    if event is None:
        raise MatchEventNotFoundError()
    if event.type != EventType.match:
        raise MatchStateError("Event is not a match")
    return event


def _ensure_match_published(event: Event) -> None:
    if event.status != EventStatus.published:
        raise MatchStateError("Match logs require a published match")


def _require_match_admin(session: Session, event: Event, user: User, operation: str) -> None:
    require_team_role(
        session,
        event.team_id,
        user.id,
        MembershipRole.admin,
        permission_code="MATCH_PERMISSION_DENIED",
        operation=operation,
    )


def create_match_log(
    session: Session,
    event_id: UUID,
    user: User,
    payload: MatchLogEntryCreateRequest,
) -> MatchLogEntry:
    with transaction_boundary(session):
        event = _get_match_event(session, event_id)
        _ensure_event_visible(session, event, user, permission_code="MATCH_PERMISSION_DENIED")
        _ensure_match_published(event)
        _require_match_admin(session, event, user, "matches.create_log")
        create_data = payload.model_dump(exclude={"id"})
        existing = match_repository.get_log(session, payload.id) if payload.id is not None else None
        if existing is not None:
            if existing.event_id != event_id or existing.created_by != user.id:
                raise MatchLogConflictError("Match log id already belongs to another request")
            if any(getattr(existing, field) != value for field, value in create_data.items()):
                raise MatchLogConflictError("Match log id already belongs to another request")
            log = existing
        else:
            log = MatchLogEntry(id=payload.id, event_id=event_id, created_by=user.id, **create_data)
            match_repository.add(session, log)
    match_repository.refresh(session, log)
    return log


def list_match_logs(session: Session, event_id: UUID, user: User, after: UUID | None = None) -> list[MatchLogEntry]:
    event = _get_match_event(session, event_id)
    _ensure_event_visible(session, event, user, permission_code="MATCH_PERMISSION_DENIED")
    return match_repository.list_logs(session, event_id, after)


def delete_match_log(session: Session, log_id: UUID, user: User) -> None:
    with transaction_boundary(session):
        log = match_repository.get_log(session, log_id)
        if log is None:
            raise MatchLogNotFoundError()
        event = _get_match_event(session, log.event_id)
        _ensure_match_published(event)
        _require_match_admin(session, event, user, "matches.delete_log")
        match_repository.delete(session, log)


def match_log_counts(logs: list[MatchLogEntry]) -> dict[str, int]:
    counts = {entry_type.value: 0 for entry_type in MatchEntryType}
    for log in logs:
        counts[enum_value(log.entry_type)] += 1
    return counts


def live_board(session: Session, event_id: UUID, user: User) -> dict[str, object]:
    event = _get_match_event(session, event_id)
    _ensure_event_visible(session, event, user, permission_code="MATCH_PERMISSION_DENIED")
    logs = match_repository.list_logs(session, event_id, None)
    details = _get_match_details(session, event.id)
    return {
        "event": _read_event_with_details(session, event, details),
        "match_details": details,
        "logs": logs,
        "counts": match_log_counts(logs),
    }


def match_summary(session: Session, event_id: UUID, user: User) -> dict[str, object]:
    event = _get_match_event(session, event_id)
    _ensure_event_visible(session, event, user, permission_code="MATCH_PERMISSION_DENIED")
    logs = match_repository.list_logs(session, event_id, None)
    signups = match_repository.list_member_signups(session, event_id, event.team_id)
    rewards = match_repository.list_signup_rewards(session, event.team_id, event_id)
    details = _get_match_details(session, event.id)
    return {
        "event": _read_event_with_details(session, event, details),
        "match_details": details,
        "counts": match_log_counts(logs),
        "signups": [
            {"user_id": row.user_id, "status": enum_value(row.status), "updated_at": row.updated_at}
            for row in signups
        ],
        "rewards": [
            {"user_id": row.user_id, "amount": row.amount, "created_at": row.created_at}
            for row in rewards
        ],
    }
