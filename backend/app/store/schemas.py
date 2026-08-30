from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.common.enums import RedemptionStatus
from app.common.validation import stripped_non_blank, stripped_optional_text
from app.teams.schemas import UserSummary


class StoreItemRead(BaseModel):
    id: UUID
    team_id: UUID
    name: str
    description: str | None
    image_url: str | None
    price: int
    stock: int | None
    is_active: bool
    created_by: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StoreItemCreateRequest(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    image_url: str | None = None
    price: int = Field(gt=0)
    stock: int | None = Field(default=None, ge=0)
    is_active: bool = False

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return stripped_non_blank(value) or value

    @field_validator("description", "image_url")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class StoreItemUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = None
    image_url: str | None = None
    price: int | None = Field(default=None, gt=0)
    stock: int | None = Field(default=None, ge=0)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return stripped_non_blank(value)

    @field_validator("description", "image_url")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class RedemptionRead(BaseModel):
    id: UUID
    team_id: UUID
    user_id: UUID
    user: UserSummary | None = None
    store_item_id: UUID
    quantity: int
    unit_price: int
    total_price: int
    status: RedemptionStatus
    fulfilled_by: UUID | None
    fulfilled_at: datetime | None
    cancelled_by: UUID | None
    cancelled_at: datetime | None
    refunded_by: UUID | None
    refunded_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RedemptionCreateRequest(BaseModel):
    id: UUID
    store_item_id: UUID
    quantity: int = Field(gt=0)
