import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import (
    event as sqlalchemy_event,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.database import Base
from app.common.enums import (
    CoinRuleTrigger,
    CoinTransactionType,
    DevicePlatform,
    EventStatus,
    EventType,
    MatchEntryType,
    MatchResult,
    MembershipRole,
    MembershipStatus,
    NotificationType,
    RedemptionStatus,
    SignupStatus,
    TeamStatus,
    UserStatus,
)
from app.common.types import UUID, JSONBType


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    auth_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    student_id: Mapped[str | None] = mapped_column(String(64))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[UserStatus] = mapped_column(String(32), nullable=False, default=UserStatus.active)

    memberships: Mapped[list["TeamMembership"]] = relationship(back_populates="user")


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    logo_url: Mapped[str | None] = mapped_column(Text)

    teams: Mapped[list["Team"]] = relationship(back_populates="organization")


class Team(Base, TimestampMixin):
    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    logo_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[TeamStatus] = mapped_column(String(32), nullable=False, default=TeamStatus.active)

    organization: Mapped[Organization] = relationship(back_populates="teams")
    memberships: Mapped[list["TeamMembership"]] = relationship(back_populates="team")


class TeamMembership(Base, TimestampMixin):
    __tablename__ = "team_memberships"
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_membership_team_user"),
        CheckConstraint("role IN ('member', 'admin')", name="ck_team_memberships_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    role: Mapped[MembershipRole] = mapped_column(
        String(32), nullable=False, default=MembershipRole.member
    )
    jersey_number: Mapped[str | None] = mapped_column(String(16))
    player_name: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[MembershipStatus] = mapped_column(
        String(32), nullable=False, default=MembershipStatus.pending
    )
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    team: Mapped[Team] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")


@sqlalchemy_event.listens_for(TeamMembership, "before_insert")
def _set_active_membership_joined_at(_mapper: object, _connection: object, target: TeamMembership) -> None:
    if target.status == MembershipStatus.active and target.joined_at is None:
        target.joined_at = datetime.now(UTC)


class Event(Base, TimestampMixin):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint("status IN ('published', 'completed')", name="ck_events_status"),
        CheckConstraint("end_time > start_time", name="ck_events_end_after_start"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=False)
    type: Mapped[EventType] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(240))
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[EventStatus] = mapped_column(
        String(32), nullable=False, default=EventStatus.published, server_default="published"
    )
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)


class EventSignup(Base, TimestampMixin):
    __tablename__ = "event_signups"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_event_signup_event_user"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[SignupStatus] = mapped_column(String(32), nullable=False, default=SignupStatus.maybe)
    note: Mapped[str | None] = mapped_column(Text)


class MatchDetails(Base, TimestampMixin):
    __tablename__ = "match_details"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    opponent: Mapped[str] = mapped_column(String(180), nullable=False)
    team_score: Mapped[int | None] = mapped_column(Integer)
    opponent_score: Mapped[int | None] = mapped_column(Integer)
    result: Mapped[MatchResult | None] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(Text)


class MatchLogEntry(Base, TimestampMixin):
    __tablename__ = "match_log_entries"
    __table_args__ = (CheckConstraint("minute >= 0", name="ck_match_log_entries_minute_non_negative"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    entry_type: Mapped[MatchEntryType] = mapped_column(String(32), nullable=False)
    minute: Mapped[int] = mapped_column(Integer, nullable=False)
    player_name: Mapped[str | None] = mapped_column(String(120))
    player_number: Mapped[str | None] = mapped_column(String(16))
    sub_out_player_name: Mapped[str | None] = mapped_column(String(120))
    sub_out_player_number: Mapped[str | None] = mapped_column(String(16))
    sub_in_player_name: Mapped[str | None] = mapped_column(String(120))
    sub_in_player_number: Mapped[str | None] = mapped_column(String(16))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)


class CoinRule(Base, TimestampMixin):
    __tablename__ = "coin_rules"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_coin_rules_amount_non_negative"),
        Index(
            "uq_coin_rules_active_training_signup_team",
            "team_id",
            unique=True,
            postgresql_where=text("is_active AND trigger_type = 'training_signup'"),
            sqlite_where=text("is_active = 1 AND trigger_type = 'training_signup'"),
        ),
        Index(
            "uq_coin_rules_active_match_signup_team",
            "team_id",
            unique=True,
            postgresql_where=text("is_active AND trigger_type = 'match_signup'"),
            sqlite_where=text("is_active = 1 AND trigger_type = 'match_signup'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    trigger_type: Mapped[CoinRuleTrigger] = mapped_column(String(48), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    config: Mapped[dict[str, Any] | None] = mapped_column(JSONBType)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)


class CoinTransaction(Base):
    __tablename__ = "coin_transactions"
    __table_args__ = (
        Index(
            "uq_coin_reward_team_user_event",
            "team_id",
            "user_id",
            "reference_type",
            "reference_id",
            unique=True,
            postgresql_where=text("type = 'signup_reward' AND reference_type = 'event'"),
            sqlite_where=text("type = 'signup_reward' AND reference_type = 'event'"),
        ),
        Index(
            "uq_coin_refund_team_user_redemption",
            "team_id",
            "user_id",
            "reference_type",
            "reference_id",
            unique=True,
            postgresql_where=text("type = 'refund' AND reference_type = 'redemption'"),
            sqlite_where=text("type = 'refund' AND reference_type = 'redemption'"),
        ),
        Index(
            "uq_coin_redemption_team_user_reference",
            "team_id",
            "user_id",
            "reference_id",
            unique=True,
            postgresql_where=text("type = 'redemption' AND reference_id IS NOT NULL"),
            sqlite_where=text("type = 'redemption' AND reference_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[CoinTransactionType] = mapped_column(String(48), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    reference_type: Mapped[str | None] = mapped_column(String(64))
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONBType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoreItem(Base, TimestampMixin):
    __tablename__ = "store_items"
    __table_args__ = (
        CheckConstraint("price > 0", name="ck_store_items_price_positive"),
        CheckConstraint("stock IS NULL OR stock >= 0", name="ck_store_items_stock_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    stock: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)


class Redemption(Base, TimestampMixin):
    __tablename__ = "redemptions"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_redemptions_quantity_positive"),
        CheckConstraint("unit_price > 0", name="ck_redemptions_unit_price_positive"),
        CheckConstraint("total_price > 0", name="ck_redemptions_total_price_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    store_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("store_items.id"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[int] = mapped_column(Integer, nullable=False)
    total_price: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[RedemptionStatus] = mapped_column(
        String(32), nullable=False, default=RedemptionStatus.pending
    )
    fulfilled_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refunded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "type IN ('new_event', 'coin_earned', 'redemption_completed', 'team_announcement')",
            name="ck_notifications_type",
        ),
        Index(
            "uq_notifications_user_type_reference",
            "user_id",
            "type",
            "reference_id",
            unique=True,
            postgresql_where=text("reference_id IS NOT NULL"),
            sqlite_where=text("reference_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=False)
    type: Mapped[NotificationType] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    reference_type: Mapped[str | None] = mapped_column(String(64))
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DeviceToken(Base, TimestampMixin):
    __tablename__ = "device_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    platform: Mapped[DevicePlatform] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
