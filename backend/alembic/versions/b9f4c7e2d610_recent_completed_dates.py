"""Index completed calendar dates for the recent games window.

Revision ID: b9f4c7e2d610
Revises: e6d7328e8881
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b9f4c7e2d610"
down_revision: str | Sequence[str] | None = "e6d7328e8881"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_games_completed_date",
        "games",
        [sa.text("date(date)")],
        postgresql_where=sa.text("home_score + away_score > 0"),
    )


def downgrade() -> None:
    op.drop_index("ix_games_completed_date", table_name="games")
