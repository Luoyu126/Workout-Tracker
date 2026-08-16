from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.common.enums import CoinRuleTrigger, CoinTransactionType
from app.common.validation import stripped_non_blank


class CoinRuleRead(BaseModel):
    id: UUID
    team_id: UUID
    name: str
    trigger_type: CoinRuleTrigger
    amount: int
    config: dict[str, object] | None
    is_active: bool
    created_by: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CoinRuleCreateRequest(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=1, max_length=160)
    trigger_type: CoinRuleTrigger
    amount: int = Field(ge=0)
    config: dict[str, object] | None = None
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return stripped_non_blank(value) or value


class CoinRuleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    amount: int | None = Field(default=None, ge=0)
    config: dict[str, object] | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return stripped_non_blank(value)


class CoinTransactionCreateRequest(BaseModel):
    id: UUID
    user_id: UUID
    amount: int
    type: CoinTransactionType = CoinTransactionType.admin_adjustment
    reason: str | None = None
    metadata: dict[str, object] | None = None

    @field_validator("type")
    @classmethod
    def validate_manual_transaction_type(cls, value: CoinTransactionType) -> CoinTransactionType:
        if value not in {CoinTransactionType.admin_adjustment, CoinTransactionType.other_reward}:
            raise ValueError("type must be admin_adjustment or other_reward")
        return value

    @field_validator("amount")
    @classmethod
    def validate_non_zero_amount(cls, value: int) -> int:
        if value == 0:
            raise ValueError("amount must not be zero")
        return value


class CoinTransactionRead(BaseModel):
    id: UUID
    team_id: UUID
    user_id: UUID
    amount: int
    type: CoinTransactionType
    reason: str | None
    reference_type: str | None
    reference_id: UUID | None
    created_by: UUID | None
    metadata: dict[str, object] | None = Field(default=None, validation_alias="metadata_")
    created_at: datetime

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class CoinBalanceRead(BaseModel):
    team_id: UUID
    user_id: UUID
    balance: int
