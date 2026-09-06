"""Record the latest join request submission time.

Revision ID: 20260906_0007
Revises: 20260902_0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260906_0007"
down_revision: str | None = "20260902_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Historical updated_at can include unrelated edits, so do not invent submission times.
    op.add_column(
        "team_memberships",
        sa.Column("request_submitted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("team_memberships", "request_submitted_at")
