"""Add ordered indexes for own activity history (POSTS-008).

Revision ID: e8a6d4c2b901
Revises: c7a4e2f9b6d1
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e8a6d4c2b901"
down_revision: str | Sequence[str] | None = "c7a4e2f9b6d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_posts_author_id_id", "posts", ["author_id", sa.text("id DESC")])
    op.create_index(
        "ix_post_likes_user_created_post",
        "post_likes",
        ["user_id", sa.text("created_at DESC"), sa.text("post_id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_post_likes_user_created_post", table_name="post_likes")
    op.drop_index("ix_posts_author_id_id", table_name="posts")
