from datetime import UTC, datetime

from app.common.enums import MembershipRole, MembershipStatus
from app.models import Event, TeamMembership


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def is_membership_active_member_at(membership: TeamMembership, at: datetime) -> bool:
    return (
        membership.role == MembershipRole.member
        and membership.status == MembershipStatus.active
        and membership.joined_at is not None
        and _as_utc(membership.joined_at) <= _as_utc(at)
    )


def is_membership_eligible_for_event(membership: TeamMembership, event: Event) -> bool:
    return is_membership_active_member_at(membership, event.start_time)
