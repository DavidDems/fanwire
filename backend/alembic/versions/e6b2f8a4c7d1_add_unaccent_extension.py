"""add the unaccent extension for the player name search

Revision ID: e6b2f8a4c7d1
Revises: d9f3b6a1e2c4
Create Date: 2026-10-15 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6b2f8a4c7d1"
down_revision: str | Sequence[str] | None = "d9f3b6a1e2c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Postgres's `unaccent` extension, for GET /events/players' accent-
    insensitive name search (EVENTS-006): 'doncic' finds 'Dončić'. No index:
    unaccent() is not IMMUTABLE, and ~2,400 players are a sequential scan.
    Creating an extension needs the master user, which is who the Migration
    Lambda connects as.
    """
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP EXTENSION IF EXISTS unaccent")
