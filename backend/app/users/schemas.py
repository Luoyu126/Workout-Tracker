from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.common.enums import UserStatus
from app.common.validation import stripped_non_blank, stripped_optional_text


class UserRead(BaseModel):
    id: UUID
    auth_id: UUID
    name: str
    student_id: str | None
    email: EmailStr
    avatar_url: str | None
    status: UserStatus
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserSyncRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    student_id: str | None = Field(default=None, max_length=64)
    avatar_url: str | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return stripped_non_blank(value) or value

    @field_validator("student_id", "avatar_url")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    student_id: str | None = Field(default=None, max_length=64)
    avatar_url: str | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return stripped_non_blank(value)

    @field_validator("student_id", "avatar_url")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)
