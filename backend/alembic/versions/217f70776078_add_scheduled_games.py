"""add scheduled_games, a season's published schedule (EVENTS-014)

Revision ID: 217f70776078
Revises: b9e4d7c2a601
Create Date: 2026-11-07 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "217f70776078"
down_revision: str | Sequence[str] | None = "b9e4d7c2a601"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Hand-written, mirroring app.events.models.ScheduledGame exactly: the
    constraint names are those Base.metadata.create_all gives the model.
    No existing table changes, and nothing references the new one."""
    op.create_table(
        "scheduled_games",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("nba_game_id", sa.BigInteger(), nullable=False),
        sa.Column("season", sa.Text(), nullable=False),
        sa.Column("date", sa.DateTime(), nullable=False),
        sa.Column("time_tbd", sa.Boolean(), nullable=False),
        sa.Column("game_type", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("sub_label", sa.Text(), nullable=True),
        sa.Column("venue", sa.Text(), nullable=True),
        sa.Column("series_game_number", sa.Integer(), nullable=True),
        sa.Column("home_team_id", sa.BigInteger(), nullable=True),
        sa.Column("away_team_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="scheduled_games_pkey"),
        sa.UniqueConstraint("nba_game_id", name="scheduled_games_nba_game_id_key"),
        sa.ForeignKeyConstraint(
            ["home_team_id"], ["teams.id"], name="scheduled_games_home_team_id_fkey"
        ),
        sa.ForeignKeyConstraint(
            ["away_team_id"], ["teams.id"], name="scheduled_games_away_team_id_fkey"
        ),
    )
    op.create_index("ix_scheduled_games_season_date", "scheduled_games", ["season", "date"])


def downgrade() -> None:
    op.drop_index("ix_scheduled_games_season_date", table_name="scheduled_games")
    op.drop_table("scheduled_games")
