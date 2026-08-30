"""Generic permission primitives.

Domain-specific policy belongs in each domain service.
"""

from app.common.enums import MembershipRole
from app.common.errors import PermissionDeniedError

__all__ = ["PermissionDeniedError", "role_at_least"]


ROLE_RANK: dict[MembershipRole, int] = {
    MembershipRole.member: 1,
    MembershipRole.admin: 2,
}


def role_at_least(actual: MembershipRole, required: MembershipRole) -> bool:
    return ROLE_RANK[actual] >= ROLE_RANK[required]
