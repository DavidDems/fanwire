"""Tests for app.dependencies — cross-cutting FastAPI DI (Settings, DB
Session) shared by every module's routes, per AGENTS.md TDD workflow.
Written before app/dependencies.py exists.

Phase 0/1 only built pure Python modules, never routes, so no route in
this codebase has needed a DB session or Settings instance via FastAPI
dependency injection before. Route tests in this phase and later ones
override get_session the same way tests/users/test_dependencies.py already
overrides get_token_verifier — this proves that override mechanism works
here too, against a throwaway route (per the task's instructions not to
touch app.main this phase), and that the real get_session hands back a
working, request-scoped Session backed by a real Postgres (testcontainers,
matching tests/test_db_session.py's pattern — no in-memory substitute, per
wiki/CodeContext/Standards/design-principles.md testing pyramid guidance).
"""

from collections.abc import Iterator

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session, get_settings
from app.eventbus import EventBridgePublisher, InMemoryEventPublisher


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    # get_settings/get_event_bus are process-wide lru_cache(maxsize=1)
    # state — clear both before and after every test so tests never leak a
    # cached instance into one another.
    get_settings.cache_clear()
    get_event_bus.cache_clear()
    yield
    get_settings.cache_clear()
    get_event_bus.cache_clear()


def test_get_settings_returns_a_cached_instance(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")

    first = get_settings()
    second = get_settings()

    assert first is second


def test_get_event_bus_defaults_to_in_memory_publisher_when_no_bus_name_configured(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("POST_EVENT_BUS_NAME", raising=False)

    bus = get_event_bus()

    assert isinstance(bus._publisher, InMemoryEventPublisher)


def test_get_event_bus_wires_real_event_bridge_publisher_when_bus_name_configured(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("POST_EVENT_BUS_NAME", "PostEventBus")

    bus = get_event_bus()

    assert isinstance(bus._publisher, EventBridgePublisher)
    assert bus._publisher._event_bus_name == "PostEventBus"


def test_get_event_bus_returns_a_cached_instance(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")

    assert get_event_bus() is get_event_bus()


def _make_probe_app() -> FastAPI:
    app = FastAPI()

    @app.get("/probe")
    def probe(session: Session = Depends(get_session)) -> dict[str, int]:
        result = session.execute(text("SELECT 1")).scalar_one()
        return {"result": result}

    return app


def _override_get_session(database_url: str):
    def _session_override() -> Iterator[Session]:
        engine = make_engine(database_url)
        factory = make_session_factory(engine)
        session = factory()
        try:
            yield session
        finally:
            session.close()

    return _session_override


def test_get_session_override_is_honored_and_returns_a_working_session(postgres_url):
    app = _make_probe_app()
    app.dependency_overrides[get_session] = _override_get_session(postgres_url)
    client = TestClient(app)

    response = client.get("/probe")

    assert response.status_code == 200
    assert response.json() == {"result": 1}
