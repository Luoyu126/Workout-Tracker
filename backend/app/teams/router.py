from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.dependencies import current_user
from app.common.enums import MembershipRole, MembershipStatus, TeamStatus
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

router = APIRouter(prefix="/api/v1", tags=["teams"])


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
    return build_team_home(session, team_id, user)


@router.get("/teams/{team_id}/signup-board", response_model=list[SignupBoardRow])
def read_signup_board(
    team_id: UUID,
    starts_after: datetime | None = Query(default=None),
    starts_before: datetime | None = Query(default=None),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[dict[str, object]]:
    return signup_board(session, team_id, user, starts_after, starts_before)


@router.get("/teams/{team_id}", response_model=TeamRead)
def read_team(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Team:
    return get_team_for_member(session, team_id, user)


@router.patch("/teams/{team_id}", response_model=TeamRead)
def patch_team(
    team_id: UUID,
    payload: TeamUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Team:
    return update_team(session, team_id, user, payload)


@router.get("/teams/{team_id}/members", response_model=list[MembershipRead])
def read_members(
    team_id: UUID,
    role: MembershipRole | None = None,
    membership_status: MembershipStatus | None = Query(default=None, alias="status"),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[TeamMembership]:
    return list_members(session, team_id, user, role, membership_status)


@router.get("/teams/{team_id}/member-candidates", response_model=list[MemberCandidateRead])
def read_member_candidates(
    team_id: UUID,
    query: str = Query(default="", min_length=0, max_length=120),
    limit: int = Query(default=10, ge=1, le=25),
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[User]:
    return list_member_candidates(session, team_id, user, query, limit)


@router.post("/teams/{team_id}/members", response_model=MembershipRead, status_code=status.HTTP_201_CREATED)
def post_member(
    team_id: UUID,
    payload: MembershipCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> TeamMembership:
    return add_member(session, team_id, user, payload)


@router.get("/teams/{team_id}/members/{user_id}", response_model=MembershipRead)
def read_member(
    team_id: UUID,
    user_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> TeamMembership:
    return get_member(session, team_id, user_id, user)


@router.patch("/teams/{team_id}/members/{user_id}", response_model=MembershipRead)
def patch_member(
    team_id: UUID,
    user_id: UUID,
    payload: MembershipUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> TeamMembership:
    return update_member(session, team_id, user_id, user, payload)
