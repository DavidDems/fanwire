"""add nullable preset profile avatar key

Revision ID: c7a4e2f9b6d1
Revises: b5e9c3a7d2f1
Create Date: 2026-10-28 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "c7a4e2f9b6d1"
down_revision: str | Sequence[str] | None = "b5e9c3a7d2f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("profile_avatar_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "profile_avatar_key")
