"""Add an index on post_likes(post_id) (POSTS-009).

GET /feed's "reply has at least one like" check and like_counts look likes
up by post alone; the primary key (user_id, post_id) and
ix_post_likes_user_created_post both lead with user_id, so neither serves it.

Revision ID: e6d7328e8881
Revises: a8d3e5f1c2b7
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e6d7328e8881"
down_revision: str | Sequence[str] | None = "a8d3e5f1c2b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_post_likes_post_id", "post_likes", ["post_id"])


def downgrade() -> None:
    op.drop_index("ix_post_likes_post_id", table_name="post_likes")
