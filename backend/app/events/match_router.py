from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.permissions import PermissionDeniedError
from app.events.match_schemas import (
    LiveBoardRead,
    MatchLogEntryCreateRequest,
    MatchLogEntryRead,
    MatchSummaryRead,
)
from app.events.match_service import (
    MatchLogConflictError,
    MatchLogNotFoundError,
    MatchStateError,
    create_match_log,
    delete_match_log,
    list_match_logs,
    live_board,
    match_summary,
)
from app.events.service import EventNotFoundError
from app.models import MatchLogEntry, User
from app.users.router import current_user

router = APIRouter(prefix="/api/v1", tags=["matches"])


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "MATCH_PERMISSION_DENIED", "message": "Match permission denied"},
        )
    if isinstance(exc, (EventNotFoundError, MatchLogNotFoundError)):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "MATCH_RESOURCE_NOT_FOUND", "message": "Resource not found"},
        )
    if isinstance(exc, MatchStateError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MATCH_STATE_CONFLICT", "message": str(exc)},
        )
    if isinstance(exc, MatchLogConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MATCH_LOG_CONFLICT", "message": str(exc)},
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": "INTERNAL_ERROR", "message": "Unexpected error"},
    )


@router.post("/events/{event_id}/match-logs", response_model=MatchLogEntryRead, status_code=status.HTTP_201_CREATED)
def post_match_log(
    event_id: UUID,
    payload: MatchLogEntryCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> MatchLogEntry:
    try:
        return create_match_log(session, event_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/events/{event_id}/match-logs", response_model=list[MatchLogEntryRead])
def read_match_logs(
    event_id: UUID,
    after: UUID | None = Query(default=None),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[MatchLogEntry]:
    try:
        return list_match_logs(session, event_id, user, after)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.delete("/match-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_match_log_route(
    log_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> None:
    try:
        delete_match_log(session, log_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/events/{event_id}/live-board", response_model=LiveBoardRead)
def read_live_board(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        return live_board(session, event_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/events/{event_id}/summary", response_model=MatchSummaryRead)
def read_match_summary(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        return match_summary(session, event_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc
