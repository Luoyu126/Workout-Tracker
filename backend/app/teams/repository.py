from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.common.enums import MembershipRole, MembershipStatus, TeamStatus, UserStatus
from app.models import Team, TeamMembership, User


def get_team(session: Session, team_id: UUID) -> Team | None:
    return session.get(Team, team_id)


def get_team_for_update(session: Session, team_id: UUID) -> Team | None:
    return session.scalar(select(Team).where(Team.id == team_id).with_for_update())


def get_user(session: Session, user_id: UUID) -> User | None:
    return session.get(User, user_id)


def find_membership(session: Session, team_id: UUID, user_id: UUID) -> TeamMembership | None:
    return session.scalar(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
        )
    )


def find_membership_for_update(
    session: Session,
    team_id: UUID,
    user_id: UUID,
) -> TeamMembership | None:
    return session.scalar(
        select(TeamMembership)
        .where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
        )
        .with_for_update()
    )


def find_active_membership(session: Session, team_id: UUID, user_id: UUID) -> TeamMembership | None:
    return session.scalar(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
            TeamMembership.status == MembershipStatus.active,
        )
    )


def get_membership_with_user(
    session: Session,
    team_id: UUID,
    user_id: UUID,
) -> TeamMembership | None:
    return session.scalar(
        select(TeamMembership)
        .options(selectinload(TeamMembership.user))
        .where(TeamMembership.team_id == team_id, TeamMembership.user_id == user_id)
    )


def list_teams_for_user(
    session: Session,
    user_id: UUID,
    status: TeamStatus | None,
) -> list[Team]:
    stmt = (
        select(Team)
        .join(TeamMembership, TeamMembership.team_id == Team.id)
        .where(
            TeamMembership.user_id == user_id,
            TeamMembership.status == MembershipStatus.active,
        )
        .order_by(Team.name)
    )
    if status is not None:
        stmt = stmt.where(Team.status == status)
    return list(session.scalars(stmt))


def list_memberships(
    session: Session,
    team_id: UUID,
    *,
    role: MembershipRole | None = None,
    status: MembershipStatus | None = None,
) -> list[TeamMembership]:
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


def list_member_memberships(session: Session, team_id: UUID) -> list[TeamMembership]:
    return list(
        session.scalars(
            select(TeamMembership).where(
                TeamMembership.team_id == team_id,
                TeamMembership.role == MembershipRole.member,
            )
        ).all()
    )


def list_active_user_ids(session: Session, team_id: UUID) -> list[UUID]:
    return list(
        session.scalars(
            select(TeamMembership.user_id).where(
                TeamMembership.team_id == team_id,
                TeamMembership.status == MembershipStatus.active,
            )
        ).all()
    )


def search_member_candidates(
    session: Session,
    team_id: UUID,
    query: str,
    limit: int,
) -> list[User]:
    pattern = f"%{query}%"
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
                or_(User.name.ilike(pattern), User.email.ilike(pattern), User.student_id.ilike(pattern)),
            )
            .order_by(User.name, User.email)
            .limit(limit)
        )
    )


def count_active_admins(session: Session, team_id: UUID) -> int:
    return session.scalar(
        select(func.count()).select_from(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.role == MembershipRole.admin,
            TeamMembership.status == MembershipStatus.active,
        )
    ) or 0


def lock_active_admin_memberships(session: Session, team_id: UUID) -> None:
    session.execute(
        select(TeamMembership.id)
        .where(
            TeamMembership.team_id == team_id,
            TeamMembership.role == MembershipRole.admin,
            TeamMembership.status == MembershipStatus.active,
        )
        .with_for_update()
    ).all()


def add_membership(session: Session, membership: TeamMembership) -> None:
    session.add(membership)


def flush(session: Session) -> None:
    session.flush()


def refresh(session: Session, value: object) -> None:
    session.refresh(value)
