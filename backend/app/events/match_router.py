from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.dependencies import current_user
from app.events.match_schemas import (
    LiveBoardRead,
    MatchLogEntryCreateRequest,
    MatchLogEntryRead,
    MatchSummaryRead,
)
from app.events.match_service import (
    create_match_log,
    delete_match_log,
    list_match_logs,
    live_board,
    match_summary,
)
from app.models import MatchLogEntry, User

router = APIRouter(prefix="/api/v1", tags=["matches"])


@router.post("/events/{event_id}/match-logs", response_model=MatchLogEntryRead, status_code=status.HTTP_201_CREATED)
def post_match_log(
    event_id: UUID,
    payload: MatchLogEntryCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> MatchLogEntry:
    return create_match_log(session, event_id, user, payload)


@router.get("/events/{event_id}/match-logs", response_model=list[MatchLogEntryRead])
def read_match_logs(
    event_id: UUID,
    after: UUID | None = Query(default=None),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[MatchLogEntry]:
    return list_match_logs(session, event_id, user, after)


@router.delete("/match-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_match_log_route(
    log_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> None:
    delete_match_log(session, log_id, user)


@router.get("/events/{event_id}/live-board", response_model=LiveBoardRead)
def read_live_board(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    return live_board(session, event_id, user)


@router.get("/events/{event_id}/summary", response_model=MatchSummaryRead)
def read_match_summary(
    event_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    return match_summary(session, event_id, user)
