from app.common.errors import AppError, PermissionDeniedError, ResourceNotFoundError


class UserNotSyncedError(ResourceNotFoundError):
    def __init__(self) -> None:
        super().__init__(code="USER_NOT_SYNCED", message="User has not been synced", operation="users.current_user")
        self.status_code = 401


class DisabledUserError(PermissionDeniedError):
    def __init__(self, _message: str = "User is disabled") -> None:
        super().__init__(message="User is disabled", code="USER_DISABLED", operation="users.require_active")


class PasswordResetUnavailableError(AppError):
    def __init__(self) -> None:
        super().__init__(
            "PASSWORD_RESET_UNAVAILABLE",
            "Password reset is not configured",
            503,
            "users.reset_initial_password",
        )


class AuthAccountNotFoundError(AppError):
    def __init__(self) -> None:
        super().__init__(
            "AUTH_ACCOUNT_NOT_FOUND",
            "No account exists for this email",
            400,
            "users.reset_initial_password",
            log_level="info",
        )


class PasswordResetFailedError(AppError):
    def __init__(self) -> None:
        super().__init__(
            "PASSWORD_RESET_FAILED",
            "Password reset failed",
            502,
            "users.reset_initial_password",
        )
