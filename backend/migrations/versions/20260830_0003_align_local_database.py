"""align the local database with database.md

Revision ID: 20260830_0003
Revises: 20260817_0002
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260830_0003"
down_revision: str | None = "20260817_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # TeamMembership: incompatible legacy role rows may be removed locally.
    op.execute(sa.text("DELETE FROM team_memberships WHERE role = 'captain'"))
    op.alter_column("team_memberships", "position", new_column_name="player_name")
    op.alter_column(
        "team_memberships",
        "joined_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
        server_default=None,
    )
    op.create_check_constraint(
        "ck_team_memberships_role",
        "team_memberships",
        "role IN ('member', 'admin')",
    )

    # Event: retain only valid, immediately-published/completed events.
    op.execute(
        sa.text(
            "DELETE FROM events "
            "WHERE status NOT IN ('published', 'completed') "
            "OR end_time IS NULL OR end_time <= start_time"
        )
    )
    op.drop_column("events", "signup_deadline")
    op.alter_column(
        "events",
        "end_time",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )
    op.alter_column(
        "events",
        "status",
        existing_type=sa.String(length=32),
        nullable=False,
        server_default="published",
    )
    op.create_check_constraint(
        "ck_events_status",
        "events",
        "status IN ('published', 'completed')",
    )
    op.create_check_constraint(
        "ck_events_end_after_start",
        "events",
        "end_time > start_time",
    )

    # Notification: collapse duplicate references before enforcing idempotency.
    op.execute(
        sa.text("DELETE FROM notifications WHERE type IN ('event_updated', 'event_deleted')")
    )
    op.execute(
        sa.text(
            "DELETE FROM notifications "
            "WHERE type = 'new_event' AND reference_type = 'event' "
            "AND reference_id IS NOT NULL "
            "AND NOT EXISTS ("
            " SELECT 1 FROM events WHERE events.id = notifications.reference_id"
            ")"
        )
    )
    op.add_column(
        "notifications",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(sa.text("UPDATE notifications SET updated_at = created_at"))
    op.alter_column(
        "notifications",
        "updated_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )
    op.execute(
        sa.text(
            "WITH ranked AS ("
            " SELECT id, row_number() OVER ("
            "  PARTITION BY user_id, type, reference_id"
            "  ORDER BY created_at DESC, id DESC"
            " ) AS row_number"
            " FROM notifications WHERE reference_id IS NOT NULL"
            ") DELETE FROM notifications WHERE id IN ("
            " SELECT id FROM ranked WHERE row_number > 1"
            ")"
        )
    )
    op.create_check_constraint(
        "ck_notifications_type",
        "notifications",
        "type IN ('new_event', 'coin_earned', 'redemption_completed', 'team_announcement')",
    )
    op.create_index(
        "uq_notifications_user_type_reference",
        "notifications",
        ["user_id", "type", "reference_id"],
        unique=True,
        postgresql_where=sa.text("reference_id IS NOT NULL"),
    )

    # CoinRule: remove invalid values and retain the newest active signup rule.
    op.execute(sa.text("DELETE FROM coin_rules WHERE amount < 0"))
    op.execute(
        sa.text(
            "WITH ranked AS ("
            " SELECT id, row_number() OVER ("
            "  PARTITION BY team_id, trigger_type"
            "  ORDER BY updated_at DESC, created_at DESC, id DESC"
            " ) AS row_number"
            " FROM coin_rules"
            " WHERE is_active AND trigger_type IN ('training_signup', 'match_signup')"
            ") UPDATE coin_rules SET is_active = false WHERE id IN ("
            " SELECT id FROM ranked WHERE row_number > 1"
            ")"
        )
    )
    op.create_check_constraint(
        "ck_coin_rules_amount_non_negative",
        "coin_rules",
        "amount >= 0",
    )
    op.create_index(
        "uq_coin_rules_active_training_signup_team",
        "coin_rules",
        ["team_id"],
        unique=True,
        postgresql_where=sa.text("is_active AND trigger_type = 'training_signup'"),
    )
    op.create_index(
        "uq_coin_rules_active_match_signup_team",
        "coin_rules",
        ["team_id"],
        unique=True,
        postgresql_where=sa.text("is_active AND trigger_type = 'match_signup'"),
    )

    # CoinTransaction: retain the earliest redemption deduction per reference.
    op.execute(
        sa.text(
            "WITH ranked AS ("
            " SELECT id, row_number() OVER ("
            "  PARTITION BY team_id, user_id, reference_id"
            "  ORDER BY created_at ASC, id ASC"
            " ) AS row_number"
            " FROM coin_transactions"
            " WHERE type = 'redemption' AND reference_id IS NOT NULL"
            ") DELETE FROM coin_transactions WHERE id IN ("
            " SELECT id FROM ranked WHERE row_number > 1"
            ")"
        )
    )
    op.create_index(
        "uq_coin_redemption_team_user_reference",
        "coin_transactions",
        ["team_id", "user_id", "reference_id"],
        unique=True,
        postgresql_where=sa.text("type = 'redemption' AND reference_id IS NOT NULL"),
    )

    # Redemption: historical rows intentionally retain empty audit actors/times.
    op.add_column(
        "redemptions",
        sa.Column("cancelled_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "redemptions",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "redemptions",
        sa.Column("refunded_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "redemptions",
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_redemptions_cancelled_by_users",
        "redemptions",
        "users",
        ["cancelled_by"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_redemptions_refunded_by_users",
        "redemptions",
        "users",
        ["refunded_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_redemptions_refunded_by_users", "redemptions", type_="foreignkey")
    op.drop_constraint("fk_redemptions_cancelled_by_users", "redemptions", type_="foreignkey")
    op.drop_column("redemptions", "refunded_at")
    op.drop_column("redemptions", "refunded_by")
    op.drop_column("redemptions", "cancelled_at")
    op.drop_column("redemptions", "cancelled_by")

    op.drop_index("uq_coin_redemption_team_user_reference", table_name="coin_transactions")

    op.drop_index("uq_coin_rules_active_match_signup_team", table_name="coin_rules")
    op.drop_index("uq_coin_rules_active_training_signup_team", table_name="coin_rules")
    op.drop_constraint("ck_coin_rules_amount_non_negative", "coin_rules", type_="check")

    op.drop_index("uq_notifications_user_type_reference", table_name="notifications")
    op.drop_constraint("ck_notifications_type", "notifications", type_="check")
    op.drop_column("notifications", "updated_at")

    op.drop_constraint("ck_events_end_after_start", "events", type_="check")
    op.drop_constraint("ck_events_status", "events", type_="check")
    op.alter_column(
        "events",
        "status",
        existing_type=sa.String(length=32),
        nullable=False,
        server_default="draft",
    )
    op.alter_column(
        "events",
        "end_time",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
    )
    op.add_column(
        "events",
        sa.Column("signup_deadline", sa.DateTime(timezone=True), nullable=True),
    )

    op.drop_constraint("ck_team_memberships_role", "team_memberships", type_="check")
    op.execute(
        sa.text(
            "UPDATE team_memberships SET joined_at = created_at WHERE joined_at IS NULL"
        )
    )
    op.alter_column(
        "team_memberships",
        "joined_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )
    op.alter_column("team_memberships", "player_name", new_column_name="position")
