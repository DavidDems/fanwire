"""add player_season_totals and team_game_totals (the records library)

Revision ID: a8d3e5f1c2b7
Revises: c7a4e2f9b6d1
Create Date: 2026-11-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a8d3e5f1c2b7"
down_revision: str | Sequence[str] | None = "c7a4e2f9b6d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A frozen copy of app.events.record_totals' statements at this revision (a
# migration never imports app code, which may change after it): the tables
# are created, then populated from the games and box scores already stored.
# tests/test_migrations_record_totals.py checks the result equals what
# rebuild_record_totals makes of the same data.
_TENS = (
    "(s.points >= 10)::int + (s.rebounds >= 10)::int + (s.assists >= 10)::int"
    " + (s.steals >= 10)::int + (s.blocks >= 10)::int"
)
_SHOOTING = (
    "field_goals_made",
    "field_goals_attempted",
    "three_pointers_made",
    "three_pointers_attempted",
    "free_throws_made",
    "free_throws_attempted",
)
_PLAYER_SUMS = (
    "seconds_played",
    "points",
    "rebounds",
    "offensive_rebounds",
    "defensive_rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    *_SHOOTING,
)
_TEAM_SUMS = (*_SHOOTING, "rebounds", "assists", "steals", "blocks", "turnovers")

_PLAYER_SEASON_TOTALS = f"""
INSERT INTO player_season_totals
    (player_id, season, game_type, team_id, games, {", ".join(_PLAYER_SUMS)},
     double_doubles, triple_doubles)
SELECT s.player_id, g.season, g.game_type,
       (array_agg(s.team_id ORDER BY g.date DESC, g.id DESC))[1],
       count(*), {", ".join(f"sum(s.{c})" for c in _PLAYER_SUMS)},
       count(*) FILTER (WHERE {_TENS} >= 2),
       count(*) FILTER (WHERE {_TENS} >= 3)
FROM player_game_stats AS s
JOIN games AS g ON g.id = s.game_id
WHERE s.seconds_played IS NOT NULL AND g.game_type IN ('regular', 'playoffs')
GROUP BY s.player_id, g.season, g.game_type
"""

_TEAM_GAME_TOTALS = f"""
INSERT INTO team_game_totals
    (game_id, team_id, opponent_id, season, date, game_type, score, opponent_score,
     won, streak, {", ".join(_TEAM_SUMS)})
WITH sides AS (
    SELECT id AS game_id, home_team_id AS team_id, away_team_id AS opponent_id, season,
           date, game_type, home_score AS score, away_score AS opponent_score
    FROM games
    WHERE game_type IN ('regular', 'playoffs') AND home_score + away_score > 0
    UNION ALL
    SELECT id, away_team_id, home_team_id, season, date, game_type, away_score, home_score
    FROM games
    WHERE game_type IN ('regular', 'playoffs') AND home_score + away_score > 0
),
runs AS (
    SELECT sides.*, score > opponent_score AS won,
           row_number() OVER (PARTITION BY team_id, season, game_type
                              ORDER BY date, game_id)
           - row_number() OVER (PARTITION BY team_id, season, game_type,
                                score > opponent_score
                                ORDER BY date, game_id) AS run
    FROM sides
),
box AS (
    SELECT game_id, team_id, {", ".join(f"sum({c}) AS {c}" for c in _TEAM_SUMS)}
    FROM player_game_stats
    GROUP BY game_id, team_id
)
SELECT r.game_id, r.team_id, r.opponent_id, r.season, r.date, r.game_type, r.score,
       r.opponent_score, r.won,
       row_number() OVER (PARTITION BY r.team_id, r.season, r.game_type, r.won, r.run
                          ORDER BY r.date, r.game_id),
       {", ".join(f"b.{c}" for c in _TEAM_SUMS)}
FROM runs AS r
LEFT JOIN box AS b ON b.game_id = r.game_id AND b.team_id = r.team_id
"""


def _id() -> sa.Column:
    return sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False)


def upgrade() -> None:
    """Hand-written, mirroring app.events.models.PlayerSeasonTotals and
    TeamGameTotals exactly: no foreign key (derived rows; nothing may block
    deleting a team or game) and no index but the primary key."""
    op.create_table(
        "player_season_totals",
        _id(),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("season", sa.Text(), nullable=False),
        sa.Column("game_type", sa.Text(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("games", sa.Integer(), nullable=False),
        *(sa.Column(name, sa.Integer(), nullable=False) for name in _PLAYER_SUMS),
        sa.Column("double_doubles", sa.Integer(), nullable=False),
        sa.Column("triple_doubles", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "team_game_totals",
        _id(),
        sa.Column("game_id", sa.BigInteger(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("opponent_id", sa.BigInteger(), nullable=False),
        sa.Column("season", sa.Text(), nullable=False),
        sa.Column("date", sa.DateTime(), nullable=False),
        sa.Column("game_type", sa.Text(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("opponent_score", sa.Integer(), nullable=False),
        sa.Column("won", sa.Boolean(), nullable=False),
        sa.Column("streak", sa.Integer(), nullable=False),
        *(sa.Column(name, sa.Integer(), nullable=True) for name in _TEAM_SUMS),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(_PLAYER_SEASON_TOTALS)
    op.execute(_TEAM_GAME_TOTALS)


def downgrade() -> None:
    op.drop_table("team_game_totals")
    op.drop_table("player_season_totals")
