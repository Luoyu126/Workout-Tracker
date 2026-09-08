"""add index for due event completion scans

Revision ID: 20260902_0006
Revises: 20260902_0005
Create Date: 2026-09-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260902_0006"
down_revision: str | None = "20260902_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_events_status_end_time",
        "events",
        ["status", "end_time"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_events_status_end_time", table_name="events")
