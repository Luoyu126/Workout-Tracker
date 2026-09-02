"""enforce non-null application timestamps

Revision ID: 20260901_0004
Revises: 20260830_0003
Create Date: 2026-09-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0004"
down_revision: str | None = "20260830_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TIMESTAMP_COLUMNS: dict[str, tuple[str, ...]] = {
    "coin_rules": ("created_at", "updated_at"),
    "coin_transactions": ("created_at",),
    "device_tokens": ("last_seen_at", "created_at", "updated_at"),
    "event_signups": ("created_at", "updated_at"),
    "events": ("created_at", "updated_at"),
    "match_details": ("created_at", "updated_at"),
    "match_log_entries": ("created_at", "updated_at"),
    "notifications": ("created_at",),
    "organizations": ("created_at", "updated_at"),
    "redemptions": ("created_at", "updated_at"),
    "store_items": ("created_at", "updated_at"),
    "team_memberships": ("created_at", "updated_at"),
    "teams": ("created_at", "updated_at"),
    "users": ("created_at", "updated_at"),
}


def upgrade() -> None:
    timestamp_type = sa.DateTime(timezone=True)
    for table_name, column_names in TIMESTAMP_COLUMNS.items():
        for column_name in column_names:
            op.execute(
                sa.text(
                    f'UPDATE "{table_name}" SET "{column_name}" = now() '
                    f'WHERE "{column_name}" IS NULL'
                )
            )
            op.alter_column(
                table_name,
                column_name,
                existing_type=timestamp_type,
                nullable=False,
            )


def downgrade() -> None:
    timestamp_type = sa.DateTime(timezone=True)
    for table_name, column_names in reversed(TIMESTAMP_COLUMNS.items()):
        for column_name in reversed(column_names):
            op.alter_column(
                table_name,
                column_name,
                existing_type=timestamp_type,
                nullable=True,
            )
