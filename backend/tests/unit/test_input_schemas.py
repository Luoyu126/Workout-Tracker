from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.coins.schemas import (
    CoinRuleCreateRequest,
    CoinTransactionCreateRequest,
    CoinTransactionRead,
)
from app.common.enums import CoinRuleTrigger, CoinTransactionType, EventType, MatchEntryType, SignupStatus
from app.events.match_schemas import MatchLogEntryCreateRequest
from app.events.schemas import (
    EventCreateRequest,
    EventSignupUpsertRequest,
    EventUpdateRequest,
    MatchDetailsCreateRequest,
    MatchDetailsUpdateRequest,
)
from app.notifications.schemas import DeviceTokenUpsertRequest, TeamAnnouncementRequest
from app.store.schemas import StoreItemCreateRequest, StoreItemUpdateRequest
from app.teams.schemas import MembershipCreateRequest, MembershipUpdateRequest, TeamUpdateRequest
from app.users.schemas import UserSyncRequest, UserUpdateRequest


def test_core_required_text_fields_are_stripped() -> None:
    assert UserSyncRequest(name="  小陈  ").name == "小陈"
    assert TeamUpdateRequest(name="  Demo FC  ").name == "Demo FC"
    assert StoreItemCreateRequest(name="  队袜  ", price=10).name == "队袜"
    assert (
        CoinRuleCreateRequest(
            name="  训练奖励  ",
            trigger_type=CoinRuleTrigger.training_signup,
            amount=10,
        ).name
        == "训练奖励"
    )
    assert TeamAnnouncementRequest(id=uuid4(), title="  集合  ", body="  训练取消  ").title == "集合"
    assert DeviceTokenUpsertRequest(token="  ExponentPushToken[test]  ", platform="ios").token == (
        "ExponentPushToken[test]"
    )


def test_coin_transaction_read_serializes_public_metadata_field_from_internal_attribute() -> None:
    transaction = SimpleNamespace(
        id=uuid4(),
        team_id=uuid4(),
        user_id=uuid4(),
        amount=-5,
        type=CoinTransactionType.admin_adjustment,
        reason="纪律扣分",
        reference_type="manual_adjustment",
        reference_id=uuid4(),
        created_by=uuid4(),
        metadata_={"source": "test"},
        created_at=datetime.now(UTC),
    )

    payload = CoinTransactionRead.model_validate(transaction).model_dump()

    assert payload["metadata"] == {"source": "test"}
    assert "metadata_" not in payload


def test_manual_coin_transaction_create_rejects_system_transaction_types() -> None:
    for transaction_type in (
        CoinTransactionType.signup_reward,
        CoinTransactionType.redemption,
        CoinTransactionType.refund,
    ):
        with pytest.raises(ValidationError, match="type must be admin_adjustment or other_reward"):
            CoinTransactionCreateRequest(
                id=uuid4(),
                user_id=uuid4(),
                amount=1,
                type=transaction_type,
            )


def test_core_required_text_fields_reject_blank_strings() -> None:
    invalid_payloads = [
        lambda: UserSyncRequest(name="   "),
        lambda: TeamUpdateRequest(name="   "),
        lambda: EventCreateRequest(type=EventType.training, title="   ", start_time="2026-08-16T12:00:00Z"),
        lambda: MatchDetailsCreateRequest(opponent="   "),
        lambda: StoreItemCreateRequest(name="   ", price=10),
        lambda: CoinRuleCreateRequest(
            name="   ",
            trigger_type=CoinRuleTrigger.training_signup,
            amount=10,
        ),
        lambda: TeamAnnouncementRequest(id=uuid4(), title="   ", body="正文"),
        lambda: TeamAnnouncementRequest(id=uuid4(), title="标题", body="   "),
        lambda: DeviceTokenUpsertRequest(token="   ", platform="ios"),
    ]

    for build_payload in invalid_payloads:
        with pytest.raises(ValidationError, match="value must not be blank"):
            build_payload()


def test_match_log_required_player_fields_reject_blank_strings() -> None:
    with pytest.raises(ValidationError, match="value must not be blank"):
        MatchLogEntryCreateRequest(
            entry_type=MatchEntryType.goal,
            minute=10,
            player_name="   ",
            player_number="9",
        )

    payload = MatchLogEntryCreateRequest(
        entry_type=MatchEntryType.goal,
        minute=10,
        player_name="  小陈  ",
        player_number="  9  ",
    )

    assert payload.player_name == "小陈"
    assert payload.player_number == "9"


def test_signup_note_is_stripped_and_blank_note_becomes_none() -> None:
    assert EventSignupUpsertRequest(status=SignupStatus.going, note="  准时  ").note == "准时"
    assert EventSignupUpsertRequest(status=SignupStatus.maybe, note="   ").note is None


def test_core_optional_text_fields_are_stripped_and_blank_becomes_none() -> None:
    user_sync = UserSyncRequest(
        name="小陈",
        student_id="  9  ",
        avatar_url="   ",
    )
    assert user_sync.student_id == "9"
    assert user_sync.avatar_url is None
    assert UserUpdateRequest(student_id="   ", avatar_url="  https://cdn.example.test/a.png  ").avatar_url == (
        "https://cdn.example.test/a.png"
    )

    event = EventCreateRequest(
        type=EventType.training,
        title="训练",
        description="  控球  ",
        location="   ",
        start_time="2026-08-16T12:00:00Z",
    )
    assert event.description == "控球"
    assert event.location is None
    assert EventUpdateRequest(description="   ", location="  主球场  ").location == "主球场"

    assert MatchDetailsCreateRequest(opponent="对手", notes="  首轮  ").notes == "首轮"
    assert MatchDetailsUpdateRequest(notes="   ").notes is None

    assert TeamUpdateRequest(description="  简介  ", logo_url="   ").description == "简介"
    assert MembershipCreateRequest(user_id="550e8400-e29b-41d4-a716-446655440000", jersey_number="  9  ").jersey_number == "9"
    assert MembershipUpdateRequest(position="   ").position is None

    assert StoreItemCreateRequest(name="队袜", description="  厚款  ", image_url="   ", price=10).description == "厚款"
    assert StoreItemUpdateRequest(description="   ", image_url="  https://cdn.example.test/socks.png  ").image_url == (
        "https://cdn.example.test/socks.png"
    )
