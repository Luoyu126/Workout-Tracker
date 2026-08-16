from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import MembershipStatus, TeamStatus
from app.models import Organization, Team, TeamMembership, User


def list_my_organizations(session: Session, user: User) -> list[Organization]:
    stmt = (
        select(Organization)
        .join(Team, Team.organization_id == Organization.id)
        .join(TeamMembership, TeamMembership.team_id == Team.id)
        .where(
            TeamMembership.user_id == user.id,
            TeamMembership.status == MembershipStatus.active,
            Team.status == TeamStatus.active,
        )
        .distinct()
        .order_by(Organization.name)
    )
    return list(session.scalars(stmt))
