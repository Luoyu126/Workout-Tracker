from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.common.enums import EventType, SignupStatus
from app.events.schemas import EventCreateRequest, EventSignupUpsertRequest


def test_not_going_signup_requires_non_blank_note() -> None:
    with pytest.raises(ValidationError):
        EventSignupUpsertRequest(status=SignupStatus.not_going, note=None)

    with pytest.raises(ValidationError):
        EventSignupUpsertRequest(status=SignupStatus.not_going, note="   ")


def test_signup_note_is_trimmed_before_storage() -> None:
    payload = EventSignupUpsertRequest(status=SignupStatus.not_going, note="  受伤休息  ")

    assert payload.note == "受伤休息"


def test_blank_note_for_going_signup_is_normalized_to_none() -> None:
    payload = EventSignupUpsertRequest(status=SignupStatus.going, note="   ")

    assert payload.note is None


def test_event_schedule_requires_end_after_start() -> None:
    start_time = datetime(2026, 8, 16, 12, 0, tzinfo=UTC)

    with pytest.raises(ValidationError, match="end_time must be after start_time"):
        EventCreateRequest(
            type=EventType.training,
            title="非法结束时间",
            start_time=start_time,
            end_time=datetime(2026, 8, 16, 11, 0, tzinfo=UTC),
        )

    with pytest.raises(ValidationError, match="end_time"):
        EventCreateRequest(
            type=EventType.training,
            title="缺少结束时间",
            start_time=start_time,
        )

    payload = EventCreateRequest(
        type=EventType.training,
        title="合法活动",
        start_time=start_time,
        end_time=datetime(2026, 8, 16, 14, 0, tzinfo=UTC),
    )
    assert payload.end_time is not None
