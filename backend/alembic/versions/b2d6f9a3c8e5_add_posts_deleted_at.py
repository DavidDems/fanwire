"""add posts.deleted_at for an owner's soft delete of a post

Revision ID: b2d6f9a3c8e5
Revises: a8c4e1f7b3d9
Create Date: 2026-10-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d6f9a3c8e5"
down_revision: str | Sequence[str] | None = "a8c4e1f7b3d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    POSTS-004: DELETE /posts/{id} sets it, every read filters on it. Nullable
    with no default, so every existing row stays live and an INSERT that
    omits it is unchanged. No index: deleted rows are rare, and every read
    already narrows the rows through an indexed join or IN first.
    """
    op.add_column("posts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("posts", "deleted_at")
