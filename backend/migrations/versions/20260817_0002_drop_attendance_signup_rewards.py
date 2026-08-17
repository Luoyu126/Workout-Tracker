"""drop attendances and switch to signup rewards

Revision ID: 20260817_0002
Revises: 20260815_0001
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260817_0002"
down_revision: str | None = "20260815_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("attendances")

    op.execute(
        sa.text(
            "UPDATE coin_rules SET trigger_type = 'training_signup' "
            "WHERE trigger_type = 'training_attendance'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE coin_rules SET trigger_type = 'match_signup' "
            "WHERE trigger_type = 'match_attendance'"
        )
    )
    op.execute(sa.text("DELETE FROM coin_rules WHERE trigger_type = 'late_attendance'"))

    op.execute(
        sa.text(
            "UPDATE coin_transactions SET type = 'signup_reward' "
            "WHERE type = 'attendance_reward'"
        )
    )

    op.drop_index("uq_coin_reward_team_user_event", table_name="coin_transactions")
    op.create_index(
        "uq_coin_reward_team_user_event",
        "coin_transactions",
        ["team_id", "user_id", "reference_type", "reference_id"],
        unique=True,
        postgresql_where=sa.text("type = 'signup_reward' AND reference_type = 'event'"),
    )


def downgrade() -> None:
    op.drop_index("uq_coin_reward_team_user_event", table_name="coin_transactions")
    op.create_index(
        "uq_coin_reward_team_user_event",
        "coin_transactions",
        ["team_id", "user_id", "reference_type", "reference_id"],
        unique=True,
        postgresql_where=sa.text("type = 'attendance_reward' AND reference_type = 'event'"),
    )

    op.execute(
        sa.text(
            "UPDATE coin_transactions SET type = 'attendance_reward' "
            "WHERE type = 'signup_reward'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE coin_rules SET trigger_type = 'training_attendance' "
            "WHERE trigger_type = 'training_signup'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE coin_rules SET trigger_type = 'match_attendance' "
            "WHERE trigger_type = 'match_signup'"
        )
    )

    op.create_table(
        "attendances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("recorded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("note", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("event_id", "user_id", name="uq_attendance_event_user"),
    )
