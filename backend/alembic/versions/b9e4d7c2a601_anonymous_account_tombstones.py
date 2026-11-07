"""Allow only deleted posts to have an anonymous author (USERS-008)."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b9e4d7c2a601"
down_revision: str | Sequence[str] | None = "b9f4c7e2d610"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("posts", "author_id", existing_type=sa.BigInteger(), nullable=True)
    op.create_check_constraint(
        "ck_posts_anonymous_requires_deleted",
        "posts",
        "author_id IS NOT NULL OR deleted_at IS NOT NULL",
    )


def downgrade() -> None:
    # Anonymous tombstones may hold other people's replies; removing them or
    # fabricating an author would destroy data. Refuse a lossy downgrade.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM posts WHERE author_id IS NULL)")):
        raise RuntimeError("Anonymous tombstones prevent a lossless downgrade")
    op.drop_constraint("ck_posts_anonymous_requires_deleted", "posts", type_="check")
    op.alter_column("posts", "author_id", existing_type=sa.BigInteger(), nullable=False)
