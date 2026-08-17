from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.common.enums import (
    EventStatus,
    MembershipRole,
    MembershipStatus,
    SignupStatus,
    TeamStatus,
    UserStatus,
    enum_value,
)
from app.common.permissions import PermissionDeniedError, role_at_least
from app.models import CoinTransaction, Event, EventSignup, Team, TeamMembership, User
from app.teams.schemas import MembershipCreateRequest, MembershipUpdateRequest, TeamUpdateRequest


class TeamNotFoundError(Exception):
    pass


class MembershipNotFoundError(Exception):
    pass


class DuplicateMembershipError(Exception):
    pass


class MemberNotEligibleError(Exception):
    pass


class LastAdminError(Exception):
    pass


def _membership_matches_create_request(membership: TeamMembership, payload: MembershipCreateRequest) -> bool:
    return (
        membership.user_id == payload.user_id
        and enum_value(membership.role) == enum_value(payload.role)
        and membership.jersey_number == payload.jersey_number
        and membership.position == payload.position
        and enum_value(membership.status) == enum_value(payload.status)
    )


def get_active_membership(
    session: Session,
    team_id: UUID,
    user_id: UUID,
    require_active_team: bool = True,
) -> TeamMembership:
    membership = session.scalar(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
            TeamMembership.status == MembershipStatus.active,
        )
    )
    if membership is None:
        raise PermissionDeniedError("Active team membership is required")
    if require_active_team:
        team = session.get(Team, team_id)
        if team is None or team.status != TeamStatus.active:
            raise PermissionDeniedError("Active team is required")
    return membership


def require_team_role(
    session: Session,
    team_id: UUID,
    user_id: UUID,
    required_role: MembershipRole,
    require_active_team: bool = True,
) -> TeamMembership:
    membership = get_active_membership(session, team_id, user_id, require_active_team=require_active_team)
    if not role_at_least(membership.role, required_role):
        raise PermissionDeniedError("Insufficient team role")
    return membership


def list_my_teams(session: Session, user: User, status: TeamStatus | None = TeamStatus.active) -> list[Team]:
    stmt = (
        select(Team)
        .join(TeamMembership, TeamMembership.team_id == Team.id)
        .where(
            TeamMembership.user_id == user.id,
            TeamMembership.status == MembershipStatus.active,
        )
        .order_by(Team.name)
    )
    if status is not None:
        stmt = stmt.where(Team.status == status)
    return list(session.scalars(stmt))


def get_team_for_member(session: Session, team_id: UUID, user: User) -> Team:
    get_active_membership(session, team_id, user.id)
    team = session.get(Team, team_id)
    if team is None:
        raise TeamNotFoundError("Team not found")
    return team


def update_team(session: Session, team_id: UUID, user: User, payload: TeamUpdateRequest) -> Team:
    membership = require_team_role(
        session,
        team_id,
        user.id,
        MembershipRole.captain,
        require_active_team=False,
    )
    team = session.get(Team, team_id)
    if team is None:
        raise TeamNotFoundError("Team not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "status" in update_data and not role_at_least(membership.role, MembershipRole.admin):
        raise PermissionDeniedError("Only admins can update team status")
    if team.status == TeamStatus.archived and update_data.get("status") != TeamStatus.active:
        raise PermissionDeniedError("Archived teams can only be reactivated")

    for field, value in update_data.items():
        setattr(team, field, value)
    session.commit()
    session.refresh(team)
    return team


def list_members(
    session: Session,
    team_id: UUID,
    user: User,
    role: MembershipRole | None = None,
    status: MembershipStatus | None = None,
) -> list[TeamMembership]:
    get_active_membership(session, team_id, user.id)
    stmt = (
        select(TeamMembership)
        .options(selectinload(TeamMembership.user))
        .where(TeamMembership.team_id == team_id)
        .order_by(TeamMembership.created_at)
    )
    if role is not None:
        stmt = stmt.where(TeamMembership.role == role)
    if status is not None:
        stmt = stmt.where(TeamMembership.status == status)
    return list(session.scalars(stmt))


def get_member(session: Session, team_id: UUID, target_user_id: UUID, user: User) -> TeamMembership:
    get_active_membership(session, team_id, user.id)
    membership = session.scalar(
        select(TeamMembership)
        .options(selectinload(TeamMembership.user))
        .where(TeamMembership.team_id == team_id, TeamMembership.user_id == target_user_id)
    )
    if membership is None:
        raise MembershipNotFoundError("Membership not found")
    return membership


def add_member(
    session: Session,
    team_id: UUID,
    user: User,
    payload: MembershipCreateRequest,
) -> TeamMembership:
    require_team_role(session, team_id, user.id, MembershipRole.admin)
    if session.get(Team, team_id) is None:
        raise TeamNotFoundError("Team not found")
    target_user = session.get(User, payload.user_id)
    if target_user is None:
        raise MembershipNotFoundError("User not found")
    if target_user.status != UserStatus.active:
        raise MemberNotEligibleError("Only active users can be added to a team")
    existing = session.scalar(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == payload.user_id,
        )
    )
    if existing is not None:
        if _membership_matches_create_request(existing, payload):
            return get_member(session, team_id, payload.user_id, user)
        raise DuplicateMembershipError("Membership already exists")

    membership = TeamMembership(team_id=team_id, **payload.model_dump())
    session.add(membership)
    session.commit()
    session.refresh(membership)
    return get_member(session, team_id, payload.user_id, user)


def list_member_candidates(session: Session, team_id: UUID, user: User, query: str, limit: int) -> list[User]:
    require_team_role(session, team_id, user.id, MembershipRole.admin)
    normalized_query = query.strip()
    if len(normalized_query) < 2:
        return []

    pattern = f"%{normalized_query}%"
    existing_membership = (
        select(TeamMembership.id)
        .where(TeamMembership.team_id == team_id, TeamMembership.user_id == User.id)
        .exists()
    )
    return list(
        session.scalars(
            select(User)
            .where(
                User.status == UserStatus.active,
                ~existing_membership,
                or_(
                    User.name.ilike(pattern),
                    User.email.ilike(pattern),
                    User.student_id.ilike(pattern),
                ),
            )
            .order_by(User.name, User.email)
            .limit(limit)
        )
    )


def update_member(
    session: Session,
    team_id: UUID,
    target_user_id: UUID,
    user: User,
    payload: MembershipUpdateRequest,
) -> TeamMembership:
    require_team_role(session, team_id, user.id, MembershipRole.admin)
    membership = session.scalar(
        select(TeamMembership)
        .options(selectinload(TeamMembership.user))
        .where(TeamMembership.team_id == team_id, TeamMembership.user_id == target_user_id)
    )
    if membership is None:
        raise MembershipNotFoundError("Membership not found")

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
        _lock_active_admin_memberships(session, team_id)
    if would_remove_active_admin and count_active_admins(session, team_id) <= 1:
        raise LastAdminError("Team must keep at least one active admin")

    if "status" in update_data and "left_at" not in update_data:
        if update_data["status"] == MembershipStatus.inactive:
            update_data["left_at"] = datetime.now(UTC)
        elif update_data["status"] in {MembershipStatus.active, MembershipStatus.pending}:
            update_data["left_at"] = None

    for field, value in update_data.items():
        setattr(membership, field, value)
    session.commit()
    session.refresh(membership)
    return membership


def count_active_admins(session: Session, team_id: UUID) -> int:
    return session.scalar(
        select(func.count()).select_from(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.role == MembershipRole.admin,
            TeamMembership.status == MembershipStatus.active,
        )
    ) or 0


def _lock_active_admin_memberships(session: Session, team_id: UUID) -> None:
    session.execute(
        select(TeamMembership.id)
        .where(
            TeamMembership.team_id == team_id,
            TeamMembership.role == MembershipRole.admin,
            TeamMembership.status == MembershipStatus.active,
        )
        .with_for_update()
    ).all()


def build_team_home(session: Session, team_id: UUID, user: User) -> dict[str, object]:
    team = get_team_for_member(session, team_id, user)
    current_membership = get_active_membership(session, team_id, user.id)
    captains = list_members(
        session,
        team_id,
        user,
        role=MembershipRole.captain,
        status=MembershipStatus.active,
    )
    member_count = session.scalar(
        select(func.count()).select_from(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.status == MembershipStatus.active,
        )
    ) or 0

    now = datetime.now(UTC)
    upcoming_events = [
        {
            "id": event.id,
            "type": enum_value(event.type),
            "title": event.title,
            "location": event.location,
            "start_time": event.start_time,
            "status": enum_value(event.status),
        }
        for event in session.scalars(
            select(Event)
            .where(
                Event.team_id == team_id,
                Event.status == EventStatus.published,
                Event.start_time >= now,
            )
            .order_by(Event.start_time)
            .limit(5)
        )
    ]

    signup_summary: dict[str, int] = {status.value: 0 for status in SignupStatus}
    signup_rows = session.execute(
        select(EventSignup.status, func.count().label("count"))
        .join(Event, Event.id == EventSignup.event_id)
        .where(Event.team_id == team_id, Event.status == EventStatus.completed)
        .group_by(EventSignup.status)
    )
    total_signups = 0
    for status, count in signup_rows:
        signup_summary[enum_value(status)] = count
        total_signups += count
    signup_summary["total"] = total_signups

    user_balance = session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.team_id == team_id,
            CoinTransaction.user_id == user.id,
        )
    ) or 0
    team_ledger_total = session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.team_id == team_id
        )
    ) or 0
    return {
        "team": team,
        "current_membership": current_membership,
        "captains": captains,
        "member_count": member_count,
        "upcoming_events": upcoming_events,
        "signup_summary": signup_summary,
        "coin_summary": {"balance": user_balance, "team_ledger_total": team_ledger_total},
    }


def _user_summary(user: User | None) -> dict[str, object] | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "avatar_url": user.avatar_url,
    }


def signup_board(
    session: Session,
    team_id: UUID,
    user: User,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
) -> list[dict[str, object]]:
    get_active_membership(session, team_id, user.id)
    stmt = select(Event).where(Event.team_id == team_id, Event.status == EventStatus.completed)
    if starts_after is not None:
        stmt = stmt.where(Event.start_time >= starts_after)
    if starts_before is not None:
        stmt = stmt.where(Event.start_time <= starts_before)
    completed_events = list(session.scalars(stmt.order_by(Event.start_time)).all())

    board: dict[UUID, dict[str, object]] = {}
    for event in completed_events:
        eligible_member_ids = list(
            session.scalars(
                select(TeamMembership.user_id).where(
                    TeamMembership.team_id == event.team_id,
                    TeamMembership.joined_at <= event.start_time,
                    (
                        (TeamMembership.status == MembershipStatus.active)
                        | (
                            TeamMembership.left_at.is_not(None)
                            & (TeamMembership.left_at >= event.start_time)
                        )
                    ),
                )
            ).all()
        )
        signup_by_user_id = {
            signup.user_id: signup.status
            for signup in session.scalars(
                select(EventSignup).where(EventSignup.event_id == event.id)
            ).all()
        }
        for member_id in eligible_member_ids:
            status = signup_by_user_id.get(member_id, SignupStatus.maybe)
            row = board.setdefault(
                member_id,
                {
                    "user_id": member_id,
                    "user": None,
                    "going": 0,
                    "maybe": 0,
                    "not_going": 0,
                    "total": 0,
                    "going_rate": 0.0,
                },
            )
            row[enum_value(status)] = cast(int, row[enum_value(status)]) + 1
            row["total"] = cast(int, row["total"]) + 1

    user_ids = set(board.keys())
    users_by_id = {
        row.id: row for row in session.scalars(select(User).where(User.id.in_(user_ids))).all()
    } if user_ids else {}
    for user_id, row in board.items():
        row["user"] = _user_summary(users_by_id.get(user_id))
        total = cast(int, row["total"])
        going = cast(int, row["going"])
        row["going_rate"] = round(going / total, 4) if total > 0 else 0.0
    return sorted(board.values(), key=lambda row: (-cast(float, row["going_rate"]), str(row["user_id"])))
