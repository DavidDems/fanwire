"""Cross-cutting FastAPI dependency wiring shared by every module's routes
— Settings and a request-scoped DB Session.

Phase 0/1 built pure Python modules, never routes, so nothing needed
Settings or a Session injected via FastAPI DI before. Phase 2a's routes
are the first to need either, and every module's routes after it will too,
so this lives at the top level rather than inside any one module (per
AGENTS.md's connection rule — no module owns cross-cutting DI).

Dependency Inversion (wiki/CodeContext/Standards/design-principles.md):
routes depend on these functions, never on `Settings()` or a SQLAlchemy
engine directly, so route tests can override `get_session` with a
generator bound to a throwaway/test database via
`app.dependency_overrides[get_session] = ...` — the same override pattern
already used for `app.users.dependencies.get_token_verifier`.
"""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy.orm import Session, sessionmaker

from app.db import make_engine, make_session_factory
from app.settings import Settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """12-factor config (wiki/CodeContext/Standards/design-principles.md):
    reads once from the environment, then serves the same cached instance
    for the life of the process — settings don't change without a redeploy.
    """
    # pydantic-settings populates required-but-undefaulted fields (e.g.
    # database_url) from the environment at construction time; mypy has no
    # way to see that, hence the ignore. This is the one call site in app/
    # allowed to construct Settings directly — every other caller goes
    # through get_settings() instead of re-triggering this same gap.
    return Settings()  # type: ignore[call-arg]


@lru_cache(maxsize=1)
def _get_session_factory() -> sessionmaker[Session]:
    # Process-wide engine/sessionmaker, built once, lazily, from
    # get_settings().database_url — never per-request (connection pooling
    # would be pointless otherwise).
    engine = make_engine(get_settings().database_url)
    return make_session_factory(engine)


def get_session() -> Iterator[Session]:
    """Request-scoped Session: one per request, closed when the request
    finishes regardless of success or failure (finally block) — never
    shared across requests, never leaked. Route tests override this
    entirely via `app.dependency_overrides[get_session]`, typically bound
    to a testcontainers Postgres instance.
    """
    session = _get_session_factory()()
    try:
        yield session
    finally:
        session.close()
