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
from aws_lambda_powertools import Logger
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.db import make_engine, make_session_factory
from app.eventbus import EventBridgePublisher, EventPublisher, InMemoryEventPublisher, PostEventBus
from app.notifications.local_dispatch import LocalDispatchPublisher
from app.settings import Settings

logger = Logger()


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
    adapter (app.eventbus.EventBridgePublisher, boto3 `events.put_events`).
    Without a bus name, ENVIRONMENT exactly "development" (the local stack,
    which Settings refuses on any deployment) wires LocalDispatchPublisher,
    so events reach the notifications consumer in process. Anything else falls
    back to InMemoryEventPublisher, same as before, where no real bus exists.
    Route tests override this via app.dependency_overrides[get_event_bus],
    same pattern as get_session/get_token_verifier.
    """
    settings = get_settings()
    publisher: EventPublisher
    if settings.post_event_bus_name:
        publisher = EventBridgePublisher(
            _events_client(), event_bus_name=settings.post_event_bus_name
        )
    elif settings.environment == "development":
        publisher = LocalDispatchPublisher(open_session)
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
    except RuntimeError as exc:
        from app.users.lifecycle import LifecycleUnavailable
        if isinstance(exc, LifecycleUnavailable):
            session.rollback()
            logger.warning(
                "account lifecycle unavailable",
                extra={"exception_type": type(exc).__name__, "reason": _log_reason(exc)},
            )
            raise HTTPException(status_code=503, detail="Account temporarily unavailable") from None
        raise
    except ValueError as exc:
        from app.users.lifecycle import AccountRestricted
        if isinstance(exc, AccountRestricted):
            session.rollback()
            raise HTTPException(status_code=403, detail="account_unavailable") from None
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error(
            "database error",
            extra={"exception_type": type(exc).__name__, "reason": _log_reason(exc)},
        )
        raise HTTPException(status_code=503, detail="Account temporarily unavailable") from None
    finally:
        session.close()


def _log_reason(exc: Exception) -> str:
    """The exception's message as far as a log may carry it.

    Only the first line: SQLAlchemy appends the statement and its parameters
    (user data) on later lines, and the driver's DETAIL lines can quote row
    values. The line kept is still redacted with `app.migrate.redact`, since a
    connection failure can carry the connect string and its password.
    """
    # Imported here, on the failure path only: app.migrate brings alembic with
    # it, which the API's cold start has no other use for.
    from app.migrate import redact

    first_line = str(exc).partition("\n")[0]
    return redact(first_line, get_settings().database_url)


def open_session() -> Session:
    """Plain, caller-closed Session for non-FastAPI callers — the two
    Lambda handlers (app.media/app.notifications.lambda_handler),
    which have no request/response lifecycle for get_session's generator
    dependency to hook into. Callers are responsible for closing it (a
    `try/finally` around the handler body, same shape as get_session's own
    finally block) — this function itself doesn't, since there's no
    generator teardown to do it for them here."""
    return _get_session_factory()()
