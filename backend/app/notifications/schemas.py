import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.common.enums import DevicePlatform, NotificationType
from app.common.validation import stripped_non_blank

EXPO_PUSH_TOKEN_PATTERN = re.compile(r"^ExponentPushToken\[[A-Za-z0-9_-]+\]$")


class NotificationRead(BaseModel):
    id: UUID
    user_id: UUID
    team_id: UUID
    type: NotificationType
    title: str
    body: str
    reference_type: str | None
    reference_id: UUID | None
    read_at: datetime | None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class UnreadCountRead(BaseModel):
    count: int


class DeviceTokenRead(BaseModel):
    id: UUID
    user_id: UUID
    token: str
    platform: DevicePlatform
    is_active: bool
    last_seen_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DeviceTokenUpsertRequest(BaseModel):
    token: str
    platform: DevicePlatform

    @field_validator("token")
    @classmethod
    def normalize_token(cls, value: str) -> str:
        token = stripped_non_blank(value)
        if token is None or EXPO_PUSH_TOKEN_PATTERN.fullmatch(token) is None:
            raise ValueError("token must be a valid Expo push token")
        return token


class TeamAnnouncementRequest(BaseModel):
    id: UUID
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=1000)

    @field_validator("title", "body")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        return stripped_non_blank(value) or value
