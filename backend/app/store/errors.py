from app.common.errors import BusinessRuleError, ResourceNotFoundError


class StoreItemNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Store item not found") -> None:
        super().__init__(
            code="STORE_RESOURCE_NOT_FOUND",
            message="Resource not found",
            operation="store.get_item",
        )


class RedemptionNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Redemption not found") -> None:
        super().__init__(
            code="STORE_RESOURCE_NOT_FOUND",
            message="Resource not found",
            operation="store.get_redemption",
        )


class StoreRuleError(BusinessRuleError):
    def __init__(self, message: str) -> None:
        super().__init__(code="STORE_RULE_CONFLICT", message=message, operation="store.change_state")
