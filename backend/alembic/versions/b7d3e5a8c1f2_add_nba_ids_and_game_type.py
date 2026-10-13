"""add nba.com ids and game_type to teams/games

Revision ID: b7d3e5a8c1f2
Revises: f4a1c9d2b6e7
Create Date: 2026-10-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d3e5a8c1f2"
down_revision: str | Sequence[str] | None = "f4a1c9d2b6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Hand-written, mirroring app.events.models.Team/Game exactly (EVENTS-001,
    see wiki/CodeContext/Modules/0x02-events.md): a Team or Game is now keyed
    by its nba.com id (the Kaggle "NBA games" dataset), its API-SPORTS id, or
    both, so the API-SPORTS id loses its NOT NULL and a named CHECK requires
    at least one. Unique constraints take Postgres's default names, the same
    names `Base.metadata.create_all` gives the models' `unique=True`.
    """
    op.add_column("teams", sa.Column("nba_team_id", sa.BigInteger(), nullable=True))
    op.create_unique_constraint("teams_nba_team_id_key", "teams", ["nba_team_id"])
    op.alter_column("teams", "api_sports_team_id", existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint(
        "ck_teams_has_source_id",
        "teams",
        "api_sports_team_id IS NOT NULL OR nba_team_id IS NOT NULL",
    )

    op.add_column("games", sa.Column("nba_game_id", sa.BigInteger(), nullable=True))
    op.create_unique_constraint("games_nba_game_id_key", "games", ["nba_game_id"])
    op.alter_column("games", "api_sports_game_id", existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint(
        "ck_games_has_source_id",
        "games",
        "api_sports_game_id IS NOT NULL OR nba_game_id IS NOT NULL",
    )
    op.add_column("games", sa.Column("game_type", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema.

    Restoring NOT NULL on the API-SPORTS id columns fails on any row that
    has only an nba.com id. That is deliberate: such rows cannot exist in
    the old schema, so they must be removed before downgrading, never given
    an invented API-SPORTS id here.
    """
    op.drop_column("games", "game_type")
    op.drop_constraint("ck_games_has_source_id", "games", type_="check")
    op.alter_column("games", "api_sports_game_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("games_nba_game_id_key", "games", type_="unique")
    op.drop_column("games", "nba_game_id")

    op.drop_constraint("ck_teams_has_source_id", "teams", type_="check")
    op.alter_column("teams", "api_sports_team_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("teams_nba_team_id_key", "teams", type_="unique")
    op.drop_column("teams", "nba_team_id")
