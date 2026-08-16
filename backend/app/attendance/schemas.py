from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.common.enums import AttendanceStatus
from app.common.validation import stripped_optional_text
from app.events.schemas import MatchDetailsUpdateRequest
from app.teams.schemas import UserSummary


class AttendanceRead(BaseModel):
    id: UUID
    event_id: UUID
    user_id: UUID
    status: AttendanceStatus
    recorded_by: UUID
    recorded_at: datetime
    note: str | None
    created_at: datetime
    updated_at: datetime
    user: UserSummary | None = None

    model_config = ConfigDict(from_attributes=True)


class AttendanceUpsertRequest(BaseModel):
    status: AttendanceStatus
    note: str | None = None

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        return stripped_optional_text(value)


class AttendanceBoardRow(BaseModel):
    user_id: UUID
    user: UserSummary | None = None
    present: int
    late: int
    absent: int
    excused: int
    total: int
    attendance_rate: float


class EventCompletionRequest(BaseModel):
    match_details: MatchDetailsUpdateRequest | None = None


class EventCompletionRead(BaseModel):
    event_id: UUID
    status: str
    attendance_count: int
    reward_count: int
