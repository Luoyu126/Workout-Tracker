from app.common.errors import BusinessRuleError, ConflictError, ResourceNotFoundError


class TeamNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Team not found") -> None:
        super().__init__(code="TEAM_RESOURCE_NOT_FOUND", message="Resource not found", operation="teams.get_team")


class MembershipNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Membership not found") -> None:
        super().__init__(
            code="TEAM_RESOURCE_NOT_FOUND",
            message="Resource not found",
            operation="teams.get_membership",
        )


class DuplicateMembershipError(ConflictError):
    def __init__(self, _message: str = "Membership already exists") -> None:
        super().__init__(
            code="DUPLICATE_MEMBERSHIP",
            message="Membership already exists",
            operation="teams.add_member",
        )


class MemberNotEligibleError(BusinessRuleError):
    def __init__(self, message: str) -> None:
        super().__init__(code="MEMBER_NOT_ELIGIBLE", message=message, operation="teams.update_member")


class LastAdminError(ConflictError):
    def __init__(self, _message: str = "Team must keep one active admin") -> None:
        super().__init__(
            code="LAST_ADMIN_REQUIRED",
            message="Team must keep one active admin",
            operation="teams.update_member",
        )
