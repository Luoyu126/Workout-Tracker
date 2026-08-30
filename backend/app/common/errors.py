from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException

PERMISSION_MESSAGES = {
    "TEAM_PERMISSION_DENIED": "Team permission denied",
    "EVENT_PERMISSION_DENIED": "Event permission denied",
    "MATCH_PERMISSION_DENIED": "Match permission denied",
    "COIN_PERMISSION_DENIED": "Coin permission denied",
    "STORE_PERMISSION_DENIED": "Store permission denied",
    "NOTIFICATION_PERMISSION_DENIED": "Notification permission denied",
}


@dataclass
class AppError(HTTPException):
    """Expected application failure that is safe to expose to API clients."""

    code: str
    message: str
    status_code: int
    operation: str
    context: dict[str, Any] = field(default_factory=dict)
    log_level: str = "warning"

    def __post_init__(self) -> None:
        super().__init__(
            status_code=self.status_code,
            detail={"code": self.code, "message": self.message},
        )

    def __str__(self) -> str:
        return self.message


class ResourceNotFoundError(AppError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        operation: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(code, message, 404, operation, context or {}, "info")


class PermissionDeniedError(AppError):
    def __init__(
        self,
        message: str = "Permission denied",
        *,
        code: str = "PERMISSION_DENIED",
        operation: str = "permissions.require_access",
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            code,
            PERMISSION_MESSAGES.get(code, message),
            403,
            operation,
            context or {},
            "warning",
        )


class ConflictError(AppError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        operation: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(code, message, 409, operation, context or {}, "warning")


class BusinessRuleError(ConflictError):
    pass
