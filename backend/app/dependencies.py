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
from typing import Any

import boto3  # type: ignore[import-untyped]  # no boto3 stubs/py.typed marker installed
from sqlalchemy.orm import Session, sessionmaker

from app.db import make_engine, make_session_factory
from app.eventbus import EventBridgePublisher, EventPublisher, InMemoryEventPublisher, PostEventBus
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
def _events_client() -> Any:
    # Process-wide boto3 EventBridge client, built once from get_settings()'s
    # region — same "build once, cache, inject" shape as
    # app.media.dependencies.get_s3_client.
    return boto3.client("events", region_name=get_settings().aws_default_region)


@lru_cache(maxsize=1)
def get_event_bus() -> PostEventBus:
    """Process-wide PostEventBus. Real production wiring per
    wiki/CodeContext/Modules/0x00-architecture.md "PostEventBus
    implementation": once Settings.post_event_bus_name (POST_EVENT_BUS_NAME,
    infra/lib/app-stack.ts) is set, this wires the real EventBridgePublisher
    adapter (app.eventbus.EventBridgePublisher, boto3 `events.put_events`);
    otherwise it falls back to InMemoryEventPublisher, same as before, for
    local dev/tests where no real bus exists. Route tests override this via
    app.dependency_overrides[get_event_bus], same pattern as
    get_session/get_token_verifier.
    """
    settings = get_settings()
    publisher: EventPublisher
    if settings.post_event_bus_name:
        publisher = EventBridgePublisher(
            _events_client(), event_bus_name=settings.post_event_bus_name
        )
    else:
        publisher = InMemoryEventPublisher()
    return PostEventBus(publisher)


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


def open_session() -> Session:
    """Plain, caller-closed Session for non-FastAPI callers — the three
    Lambda handlers (app.events/app.media/app.notifications.lambda_handler),
    which have no request/response lifecycle for get_session's generator
    dependency to hook into. Callers are responsible for closing it (a
    `try/finally` around the handler body, same shape as get_session's own
    finally block) — this function itself doesn't, since there's no
    generator teardown to do it for them here."""
    return _get_session_factory()()
