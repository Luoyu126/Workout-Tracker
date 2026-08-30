from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.common.enums import (
    MembershipRole,
    MembershipStatus,
    SignupStatus,
    TeamStatus,
    UserStatus,
    enum_value,
)
from app.common.permissions import PermissionDeniedError, role_at_least
from app.common.transactions import transaction_boundary
from app.models import Team, TeamMembership, User
from app.teams import queries, repository
from app.teams.eligibility import is_membership_eligible_for_event
from app.teams.errors import (
    DuplicateMembershipError,
    LastAdminError,
    MemberNotEligibleError,
    MembershipNotFoundError,
    TeamNotFoundError,
)
from app.teams.schemas import MembershipCreateRequest, MembershipUpdateRequest, TeamUpdateRequest


def _membership_matches_create_request(membership: TeamMembership, payload: MembershipCreateRequest) -> bool:
    return (
        membership.user_id == payload.user_id
        and enum_value(membership.role) == enum_value(payload.role)
        and membership.jersey_number == payload.jersey_number
        and membership.player_name == payload.player_name
        and enum_value(membership.status) == enum_value(payload.status)
    )


def get_active_membership(
    session: Session,
    team_id: UUID,
    user_id: UUID,
    require_active_team: bool = True,
    *,
    permission_code: str = "TEAM_PERMISSION_DENIED",
    operation: str = "teams.require_active_membership",
) -> TeamMembership:
    context = {"team_id": str(team_id), "user_id": str(user_id)}
    membership = repository.find_active_membership(session, team_id, user_id)
    if membership is None:
        raise PermissionDeniedError(
            "Active team membership is required",
            code=permission_code,
            operation=operation,
            context=context,
        )
    if require_active_team:
        team = repository.get_team(session, team_id)
        if team is None or team.status != TeamStatus.active:
            raise PermissionDeniedError(
                "Active team is required",
                code=permission_code,
                operation=operation,
                context=context,
            )
    return membership


def require_team_role(
    session: Session,
    team_id: UUID,
    user_id: UUID,
    required_role: MembershipRole,
    require_active_team: bool = True,
    *,
    permission_code: str = "TEAM_PERMISSION_DENIED",
    operation: str = "teams.require_role",
) -> TeamMembership:
    membership = get_active_membership(
        session,
        team_id,
        user_id,
        require_active_team=require_active_team,
        permission_code=permission_code,
        operation=operation,
    )
    if not role_at_least(membership.role, required_role):
        raise PermissionDeniedError(
            "Insufficient team role",
            code=permission_code,
            operation=operation,
            context={"team_id": str(team_id), "user_id": str(user_id)},
        )
    return membership


def list_my_teams(session: Session, user: User, status: TeamStatus | None = TeamStatus.active) -> list[Team]:
    return repository.list_teams_for_user(session, user.id, status)


def get_team_for_member(session: Session, team_id: UUID, user: User) -> Team:
    get_active_membership(session, team_id, user.id)
    team = repository.get_team(session, team_id)
    if team is None:
        raise TeamNotFoundError()
    return team


def update_team(session: Session, team_id: UUID, user: User, payload: TeamUpdateRequest) -> Team:
    with transaction_boundary(session):
        require_team_role(
            session,
            team_id,
            user.id,
            MembershipRole.admin,
            require_active_team=False,
        )
        team = repository.get_team(session, team_id)
        if team is None:
            raise TeamNotFoundError()
        update_data = payload.model_dump(exclude_unset=True)
        if team.status == TeamStatus.archived and update_data.get("status") != TeamStatus.active:
            raise PermissionDeniedError(
                "Archived teams can only be reactivated",
                code="TEAM_PERMISSION_DENIED",
                operation="teams.update_team",
                context={"team_id": str(team_id), "user_id": str(user.id)},
            )
        for field, value in update_data.items():
            setattr(team, field, value)
    repository.refresh(session, team)
    return team


def list_members(
    session: Session,
    team_id: UUID,
    user: User,
    role: MembershipRole | None = None,
    status: MembershipStatus | None = None,
) -> list[TeamMembership]:
    get_active_membership(session, team_id, user.id)
    return repository.list_memberships(session, team_id, role=role, status=status)


def get_member(session: Session, team_id: UUID, target_user_id: UUID, user: User) -> TeamMembership:
    get_active_membership(session, team_id, user.id)
    membership = repository.get_membership_with_user(session, team_id, target_user_id)
    if membership is None:
        raise MembershipNotFoundError()
    return membership


def add_member(
    session: Session,
    team_id: UUID,
    user: User,
    payload: MembershipCreateRequest,
) -> TeamMembership:
    with transaction_boundary(session):
        require_team_role(session, team_id, user.id, MembershipRole.admin)
        if repository.get_team(session, team_id) is None:
            raise TeamNotFoundError()
        target_user = repository.get_user(session, payload.user_id)
        if target_user is None:
            raise MembershipNotFoundError("User not found")
        if target_user.status != UserStatus.active:
            raise MemberNotEligibleError("Only active users can be added to a team")
        existing = repository.find_membership(session, team_id, payload.user_id)
        if existing is not None:
            if not _membership_matches_create_request(existing, payload):
                raise DuplicateMembershipError()
        else:
            membership_data = payload.model_dump()
            if payload.status == MembershipStatus.active:
                membership_data["joined_at"] = datetime.now(UTC)
            repository.add_membership(session, TeamMembership(team_id=team_id, **membership_data))
    membership = repository.get_membership_with_user(session, team_id, payload.user_id)
    if membership is None:
        raise MembershipNotFoundError()
    return membership


def list_member_candidates(session: Session, team_id: UUID, user: User, query: str, limit: int) -> list[User]:
    require_team_role(session, team_id, user.id, MembershipRole.admin)
    normalized_query = query.strip()
    if len(normalized_query) < 2:
        return []
    return repository.search_member_candidates(session, team_id, normalized_query, limit)


def update_member(
    session: Session,
    team_id: UUID,
    target_user_id: UUID,
    user: User,
    payload: MembershipUpdateRequest,
) -> TeamMembership:
    with transaction_boundary(session):
        require_team_role(session, team_id, user.id, MembershipRole.admin)
        membership = repository.get_membership_with_user(session, team_id, target_user_id)
        if membership is None:
            raise MembershipNotFoundError()
        update_data = payload.model_dump(exclude_unset=True)
        would_remove_active_admin = (
            membership.role == MembershipRole.admin
            and membership.status == MembershipStatus.active
            and (
                update_data.get("role", membership.role) != MembershipRole.admin
                or update_data.get("status", membership.status) != MembershipStatus.active
            )
        )
        if would_remove_active_admin:
            repository.lock_active_admin_memberships(session, team_id)
            if repository.count_active_admins(session, team_id) <= 1:
                raise LastAdminError()
        if "status" in update_data and "left_at" not in update_data:
            if update_data["status"] == MembershipStatus.inactive:
                update_data["left_at"] = datetime.now(UTC)
            elif update_data["status"] in {MembershipStatus.active, MembershipStatus.pending}:
                update_data["left_at"] = None
        if update_data.get("status") == MembershipStatus.active and membership.joined_at is None:
            update_data["joined_at"] = datetime.now(UTC)
        for field, value in update_data.items():
            setattr(membership, field, value)
    repository.refresh(session, membership)
    return membership


def count_active_admins(session: Session, team_id: UUID) -> int:
    return repository.count_active_admins(session, team_id)


def build_team_home(session: Session, team_id: UUID, user: User) -> dict[str, object]:
    team = get_team_for_member(session, team_id, user)
    current_membership = get_active_membership(session, team_id, user.id)
    admins = repository.list_memberships(
        session,
        team_id,
        role=MembershipRole.admin,
        status=MembershipStatus.active,
    )
    data = queries.load_team_home_data(session, team_id=team_id, user_id=user.id)
    signup_summary: dict[str, int] = {status.value: 0 for status in SignupStatus}
    for signup_status, count in data.signup_counts:
        signup_summary[enum_value(signup_status)] = count
    signup_summary["total"] = sum(count for _, count in data.signup_counts)
    return {
        "team": team,
        "current_membership": current_membership,
        "admins": admins,
        "member_count": data.member_count,
        "upcoming_events": [
            {
                "id": event.id,
                "type": enum_value(event.type),
                "title": event.title,
                "location": event.location,
                "start_time": event.start_time,
                "status": enum_value(event.status),
            }
            for event in data.upcoming_events
        ],
        "signup_summary": signup_summary,
        "coin_summary": {"balance": data.user_balance, "team_ledger_total": data.team_ledger_total},
    }


def _user_summary(user: User | None) -> dict[str, object] | None:
    if user is None:
        return None
    return {"id": user.id, "name": user.name, "email": user.email, "avatar_url": user.avatar_url}


def signup_board(
    session: Session,
    team_id: UUID,
    user: User,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
) -> list[dict[str, object]]:
    get_active_membership(session, team_id, user.id)
    data = queries.load_signup_board_data(
        session,
        team_id=team_id,
        starts_after=starts_after,
        starts_before=starts_before,
    )
    signup_by_event_and_user = {
        (signup.event_id, signup.user_id): signup.status for signup in data.signups
    }
    users_by_id = {row.id: row for row in data.users}
    board: dict[UUID, dict[str, object]] = {}
    for event in data.events:
        for membership in data.memberships:
            if not is_membership_eligible_for_event(membership, event):
                continue
            signup_status = signup_by_event_and_user.get(
                (event.id, membership.user_id),
                SignupStatus.maybe,
            )
            row = board.setdefault(
                membership.user_id,
                {
                    "user_id": membership.user_id,
                    "user": _user_summary(users_by_id.get(membership.user_id)),
                    "going": 0,
                    "maybe": 0,
                    "not_going": 0,
                    "total": 0,
                    "going_rate": 0.0,
                },
            )
            row[enum_value(signup_status)] = cast(int, row[enum_value(signup_status)]) + 1
            row["total"] = cast(int, row["total"]) + 1
    for row in board.values():
        total = cast(int, row["total"])
        going = cast(int, row["going"])
        row["going_rate"] = round(going / total, 4) if total else 0.0
    return sorted(board.values(), key=lambda row: (-cast(float, row["going_rate"]), str(row["user_id"])))
