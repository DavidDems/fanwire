"""add the seven indexes the historical records read (EVENTS-010)

Revision ID: b5e9c3a7d2f1
Revises: d4f8b2e6a1c3
Create Date: 2026-10-24 00:00:00.000000

Each serves one record of app.events.records:
- ix_player_game_stats_points_played: player-points-game
- ix_player_game_stats_rebounds_played: player-rebounds-game
- ix_player_game_stats_assists_played: player-assists-game
- ix_player_game_stats_three_pointers_made_played: player-threes-game
- ix_player_game_stats_triple_doubles: player-career-triple-doubles
- ix_games_margin: team-largest-win
- ix_games_nba_finals: championships (team-championships, player-championships)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5e9c3a7d2f1"
down_revision: str | Sequence[str] | None = "d4f8b2e6a1c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PLAYED = "seconds_played IS NOT NULL"
# app.events.models.TRIPLE_DOUBLE written out: the records query filters on
# that expression, and the planner uses this index only when the predicate
# is spelt the same way. Written here, not imported, so this migration never
# changes after it has run.
_TRIPLE_DOUBLE = (
    "0"
    " + CASE WHEN points >= 10 THEN 1 ELSE 0 END"
    " + CASE WHEN rebounds >= 10 THEN 1 ELSE 0 END"
    " + CASE WHEN assists >= 10 THEN 1 ELSE 0 END"
    " + CASE WHEN steals >= 10 THEN 1 ELSE 0 END"
    " + CASE WHEN blocks >= 10 THEN 1 ELSE 0 END"
    " >= 3"
)
# The single-game stat indexes: name -> column.
_STAT_INDEXES = {
    "ix_player_game_stats_points_played": "points",
    "ix_player_game_stats_rebounds_played": "rebounds",
    "ix_player_game_stats_assists_played": "assists",
    "ix_player_game_stats_three_pointers_made_played": "three_pointers_made",
}


def upgrade() -> None:
    """Upgrade schema.

    Not needed for correctness: the records read the same rows without
    them, so the app works between the deploy and this migration.
    """
    for name, column in _STAT_INDEXES.items():
        op.create_index(name, "player_game_stats", [column], postgresql_where=sa.text(_PLAYED))
    op.create_index(
        "ix_player_game_stats_triple_doubles",
        "player_game_stats",
        ["player_id", "game_id"],
        postgresql_where=sa.text(f"{_PLAYED} AND {_TRIPLE_DOUBLE}"),
    )
    op.create_index("ix_games_margin", "games", [sa.text("abs(home_score - away_score)")])
    op.create_index(
        "ix_games_nba_finals",
        "games",
        ["season"],
        postgresql_where=sa.text("game_type = 'playoffs' AND label = 'NBA Finals'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_games_nba_finals", table_name="games")
    op.drop_index("ix_games_margin", table_name="games")
    op.drop_index("ix_player_game_stats_triple_doubles", table_name="player_game_stats")
    for name in reversed(list(_STAT_INDEXES)):
        op.drop_index(name, table_name="player_game_stats")
