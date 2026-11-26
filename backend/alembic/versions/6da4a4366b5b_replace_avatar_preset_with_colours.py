"""replace the avatar preset key with nullable inner and outer colours

Revision ID: 6da4a4366b5b
Revises: fd9d2851baf5
Create Date: 2026-11-25 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6da4a4366b5b"
down_revision: str | Sequence[str] | None = "fd9d2851baf5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    USERS-005: the eight presets are gone. Two nullable Text columns hold the
    avatar's inner and outer colours (keys from the team palette; the
    allowlists are app.users.schemas' Literal types). Nothing maps a preset
    to a colour: a user who had one returns to the default initials, and
    every other value on the row is kept.
    """
    op.add_column("users", sa.Column("avatar_inner_color", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("avatar_outer_color", sa.Text(), nullable=True))
    op.drop_column("users", "profile_avatar_key")


def downgrade() -> None:
    """Downgrade schema: restore the preset column, empty, and drop the colours."""
    op.add_column("users", sa.Column("profile_avatar_key", sa.Text(), nullable=True))
    op.drop_column("users", "avatar_outer_color")
    op.drop_column("users", "avatar_inner_color")
