from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.enums import EventStatus, EventType, SignupStatus
from app.common.permissions import PermissionDeniedError
from app.events.schemas import (
    EventCompletionRead,
    EventCompletionRequest,
    EventCreateRequest,
    EventRead,
    EventSignupRead,
    EventSignupUpsertRequest,
    EventUpdateRequest,
    MatchCreateRequest,
)
from app.events.service import (
    EventConflictError,
    EventNotFoundError,
    EventStateError,
    SignupRuleError,
    complete_event,
    create_event,
    create_match,
    delete_event,
    get_event_detail,
    get_my_signup,
    list_events,
    list_signups,
    update_event,
    upsert_my_signup,
)
from app.models import Event, EventSignup, User
from app.users.router import current_user

router = APIRouter(prefix="/api/v1", tags=["events"])


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "EVENT_PERMISSION_DENIED", "message": "Event permission denied"},
        )
    if isinstance(exc, EventNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "EVENT_NOT_FOUND", "message": "Event not found"},
        )
    if isinstance(exc, EventConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EVENT_CONFLICT", "message": str(exc)},
        )
    if isinstance(exc, (EventStateError, SignupRuleError)):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EVENT_STATE_CONFLICT", "message": str(exc)},
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": "INTERNAL_ERROR", "message": "Unexpected error"},
    )


@router.post("/teams/{team_id}/events", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def post_event(
    team_id: UUID,
    payload: EventCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Event:
    try:
        return create_event(session, team_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/teams/{team_id}/matches", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def post_match(
    team_id: UUID,
    payload: MatchCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        event = create_match(session, team_id, user, payload)
        return get_event_detail(session, event.id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/events", response_model=list[EventRead])
def read_events(
    team_id: UUID,
    event_type: EventType | None = Query(default=None, alias="type"),
    event_status: EventStatus | None = Query(default=None, alias="status"),
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[dict[str, object]]:
    try:
        return list_events(session, team_id, user, event_type, event_status, starts_after, starts_before)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/events/{event_id}", response_model=EventRead)
def read_event(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        return get_event_detail(session, event_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.patch("/events/{event_id}", response_model=EventRead)
def patch_event(
    event_id: UUID,
    payload: EventUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        event = update_event(session, event_id, user, payload)
        return get_event_detail(session, event.id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/events/{event_id}/complete", response_model=EventCompletionRead)
def post_complete_event(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    payload: EventCompletionRequest | None = None,
) -> dict[str, object]:
    try:
        return complete_event(session, event_id, user, payload or EventCompletionRequest())
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event_route(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> None:
    try:
        delete_event(session, event_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/events/{event_id}/signup", response_model=EventSignupRead)
def read_my_signup(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> EventSignup | dict[str, object]:
    try:
        return get_my_signup(session, event_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.put("/events/{event_id}/signup", response_model=EventSignupRead)
def put_my_signup(
    event_id: UUID,
    payload: EventSignupUpsertRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> EventSignup:
    try:
        return upsert_my_signup(session, event_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/events/{event_id}/signups", response_model=list[EventSignupRead])
def read_signups(
    event_id: UUID,
    signup_status: SignupStatus | None = Query(default=None, alias="status"),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[dict[str, object]]:
    try:
        return list_signups(session, event_id, user, signup_status)
    except Exception as exc:
        raise _to_http_error(exc) from exc
