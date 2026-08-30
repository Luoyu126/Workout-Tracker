from app.common.errors import ConflictError, ResourceNotFoundError


class CoinRuleNotFoundError(ResourceNotFoundError):
    def __init__(self, _message: str = "Coin rule not found") -> None:
        super().__init__(code="COIN_RULE_NOT_FOUND", message="Coin rule not found", operation="coins.get_rule")


class CoinRuleConflictError(ConflictError):
    def __init__(self, message: str) -> None:
        super().__init__(code="COIN_RULE_CONFLICT", message=message, operation="coins.change_rule")


class CoinTransactionConflictError(ConflictError):
    def __init__(self, message: str) -> None:
        super().__init__(
            code="COIN_TRANSACTION_CONFLICT",
            message=message,
            operation="coins.create_transaction",
        )
