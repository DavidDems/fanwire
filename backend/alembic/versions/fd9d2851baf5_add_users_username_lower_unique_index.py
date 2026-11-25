"""add a unique index on lower(username): usernames unique regardless of case

Revision ID: fd9d2851baf5
Revises: f2b8d4a6c9e3
Create Date: 2026-11-25 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fd9d2851baf5"
down_revision: str | Sequence[str] | None = "f2b8d4a6c9e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLLISIONS = sa.text(
    "SELECT array_agg(id ORDER BY id) FROM users "
    "GROUP BY lower(username) HAVING count(*) > 1 ORDER BY min(id)"
)


def upgrade() -> None:
    """Upgrade schema.

    USERS-011 (ADR 0042): Raptors and raptors can no longer both exist. The
    existing case-sensitive UNIQUE(username) stays; display keeps the typed
    case (ADR 0010).

    Names that already differ only by case are not resolved here: the upgrade
    refuses, naming each colliding group's user ids, never the usernames
    (app.migrate's error reaches CloudWatch), and creates nothing. Alembic runs
    the upgrade in one transaction (alembic/env.py), so the schema is left as it
    was and the human decides what happens to those accounts. The app does not
    depend on this index, so it works the same before this runs.
    """
    groups = [list(row[0]) for row in op.get_bind().execute(_COLLISIONS)]
    if groups:
        raise RuntimeError(
            f"{len(groups)} username group(s) collide when case is ignored, so "
            "ux_users_username_lower was not created. User ids by group: "
            + "; ".join(str(ids) for ids in groups)
            + ". Resolve them, then run the migration again."
        )
    op.create_index(
        "ux_users_username_lower",
        "users",
        [sa.text("lower(username)")],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ux_users_username_lower", table_name="users")
