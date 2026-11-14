"""drop the API-SPORTS ids from teams/games; nba.com ids become required

Revision ID: c5e8a2d4f9b1
Revises: b7d3e5a8c1f2
Create Date: 2026-10-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5e8a2d4f9b1"
down_revision: str | Sequence[str] | None = "b7d3e5a8c1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _rows_without_nba_ids() -> dict[str, int]:
    """The number of rows per table that have no nba.com id, for the tables
    where there is at least one."""
    bind = op.get_bind()
    counts = {
        "teams": bind.execute(
            sa.text("SELECT count(*) FROM teams WHERE nba_team_id IS NULL")
        ).scalar_one(),
        "games": bind.execute(
            sa.text("SELECT count(*) FROM games WHERE nba_game_id IS NULL")
        ).scalar_one(),
    }
    return {table: count for table, count in counts.items() if count}


def upgrade() -> None:
    """Upgrade schema.

    Hand-written, mirroring app.events.models.Team/Game exactly (EVENTS-003,
    see wiki/CodeContext/Modules/0x02-events.md): the API-SPORTS path is
    retired, so a Team or Game is keyed by its nba.com id alone. That id
    becomes NOT NULL (its unique constraint stays), the has-source-id CHECKs
    go, and the API-SPORTS id columns go, taking their unique constraints
    with them.

    A row with no nba.com id cannot survive this. Rather than delete it or
    invent an id for it, the upgrade stops before any DDL, naming the
    table(s) and row count(s), and changes nothing.
    """
    missing = _rows_without_nba_ids()
    if missing:
        found = ", ".join(f"{count} row(s) in {table}" for table, count in missing.items())
        raise RuntimeError(
            f"Cannot drop the API-SPORTS ids: {found} have no nba.com id "
            "(nba_team_id / nba_game_id). These rows are keyed only by API-SPORTS "
            "ids, e.g. the fixture teams and games an older scripts/seed_dev.py "
            "created. Delete them, or reset the dev database, then upgrade again. "
            "Nothing was changed."
        )

    op.alter_column("teams", "nba_team_id", existing_type=sa.BigInteger(), nullable=False)
    op.drop_constraint("ck_teams_has_source_id", "teams", type_="check")
    op.drop_column("teams", "api_sports_team_id")

    op.alter_column("games", "nba_game_id", existing_type=sa.BigInteger(), nullable=False)
    op.drop_constraint("ck_games_has_source_id", "games", type_="check")
    op.drop_column("games", "api_sports_game_id")


def downgrade() -> None:
    """Downgrade schema.

    Restores the API-SPORTS id columns as nullable, with the unique
    constraints under the names Postgres gave them in `aab36ebaba5f`, and
    the has-source-id CHECKs exactly as `b7d3e5a8c1f2` created them. Every
    row surviving the downgrade has an nba.com id, so the CHECKs hold.
    """
    op.add_column("games", sa.Column("api_sports_game_id", sa.Integer(), nullable=True))
    op.create_unique_constraint("games_api_sports_game_id_key", "games", ["api_sports_game_id"])
    op.create_check_constraint(
        "ck_games_has_source_id",
        "games",
        "api_sports_game_id IS NOT NULL OR nba_game_id IS NOT NULL",
    )
    op.alter_column("games", "nba_game_id", existing_type=sa.BigInteger(), nullable=True)

    op.add_column("teams", sa.Column("api_sports_team_id", sa.Integer(), nullable=True))
    op.create_unique_constraint("teams_api_sports_team_id_key", "teams", ["api_sports_team_id"])
    op.create_check_constraint(
        "ck_teams_has_source_id",
        "teams",
        "api_sports_team_id IS NOT NULL OR nba_team_id IS NOT NULL",
    )
    op.alter_column("teams", "nba_team_id", existing_type=sa.BigInteger(), nullable=True)
