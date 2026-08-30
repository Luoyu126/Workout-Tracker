from app.common.errors import BusinessRuleError, ConflictError, ResourceNotFoundError


class MatchLogNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Match log not found") -> None:
        super().__init__(
            code="MATCH_RESOURCE_NOT_FOUND",
            message="Resource not found",
            operation="matches.get_log",
        )


class MatchEventNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Event not found") -> None:
        super().__init__(
            code="MATCH_RESOURCE_NOT_FOUND",
            message="Resource not found",
            operation="matches.get_event",
        )


class MatchLogConflictError(ConflictError):
    def __init__(self, message: str) -> None:
        super().__init__(code="MATCH_LOG_CONFLICT", message=message, operation="matches.create_log")


class MatchStateError(BusinessRuleError):
    def __init__(self, message: str) -> None:
        super().__init__(code="MATCH_STATE_CONFLICT", message=message, operation="matches.change_state")
