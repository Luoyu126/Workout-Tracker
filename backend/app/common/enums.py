from enum import StrEnum
from typing import Any


def enum_value(value: Any) -> str:
    if isinstance(value, StrEnum):
        return value.value
    return str(value)


class UserStatus(StrEnum):
    active = "active"
    disabled = "disabled"


class TeamStatus(StrEnum):
    active = "active"
    archived = "archived"


class MembershipRole(StrEnum):
    member = "member"
    captain = "captain"
    admin = "admin"


class MembershipStatus(StrEnum):
    active = "active"
    inactive = "inactive"
    pending = "pending"


class EventType(StrEnum):
    training = "training"
    match = "match"
    other = "other"


class EventStatus(StrEnum):
    draft = "draft"
    published = "published"
    completed = "completed"
    cancelled = "cancelled"


class SignupStatus(StrEnum):
    going = "going"
    not_going = "not_going"
    maybe = "maybe"


class MatchEntryType(StrEnum):
    goal = "goal"
    yellow_card = "yellow_card"
    red_card = "red_card"
    substitution = "substitution"


class MatchResult(StrEnum):
    win = "win"
    draw = "draw"
    loss = "loss"


class CoinRuleTrigger(StrEnum):
    training_signup = "training_signup"
    match_signup = "match_signup"
    manual = "manual"


class CoinTransactionType(StrEnum):
    signup_reward = "signup_reward"
    redemption = "redemption"
    admin_adjustment = "admin_adjustment"
    other_reward = "other_reward"
    refund = "refund"


class RedemptionStatus(StrEnum):
    pending = "pending"
    fulfilled = "fulfilled"
    cancelled = "cancelled"
    refunded = "refunded"


class NotificationType(StrEnum):
    new_event = "new_event"
    event_updated = "event_updated"
    event_deleted = "event_deleted"
    coin_earned = "coin_earned"
    redemption_completed = "redemption_completed"
    team_announcement = "team_announcement"


class DevicePlatform(StrEnum):
    ios = "ios"
    android = "android"
