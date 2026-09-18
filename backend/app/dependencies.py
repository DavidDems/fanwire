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
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.settings import Settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """12-factor config (wiki/CodeContext/Standards/design-principles.md):
    reads once from the environment, then serves the same cached instance
    for the life of the process — settings don't change without a redeploy.
    """
    # This is the one call site in app/ allowed to construct Settings
    # directly — every other caller goes through get_settings() instead.
    return Settings()


@lru_cache(maxsize=1)
def _get_session_factory() -> sessionmaker[Session]:
    # Process-wide engine/sessionmaker, built once, lazily, from
    # get_settings().database_url — never per-request (connection pooling
    # would be pointless otherwise).
    engine = make_engine(get_settings().database_url)
    return make_session_factory(engine)


@lru_cache(maxsize=1)
def get_event_bus() -> PostEventBus:
    """Process-wide PostEventBus. Real production wiring needs a real
    EventPublisher (EventBridge) adapter, which doesn't exist yet (no live
    AWS this phase) — this constructs one against InMemoryEventPublisher
    for now, same as every other "no real adapter built yet" precedent in
    this codebase (MalwareScanner, RateLimiter, SpamScorer). Route tests
    override this via app.dependency_overrides[get_event_bus], same
    pattern as get_session/get_token_verifier.

    NOTE (flagged for manager review): unlike those other precedents,
    this one is wired as the *default production* dependency, not just a
    test double — every PostCreated/PostMentionedEvent/PostReported/
    UserFollowed published through this dependency currently goes nowhere
    outside the process (no real EventBridge PutEvents call). That's
    consistent with Phase 2's known blockers (no notifications/feed/search
    subscriber exists until Phase 3), but it means the domain-event fan-out
    is a no-op end-to-end right now, which is worth a wiki note rather than
    staying implicit in this function.
    """
    return PostEventBus(InMemoryEventPublisher())


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
