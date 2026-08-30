from app.common.errors import BusinessRuleError, ConflictError, ResourceNotFoundError


class EventNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Event not found") -> None:
        super().__init__(code="EVENT_NOT_FOUND", message="Event not found", operation="events.get_event")


class EventStateError(BusinessRuleError):
    def __init__(self, message: str) -> None:
        super().__init__(code="EVENT_STATE_CONFLICT", message=message, operation="events.change_state")


class EventConflictError(ConflictError):
    def __init__(self, message: str) -> None:
        super().__init__(code="EVENT_CONFLICT", message=message, operation="events.create")


class SignupRuleError(BusinessRuleError):
    def __init__(self, message: str) -> None:
        super().__init__(code="EVENT_STATE_CONFLICT", message=message, operation="events.signup")
