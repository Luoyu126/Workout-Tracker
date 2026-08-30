from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.common.enums import MembershipRole, MembershipStatus, TeamStatus
from app.common.validation import stripped_non_blank, stripped_optional_text


class TeamRead(BaseModel):
    id: UUID
    organization_id: UUID
    name: str
    description: str | None
    logo_url: str | None
    status: TeamStatus
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TeamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    logo_url: str | None = None
    status: TeamStatus | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return stripped_non_blank(value)

    @field_validator("description", "logo_url")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class UserSummary(BaseModel):
    id: UUID
    name: str
    email: str
    avatar_url: str | None

    model_config = ConfigDict(from_attributes=True)


class MemberCandidateRead(BaseModel):
    id: UUID
    name: str
    student_id: str | None
    email: str
    avatar_url: str | None

    model_config = ConfigDict(from_attributes=True)


class MembershipRead(BaseModel):
    id: UUID
    team_id: UUID
    user_id: UUID
    role: MembershipRole
    jersey_number: str | None
    player_name: str | None
    status: MembershipStatus
    joined_at: datetime | None
    left_at: datetime | None
    created_at: datetime
    updated_at: datetime
    user: UserSummary | None = None

    model_config = ConfigDict(from_attributes=True)


class MembershipCreateRequest(BaseModel):
    user_id: UUID
    role: MembershipRole = MembershipRole.member
    jersey_number: str | None = Field(default=None, max_length=16)
    player_name: str | None = Field(default=None, max_length=64)
    status: MembershipStatus = MembershipStatus.active

    @field_validator("jersey_number", "player_name")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class MembershipUpdateRequest(BaseModel):
    role: MembershipRole | None = None
    jersey_number: str | None = Field(default=None, max_length=16)
    player_name: str | None = Field(default=None, max_length=64)
    status: MembershipStatus | None = None
    left_at: datetime | None = None

    @field_validator("jersey_number", "player_name")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class TeamHomeRead(BaseModel):
    team: TeamRead
    current_membership: MembershipRead
    admins: list[MembershipRead]
    member_count: int
    upcoming_events: list[dict[str, object]]
    signup_summary: dict[str, int]
    coin_summary: dict[str, int]


class SignupBoardRow(BaseModel):
    user_id: UUID
    user: UserSummary | None = None
    going: int
    maybe: int
    not_going: int
    total: int
    going_rate: float
