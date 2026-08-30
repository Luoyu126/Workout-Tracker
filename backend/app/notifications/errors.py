from app.common.errors import ConflictError, ResourceNotFoundError


class NotificationNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Notification not found") -> None:
        super().__init__(
            code="NOTIFICATION_RESOURCE_NOT_FOUND",
            message="Resource not found",
            operation="notifications.get_notification",
        )


class TeamAnnouncementConflictError(ConflictError):
    def __init__(self, message: str) -> None:
        super().__init__(
            code="TEAM_ANNOUNCEMENT_CONFLICT",
            message=message,
            operation="notifications.create_announcement",
        )


class DeviceTokenNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Device token not found") -> None:
        super().__init__(
            code="NOTIFICATION_RESOURCE_NOT_FOUND",
            message="Resource not found",
            operation="notifications.get_device_token",
        )
