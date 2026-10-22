"""add posts.linked_line_game_id, the game of a player_game link's line

Revision ID: d4f8b2e6a1c3
Revises: c7e3a5d9f1b4
Create Date: 2026-10-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f8b2e6a1c3"
down_revision: str | Sequence[str] | None = "c7e3a5d9f1b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = "ck_posts_line_game_pairing"
_CHECK_CONDITION = "(linked_player_game_stats_id IS NULL) = (linked_line_game_id IS NULL)"
_INDEXES = {
    "ix_posts_linked_game_id": "linked_game_id",
    "ix_posts_linked_line_game_id": "linked_line_game_id",
}


def upgrade() -> None:
    """Upgrade schema.

    POSTS-006: a player_game link stores its line's game beside the line, so
    preferred-team relevance can match it without reading events/' tables
    at query time. The rows created since POSTS-005 are backfilled from
    player_game_stats in plain SQL before the CHECK pairing the two columns
    is added (the CHECK would refuse them otherwise). Posts are immutable,
    so the stored game can't drift. Both game columns relevance matches get
    a partial index.
    """
    op.add_column(
        "posts",
        sa.Column("linked_line_game_id", sa.BigInteger(), sa.ForeignKey("games.id"), nullable=True),
    )
    op.execute(
        "UPDATE posts SET linked_line_game_id = player_game_stats.game_id "
        "FROM player_game_stats "
        "WHERE player_game_stats.id = posts.linked_player_game_stats_id"
    )
    op.create_check_constraint(_CHECK, "posts", _CHECK_CONDITION)
    for name, column in _INDEXES.items():
        op.create_index(name, "posts", [column], postgresql_where=sa.text(f"{column} IS NOT NULL"))


def downgrade() -> None:
    """Downgrade schema."""
    for name in _INDEXES:
        op.drop_index(name, table_name="posts")
    op.drop_constraint(_CHECK, "posts", type_="check")
    op.drop_column("posts", "linked_line_game_id")
