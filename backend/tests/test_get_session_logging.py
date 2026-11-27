"""get_session logs every failure it turns into an HTTP answer.

A `SQLAlchemyError` and a `LifecycleUnavailable` both become a bare 503, so
without a log line the API's logs show nothing at all: during #123's deploy a
missing column left no trace. Each mapping now writes one record, and that
record must never carry the database URL, its password or a statement's
parameters (user data).

No database: the session factory is replaced with a stub, so these tests run
without Postgres.
"""

from __future__ import annotations

import io
import json
import logging

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

import app.dependencies as dependencies
from app.dependencies import get_session, get_settings
from app.users.lifecycle import LifecycleUnavailable

_PASSWORD = "s3cr3t-Pa55"
_HOST = "fanwire-db.internal.example"
_DATABASE_URL = f"postgresql+psycopg://fanwire:{_PASSWORD}@{_HOST}:5432/fanwire"
_PARAMETER = "someone@example.com"


class _StubSession:
    def __init__(self) -> None:
        self.rolled_back = False
        self.closed = False

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


@pytest.fixture()
def stub_session(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", _DATABASE_URL)
    get_settings.cache_clear()
    session = _StubSession()
    monkeypatch.setattr(dependencies, "_get_session_factory", lambda: lambda: session)
    yield session
    get_settings.cache_clear()


@pytest.fixture()
def session_log(monkeypatch):
    """What get_session's logger really emits, one JSON object per line.

    A powertools Logger binds its stream when it is built, so capsys does not
    see it; alembic's fileConfig (run by migration tests earlier in the same
    process) disables existing loggers, so this switches it back on.
    """
    logger = dependencies.logger
    monkeypatch.setattr(logging.getLogger(logger.name), "disabled", False)
    handler = logger.registered_handler
    buffer = io.StringIO()
    previous = handler.setStream(buffer)
    yield buffer
    handler.setStream(previous)


def _records(buffer: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in buffer.getvalue().splitlines() if line.strip()]


def _client_raising(exc: Exception) -> TestClient:
    app = FastAPI()

    @app.get("/probe")
    def probe(session: Session = Depends(get_session)) -> dict[str, str]:
        raise exc

    return TestClient(app, raise_server_exceptions=False)


def _database_error() -> OperationalError:
    driver_error = Exception(
        f'connection to server at "{_HOST}" failed: password authentication failed '
        f"for user \"fanwire\" (dsn {_DATABASE_URL}, password={_PASSWORD})"
    )
    return OperationalError("SELECT * FROM users WHERE email = %(email)s",
                            {"email": _PARAMETER}, driver_error)


def test_a_database_error_still_answers_503(stub_session, session_log):
    response = _client_raising(_database_error()).get("/probe")

    assert response.status_code == 503
    assert response.json() == {"detail": "Account temporarily unavailable"}
    assert stub_session.rolled_back
    assert stub_session.closed


def test_a_database_error_writes_one_error_record_with_its_type(stub_session, session_log):
    _client_raising(_database_error()).get("/probe")

    [record] = _records(session_log)
    assert record["level"] == "ERROR"
    assert record["exception_type"] == "OperationalError"
    assert "password authentication failed" in record["reason"]


def test_the_database_error_record_carries_no_secret_and_no_parameter(stub_session, session_log):
    _client_raising(_database_error()).get("/probe")

    emitted = session_log.getvalue()
    assert emitted
    for secret in (_PASSWORD, _DATABASE_URL, "fanwire:" + _PASSWORD, _PARAMETER):
        assert secret not in emitted, f"log leaked {secret!r}"


def test_lifecycle_unavailable_still_answers_503(stub_session, session_log):
    response = _client_raising(
        LifecycleUnavailable("Account authority schema unavailable")
    ).get("/probe")

    assert response.status_code == 503
    assert response.json() == {"detail": "Account temporarily unavailable"}
    assert stub_session.rolled_back


def test_lifecycle_unavailable_writes_one_warning_record(stub_session, session_log):
    _client_raising(LifecycleUnavailable("Account authority schema unavailable")).get("/probe")

    [record] = _records(session_log)
    assert record["level"] == "WARNING"
    assert record["exception_type"] == "LifecycleUnavailable"
    assert record["reason"] == "Account authority schema unavailable"


def test_a_request_that_succeeds_logs_nothing(stub_session, session_log):
    app = FastAPI()

    @app.get("/probe")
    def probe(session: Session = Depends(get_session)) -> dict[str, str]:
        return {"ok": "yes"}

    assert TestClient(app).get("/probe").status_code == 200
    assert _records(session_log) == []
