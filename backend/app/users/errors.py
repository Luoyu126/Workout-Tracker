from app.common.errors import PermissionDeniedError, ResourceNotFoundError


class UserNotSyncedError(ResourceNotFoundError):
    def __init__(self) -> None:
        super().__init__(code="USER_NOT_SYNCED", message="User has not been synced", operation="users.current_user")
        self.status_code = 401


class DisabledUserError(PermissionDeniedError):
    def __init__(self, _message: str = "User is disabled") -> None:
        super().__init__(message="User is disabled", code="USER_DISABLED", operation="users.require_active")
