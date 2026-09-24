"""Registers every module's SQLAlchemy models on app.db.Base's shared
metadata before any test runs, regardless of which test file pytest
happens to collect/import first.

Why this exists: SQLAlchemy's declarative registry (Base.metadata) is
populated by the side effect of importing a model module, and it's
process-global, not per-test-file. Once users/'s and media/'s deferred FKs
closed (posts/ FK-closure unit), users.profile_picture_media_id gained a
real `ForeignKey("media.id")` — resolving that string FK at
Base.metadata.create_all() time requires app.media.models to have been
imported into the process first, purely for its class-definition side
effect, not because any test actually touches Media. A test file that only
imports app.posts.models (which imports app.users.models, not
app.media.models) and calls Base.metadata.create_all() directly hits
`NoReferencedTableError: ... could not find table 'media'` — confirmed:
before this file existed, `docker compose run --rm backend-test --
tests/posts/test_models.py` failed in isolation with exactly that error,
while the full suite passed only by accident of pytest's alphabetical
collection order (media/'s test files happen to import app.media.models
before posts/'s test files run). alembic/env.py already solved the same
problem for autogenerate by importing every model module up front; this
file does the same thing for the test suite, per AGENTS.md's connection-
rule spirit of "modules touch each other only through their real, already-
built interfaces" applying here at the schema-registration level too, not
just at the application-code level.
"""

import re

import pytest
import sqlalchemy
from testcontainers.postgres import PostgresContainer

from app.events import models as _events_models  # noqa: F401 — registers Team/Game
from app.media import models as _media_models  # noqa: F401 — registers Media
from app.notifications import models as _notifications_models  # noqa: F401 — registers Notification
from app.posts import models as _posts_models  # noqa: F401 — Post/PostLike/EventMention/Report
from app.users import models as _users_models  # noqa: F401 — registers User/Follow

# Each import above is aliased to a distinct name (rather than this repo's
# usual `import app.x.models` form) so ruff's F401 check treats every one
# independently. With the shared `import app.x.models` form, all four
# statements bind the same top-level `app` name, and pyflakes/ruff consider
# an earlier import "used" by a later one that also touches `app` - which
# made three of the four `# noqa: F401` comments spuriously "unused"
# (RUF100) depending purely on import order, not on whether the import
# itself does anything. Distinct aliases make every noqa genuinely
# necessary and order-independent.


# --------------------------------------------------------------------- database


@pytest.fixture(scope="session")
def _postgres_server():
    """One Postgres *server* for the whole suite.

    This replaces 39 byte-identical `scope="module"` fixtures that each started
    their own `postgres:16-alpine`. Measured locally, every extra module added
    ~4.5-5.4s of container startup while the tests inside it took well under a
    second: the suite's cost scaled with the number of FILES, not with the
    amount of testing in them.
    """
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg


@pytest.fixture(scope="module")
def postgres_url(_postgres_server, request):
    """A fresh, empty DATABASE per test module, on that one shared server.

    The database is per-module, not per-suite, and that is the whole point.
    Sharing one database across modules looks like it works - every test still
    does `create_all` and `drop_all` around itself - right up until a module
    leaves a table behind. `create_all` does not make the schema match the
    metadata; it creates tables that are *not already there*. A leftover
    `users` table is silently accepted, and the next module fails on a column
    the leftover does not have.

    That is not hypothetical: it is what the first version of this fixture did,
    and `test_age_gate.py` caught it with
    `UndefinedColumn: column users.search_vector does not exist` - because
    `test_migrations.py` builds its schema with alembic rather than
    `create_all`, so the two disagree about what `users` looks like.

    `CREATE DATABASE` costs milliseconds against a running server, so this
    keeps the isolation the per-module containers were quietly providing and
    still pays for the container once.
    """
    # Keyed on the module's full path, not its basename: five modules are
    # called test_models.py. Sequential runs would survive a collision, since
    # each module drops and recreates before use, but two modules sharing a
    # database is the exact bug this fixture exists to prevent.
    name = "t_" + re.sub(r"\W", "_", request.node.nodeid).lower()[-50:].strip("_")
    admin_url = _postgres_server.get_connection_url().replace("psycopg2", "psycopg")

    engine = sqlalchemy.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text(f'DROP DATABASE IF EXISTS "{name}"'))
        conn.execute(sqlalchemy.text(f'CREATE DATABASE "{name}"'))
    engine.dispose()

    yield admin_url.rsplit("/", 1)[0] + "/" + name

    engine = sqlalchemy.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    engine.dispose()
