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

import app.events.models  # noqa: F401 — registers Team/Game on Base.metadata
import app.media.models  # noqa: F401 — registers Media on Base.metadata
import app.posts.models  # noqa: F401 — registers Post/PostLike/EventMention/Report
import app.users.models  # noqa: F401 — registers User/Follow on Base.metadata
