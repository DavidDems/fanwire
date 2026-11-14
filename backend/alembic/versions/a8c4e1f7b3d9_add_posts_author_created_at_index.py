"""add an index on posts (author_id, created_at) for the post rate limit

Revision ID: a8c4e1f7b3d9
Revises: e6b2f8a4c7d1
Create Date: 2026-10-19 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8c4e1f7b3d9"
down_revision: str | Sequence[str] | None = "e6b2f8a4c7d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    app.posts.moderation.PostCountRateLimiter (POSTS-002) counts one
    author's posts of the last hour on every publish: an index range scan,
    not a table scan. Not needed for correctness, so the app works between
    the deploy and this migration.
    """
    op.create_index(
        "ix_posts_author_id_created_at", "posts", ["author_id", "created_at"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_posts_author_id_created_at", table_name="posts")
