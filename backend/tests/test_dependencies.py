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
from testcontainers.postgres import PostgresContainer

from app.db import make_engine, make_session_factory
from app.dependencies import get_session, get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    # get_settings is process-wide lru_cache(maxsize=1) state — clear it
    # before and after every test so tests never leak a cached Settings
    # instance into one another.
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_get_settings_returns_a_cached_instance(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")

    first = get_settings()
    second = get_settings()

    assert first is second


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


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
