from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.attendance.schemas import (
    AttendanceBoardRow,
    AttendanceRead,
    AttendanceUpsertRequest,
    EventCompletionRead,
    EventCompletionRequest,
)
from app.attendance.service import (
    AttendanceStateError,
    attendance_board,
    complete_event,
    list_attendance,
    read_attendance_with_user,
    upsert_attendance,
)
from app.common.database import get_db
from app.common.permissions import PermissionDeniedError
from app.events.service import EventNotFoundError
from app.models import User
from app.users.router import current_user

router = APIRouter(prefix="/api/v1", tags=["attendance"])


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ATTENDANCE_PERMISSION_DENIED", "message": "Attendance permission denied"},
        )
    if isinstance(exc, EventNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "EVENT_NOT_FOUND", "message": "Event not found"},
        )
    if isinstance(exc, AttendanceStateError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "ATTENDANCE_STATE_CONFLICT", "message": str(exc)},
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": "INTERNAL_ERROR", "message": "Unexpected error"},
    )


@router.get("/events/{event_id}/attendance", response_model=list[AttendanceRead])
def read_attendance(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[dict[str, object]]:
    try:
        return list_attendance(session, event_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.put("/events/{event_id}/attendance/{user_id}", response_model=AttendanceRead)
def put_attendance(
    event_id: UUID,
    user_id: UUID,
    payload: AttendanceUpsertRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        attendance = upsert_attendance(session, event_id, user_id, user, payload.status, payload.note)
        return read_attendance_with_user(session, attendance.id)
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


@router.get("/teams/{team_id}/attendance-board", response_model=list[AttendanceBoardRow])
def read_attendance_board(
    team_id: UUID,
    starts_after: datetime | None = Query(default=None),
    starts_before: datetime | None = Query(default=None),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[dict[str, object]]:
    try:
        return attendance_board(session, team_id, user, starts_after, starts_before)
    except Exception as exc:
        raise _to_http_error(exc) from exc
