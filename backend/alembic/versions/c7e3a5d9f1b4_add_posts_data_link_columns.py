"""add posts' data-link columns for a post's one sports-data attachment

Revision ID: c7e3a5d9f1b4
Revises: b2d6f9a3c8e5
Create Date: 2026-10-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7e3a5d9f1b4"
down_revision: str | Sequence[str] | None = "b2d6f9a3c8e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECKS = {
    "ck_posts_one_data_link": (
        "num_nonnulls(linked_game_id, linked_player_game_stats_id, linked_player_id) <= 1"
    ),
    "ck_posts_no_data_link_on_reply": (
        "NOT is_reply OR (linked_game_id IS NULL AND linked_player_game_stats_id IS NULL "
        "AND linked_player_id IS NULL AND linked_player_scope IS NULL)"
    ),
    "ck_posts_player_scope_pairing": "(linked_player_id IS NULL) = (linked_player_scope IS NULL)",
    "ck_posts_player_scope_values": (
        "linked_player_scope IS NULL OR linked_player_scope IN ('regular', 'playoffs')"
    ),
}


def upgrade() -> None:
    """Upgrade schema.

    POSTS-005: one optional attachment per non-reply post, as real nullable
    FKs to events/' tables plus the career scope, behind four CHECKs (the
    same expressions as app.posts.models.Post). Nullable with no default, so
    every existing row has all four null and passes every CHECK. No index:
    nothing queries by these columns yet.
    """
    op.add_column(
        "posts",
        sa.Column("linked_game_id", sa.BigInteger(), sa.ForeignKey("games.id"), nullable=True),
    )
    op.add_column(
        "posts",
        sa.Column(
            "linked_player_game_stats_id",
            sa.BigInteger(),
            sa.ForeignKey("player_game_stats.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "posts",
        sa.Column("linked_player_id", sa.BigInteger(), sa.ForeignKey("players.id"), nullable=True),
    )
    op.add_column("posts", sa.Column("linked_player_scope", sa.Text(), nullable=True))
    for name, condition in _CHECKS.items():
        op.create_check_constraint(name, "posts", condition)


def downgrade() -> None:
    """Downgrade schema."""
    for name in _CHECKS:
        op.drop_constraint(name, "posts", type_="check")
    op.drop_column("posts", "linked_player_scope")
    op.drop_column("posts", "linked_player_id")
    op.drop_column("posts", "linked_player_game_stats_id")
    op.drop_column("posts", "linked_game_id")
