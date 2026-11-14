"""add players and box scores; game labels and line scores; drop games.player_stats

Revision ID: d9f3b6a1e2c4
Revises: c5e8a2d4f9b1
Create Date: 2026-10-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9f3b6a1e2c4"
down_revision: str | Sequence[str] | None = "c5e8a2d4f9b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Hand-written, mirroring app.events.models.Player/PlayerGameStats/Game
    exactly (EVENTS-004). Existing teams and games keep their rows and ids:
    the new game columns are nullable, filled by the dataset loader.
    games.player_stats is dropped with whatever it held; the loader rebuilds
    every box score from the dataset into player_game_stats.
    """
    op.create_table(
        "players",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("nba_person_id", sa.BigInteger(), nullable=False),
        sa.Column("first_name", sa.Text(), nullable=True),
        sa.Column("last_name", sa.Text(), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("height_inches", sa.Integer(), nullable=True),
        sa.Column("weight_lbs", sa.Integer(), nullable=True),
        sa.Column("country", sa.Text(), nullable=True),
        sa.Column("school", sa.Text(), nullable=True),
        sa.Column("jersey", sa.Text(), nullable=True),
        sa.Column("position", sa.Text(), nullable=True),
        sa.Column("draft_year", sa.Integer(), nullable=True),
        sa.Column("draft_round", sa.Integer(), nullable=True),
        sa.Column("draft_number", sa.Integer(), nullable=True),
        sa.Column("first_season", sa.Text(), nullable=True),
        sa.Column("last_season", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("nba_person_id"),
    )
    op.create_table(
        "player_game_stats",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("game_id", sa.BigInteger(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("starter", sa.Boolean(), nullable=False),
        sa.Column("starting_position", sa.Text(), nullable=True),
        sa.Column("seconds_played", sa.Integer(), nullable=True),
        sa.Column("field_goals_made", sa.Integer(), nullable=False),
        sa.Column("field_goals_attempted", sa.Integer(), nullable=False),
        sa.Column("three_pointers_made", sa.Integer(), nullable=False),
        sa.Column("three_pointers_attempted", sa.Integer(), nullable=False),
        sa.Column("free_throws_made", sa.Integer(), nullable=False),
        sa.Column("free_throws_attempted", sa.Integer(), nullable=False),
        sa.Column("offensive_rebounds", sa.Integer(), nullable=False),
        sa.Column("defensive_rebounds", sa.Integer(), nullable=False),
        sa.Column("rebounds", sa.Integer(), nullable=False),
        sa.Column("assists", sa.Integer(), nullable=False),
        sa.Column("steals", sa.Integer(), nullable=False),
        sa.Column("blocks", sa.Integer(), nullable=False),
        sa.Column("turnovers", sa.Integer(), nullable=False),
        sa.Column("personal_fouls", sa.Integer(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("plus_minus", sa.Integer(), nullable=False),
        sa.Column("dnp_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"]),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("game_id", "player_id", name="uq_player_game_stats_game_player"),
    )
    op.create_index("ix_player_game_stats_player_id", "player_game_stats", ["player_id"])

    op.add_column("games", sa.Column("label", sa.Text(), nullable=True))
    op.add_column("games", sa.Column("sub_label", sa.Text(), nullable=True))
    op.add_column("games", sa.Column("series_game_number", sa.Integer(), nullable=True))
    op.add_column(
        "games", sa.Column("home_line_score", postgresql.ARRAY(sa.Integer()), nullable=True)
    )
    op.add_column(
        "games", sa.Column("away_line_score", postgresql.ARRAY(sa.Integer()), nullable=True)
    )

    op.drop_index("ix_games_player_stats_gin", table_name="games")
    op.drop_column("games", "player_stats")


def downgrade() -> None:
    """Downgrade schema. games.player_stats comes back as an empty array on
    every row: the box scores are not copied back into it."""
    op.add_column(
        "games",
        sa.Column(
            "player_stats",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    # The default only fills existing rows; the column never had one.
    op.alter_column("games", "player_stats", server_default=None)
    op.create_index(
        "ix_games_player_stats_gin",
        "games",
        ["player_stats"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"player_stats": "jsonb_path_ops"},
    )

    op.drop_column("games", "away_line_score")
    op.drop_column("games", "home_line_score")
    op.drop_column("games", "series_game_number")
    op.drop_column("games", "sub_label")
    op.drop_column("games", "label")

    op.drop_index("ix_player_game_stats_player_id", table_name="player_game_stats")
    op.drop_table("player_game_stats")
    op.drop_table("players")
