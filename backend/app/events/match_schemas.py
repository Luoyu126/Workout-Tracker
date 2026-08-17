from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.common.enums import MatchEntryType
from app.common.validation import stripped_non_blank
from app.events.schemas import EventRead, MatchDetailsRead


class MatchLogEntryRead(BaseModel):
    id: UUID
    event_id: UUID
    entry_type: MatchEntryType
    minute: int
    player_name: str | None
    player_number: str | None
    sub_out_player_name: str | None
    sub_out_player_number: str | None
    sub_in_player_name: str | None
    sub_in_player_number: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MatchLogEntryCreateRequest(BaseModel):
    id: UUID | None = None
    entry_type: MatchEntryType
    minute: int = Field(ge=0)
    player_name: str | None = Field(default=None, max_length=120)
    player_number: str | None = Field(default=None, max_length=16)
    sub_out_player_name: str | None = Field(default=None, max_length=120)
    sub_out_player_number: str | None = Field(default=None, max_length=16)
    sub_in_player_name: str | None = Field(default=None, max_length=120)
    sub_in_player_number: str | None = Field(default=None, max_length=16)

    @field_validator(
        "player_name",
        "player_number",
        "sub_out_player_name",
        "sub_out_player_number",
        "sub_in_player_name",
        "sub_in_player_number",
    )
    @classmethod
    def normalize_optional_log_text(cls, value: str | None) -> str | None:
        return stripped_non_blank(value)

    @model_validator(mode="after")
    def validate_fields_for_type(self) -> "MatchLogEntryCreateRequest":
        if self.entry_type in {
            MatchEntryType.goal,
            MatchEntryType.yellow_card,
            MatchEntryType.red_card,
        } and (not self.player_name or not self.player_number):
            raise ValueError("player_name and player_number are required")
        if self.entry_type == MatchEntryType.substitution and not all(
            [
                self.sub_out_player_name,
                self.sub_out_player_number,
                self.sub_in_player_name,
                self.sub_in_player_number,
            ]
        ):
            raise ValueError("substitution requires all sub player fields")
        return self


class LiveBoardRead(BaseModel):
    event: EventRead
    match_details: MatchDetailsRead | None
    logs: list[MatchLogEntryRead]
    counts: dict[str, int]


class MatchSummaryRead(BaseModel):
    event: EventRead
    match_details: MatchDetailsRead | None
    counts: dict[str, int]
    signups: list[dict[str, object]]
    rewards: list[dict[str, object]]
