"""Generic permission primitives.

Domain-specific policy belongs in each domain service.
"""

from app.common.enums import MembershipRole


class PermissionDeniedError(Exception):
    pass


ROLE_RANK: dict[MembershipRole, int] = {
    MembershipRole.member: 1,
    MembershipRole.captain: 2,
    MembershipRole.admin: 3,
}


def role_at_least(actual: MembershipRole, required: MembershipRole) -> bool:
    return ROLE_RANK[actual] >= ROLE_RANK[required]
