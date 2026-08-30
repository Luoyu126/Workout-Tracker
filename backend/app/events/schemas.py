from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.common.enums import EventStatus, EventType, MatchResult, SignupStatus
from app.common.validation import stripped_non_blank, stripped_optional_text
from app.teams.schemas import UserSummary


def _timestamp(value: datetime) -> float:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC).timestamp()
    return value.astimezone(UTC).timestamp()


def validate_schedule_window(
    start_time: datetime | None,
    end_time: datetime | None,
) -> None:
    if start_time is None or end_time is None:
        return
    start_timestamp = _timestamp(start_time)
    if _timestamp(end_time) <= start_timestamp:
        raise ValueError("end_time must be after start_time")


def validate_match_score_result(
    team_score: int | None,
    opponent_score: int | None,
    result: MatchResult | None,
) -> None:
    if (team_score is None) != (opponent_score is None):
        raise ValueError("team_score and opponent_score must be provided together")
    if result is not None and (team_score is None or opponent_score is None):
        raise ValueError("result requires team_score and opponent_score")
    if team_score is None or opponent_score is None or result is None:
        return
    expected_result = (
        MatchResult.win
        if team_score > opponent_score
        else MatchResult.loss
        if team_score < opponent_score
        else MatchResult.draw
    )
    if result != expected_result:
        raise ValueError("result must match team_score and opponent_score")


class MatchDetailsRead(BaseModel):
    id: UUID
    event_id: UUID
    opponent: str
    team_score: int | None
    opponent_score: int | None
    result: MatchResult | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventRead(BaseModel):
    id: UUID
    team_id: UUID
    type: EventType
    title: str
    description: str | None
    location: str | None
    start_time: datetime
    end_time: datetime
    status: EventStatus
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    match_details: MatchDetailsRead | None = None

    model_config = ConfigDict(from_attributes=True)


class EventCreateRequest(BaseModel):
    id: UUID | None = None
    type: EventType = EventType.training
    title: str = Field(min_length=1, max_length=180)
    description: str | None = None
    location: str | None = Field(default=None, max_length=240)
    start_time: datetime
    end_time: datetime

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return stripped_non_blank(value) or value

    @field_validator("description", "location")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)

    @model_validator(mode="after")
    def validate_event_schedule(self) -> "EventCreateRequest":
        validate_schedule_window(self.start_time, self.end_time)
        return self


class MatchDetailsCreateRequest(BaseModel):
    opponent: str = Field(min_length=1, max_length=180)
    notes: str | None = None

    @field_validator("opponent")
    @classmethod
    def normalize_opponent(cls, value: str) -> str:
        return stripped_non_blank(value) or value

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class MatchCreateRequest(BaseModel):
    event: EventCreateRequest
    match_details: MatchDetailsCreateRequest


class MatchDetailsUpdateRequest(BaseModel):
    opponent: str | None = Field(default=None, min_length=1, max_length=180)
    team_score: int | None = Field(default=None, ge=0)
    opponent_score: int | None = Field(default=None, ge=0)
    result: MatchResult | None = None
    notes: str | None = None

    @field_validator("opponent")
    @classmethod
    def normalize_opponent(cls, value: str | None) -> str | None:
        return stripped_non_blank(value)

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class EventUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = None
    location: str | None = Field(default=None, max_length=240)
    start_time: datetime | None = None
    end_time: datetime | None = None
    match_details: MatchDetailsUpdateRequest | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        return stripped_non_blank(value)

    @field_validator("description", "location")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)

    @model_validator(mode="after")
    def validate_partial_schedule_window(self) -> "EventUpdateRequest":
        if "end_time" in self.model_fields_set and self.end_time is None:
            raise ValueError("end_time must not be null")
        validate_schedule_window(self.start_time, self.end_time)
        return self


class EventSignupRead(BaseModel):
    id: UUID | None
    event_id: UUID
    user_id: UUID
    status: SignupStatus
    note: str | None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    user: UserSummary | None = None

    model_config = ConfigDict(from_attributes=True)


class EventSignupUpsertRequest(BaseModel):
    status: SignupStatus
    note: str | None = None

    @model_validator(mode="after")
    def validate_not_going_note(self) -> "EventSignupUpsertRequest":
        if self.note is not None:
            stripped_note = self.note.strip()
            self.note = stripped_note if stripped_note else None
        if self.status == SignupStatus.not_going and not self.note:
            raise ValueError("not_going signup requires a note")
        return self


class EventCompletionRequest(BaseModel):
    match_details: MatchDetailsUpdateRequest | None = None


class EventCompletionRead(BaseModel):
    event_id: UUID
    status: str
    going_count: int
    reward_count: int
