from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.enums import MembershipRole, MembershipStatus, TeamStatus
from app.common.permissions import PermissionDeniedError
from app.models import Team, TeamMembership, User
from app.teams.schemas import (
    MemberCandidateRead,
    MembershipCreateRequest,
    MembershipRead,
    MembershipUpdateRequest,
    SignupBoardRow,
    TeamHomeRead,
    TeamRead,
    TeamUpdateRequest,
)
from app.teams.service import (
    DuplicateMembershipError,
    LastAdminError,
    MemberNotEligibleError,
    MembershipNotFoundError,
    TeamNotFoundError,
    add_member,
    build_team_home,
    get_member,
    get_team_for_member,
    list_member_candidates,
    list_members,
    list_my_teams,
    signup_board,
    update_member,
    update_team,
)
from app.users.router import current_user

router = APIRouter(prefix="/api/v1", tags=["teams"])


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "TEAM_PERMISSION_DENIED", "message": "Team permission denied"},
        )
    if isinstance(exc, (TeamNotFoundError, MembershipNotFoundError)):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "TEAM_RESOURCE_NOT_FOUND", "message": "Resource not found"},
        )
    if isinstance(exc, DuplicateMembershipError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "DUPLICATE_MEMBERSHIP", "message": "Membership already exists"},
        )
    if isinstance(exc, MemberNotEligibleError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEMBER_NOT_ELIGIBLE", "message": str(exc)},
        )
    if isinstance(exc, LastAdminError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LAST_ADMIN_REQUIRED", "message": "Team must keep one active admin"},
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": "INTERNAL_ERROR", "message": "Unexpected error"},
    )


@router.get("/teams", response_model=list[TeamRead])
def read_my_teams(
    status_filter: TeamStatus | None = Query(default=TeamStatus.active, alias="status"),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[Team]:
    return list_my_teams(session, user, status_filter)


@router.get("/teams/{team_id}/home", response_model=TeamHomeRead)
def read_team_home(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        return build_team_home(session, team_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/signup-board", response_model=list[SignupBoardRow])
def read_signup_board(
    team_id: UUID,
    starts_after: datetime | None = Query(default=None),
    starts_before: datetime | None = Query(default=None),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[dict[str, object]]:
    try:
        return signup_board(session, team_id, user, starts_after, starts_before)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}", response_model=TeamRead)
def read_team(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Team:
    try:
        return get_team_for_member(session, team_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.patch("/teams/{team_id}", response_model=TeamRead)
def patch_team(
    team_id: UUID,
    payload: TeamUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Team:
    try:
        return update_team(session, team_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/members", response_model=list[MembershipRead])
def read_members(
    team_id: UUID,
    role: MembershipRole | None = None,
    membership_status: MembershipStatus | None = Query(default=None, alias="status"),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[TeamMembership]:
    try:
        return list_members(session, team_id, user, role, membership_status)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/member-candidates", response_model=list[MemberCandidateRead])
def read_member_candidates(
    team_id: UUID,
    query: str = Query(default="", min_length=0, max_length=120),
    limit: int = Query(default=10, ge=1, le=25),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[User]:
    try:
        return list_member_candidates(session, team_id, user, query, limit)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/teams/{team_id}/members", response_model=MembershipRead, status_code=status.HTTP_201_CREATED)
def post_member(
    team_id: UUID,
    payload: MembershipCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> TeamMembership:
    try:
        return add_member(session, team_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/members/{user_id}", response_model=MembershipRead)
def read_member(
    team_id: UUID,
    user_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> TeamMembership:
    try:
        return get_member(session, team_id, user_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.patch("/teams/{team_id}/members/{user_id}", response_model=MembershipRead)
def patch_member(
    team_id: UUID,
    user_id: UUID,
    payload: MembershipUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> TeamMembership:
    try:
        return update_member(session, team_id, user_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc
