from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.dependencies import current_user
from app.common.enums import EventStatus, EventType, SignupStatus
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

router = APIRouter(prefix="/api/v1", tags=["events"])


@router.post("/teams/{team_id}/events", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def post_event(
    team_id: UUID,
    payload: EventCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Event:
    return create_event(session, team_id, user, payload)


@router.post("/teams/{team_id}/matches", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def post_match(
    team_id: UUID,
    payload: MatchCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    event = create_match(session, team_id, user, payload)
    return get_event_detail(session, event.id, user)


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
    return list_events(session, team_id, user, event_type, event_status, starts_after, starts_before)


@router.get("/events/{event_id}", response_model=EventRead)
def read_event(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    return get_event_detail(session, event_id, user)


@router.patch("/events/{event_id}", response_model=EventRead)
def patch_event(
    event_id: UUID,
    payload: EventUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    event = update_event(session, event_id, user, payload)
    return get_event_detail(session, event.id, user)


@router.post("/events/{event_id}/complete", response_model=EventCompletionRead)
def post_complete_event(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    payload: EventCompletionRequest | None = None,
) -> dict[str, object]:
    return complete_event(session, event_id, user, payload or EventCompletionRequest())


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event_route(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> None:
    delete_event(session, event_id, user)


@router.get("/events/{event_id}/signup", response_model=EventSignupRead)
def read_my_signup(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> EventSignup | dict[str, object]:
    return get_my_signup(session, event_id, user)


@router.put("/events/{event_id}/signup", response_model=EventSignupRead)
def put_my_signup(
    event_id: UUID,
    payload: EventSignupUpsertRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> EventSignup:
    return upsert_my_signup(session, event_id, user, payload)


@router.get("/events/{event_id}/signups", response_model=list[EventSignupRead])
def read_signups(
    event_id: UUID,
    signup_status: SignupStatus | None = Query(default=None, alias="status"),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return list_signups(session, event_id, user, signup_status)
