"""POSTS-010: MediaCountRateLimiter, the per-user limit on media uploads.
Written before it exists.

Same shape as tests/posts/test_rate_limiter.py (POSTS-002), against media/'s
own interface: the limiter counts the uploader's own rows in `media`, every
status alike, over two sliding windows (one minute, one hour) in one SQL
statement, measured against Postgres's `now()`. Rows are placed in time with
`created_at = now() - make_interval(secs => N)` in the SAME transaction the
limiter then runs in, so `now()` is the exact same instant on both sides and
the boundaries can be tested exactly.

app.media.rate_limit is imported inside each test (`_rate_limit()`), so each
test fails on its own missing module or name instead of the whole module
failing to collect.
"""

from __future__ import annotations

import ast
import importlib
from datetime import date
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import event, text

from app.db import Base, make_engine, make_session_factory
from app.users.models import User

MINUTE = 60
HOUR = 3600
_MEDIA_DIR = Path(__file__).resolve().parents[2] / "app" / "media"


def _rate_limit() -> ModuleType:
    return importlib.import_module("app.media.rate_limit")


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session(engine):
    with make_session_factory(engine)() as session:
        yield session


def _make_user(session, username: str) -> User:
    user = User(cognito_sub=f"sub-{username}", username=username, date_of_birth=date(1990, 1, 1))
    session.add(user)
    session.flush()
    return user


def _place_media(
    session, uploader_id: int, count: int, age_seconds: int, status: str = "UPLOADED"
) -> None:
    """`count` Media rows by `uploader_id` at `status`, each created exactly
    `age_seconds` before the current transaction's now(). No commit: the
    limiter must run in the same transaction to see the same now()."""
    session.execute(
        text(
            "INSERT INTO media (uploader_id, status, created_at) "
            "SELECT :uploader_id, CAST(:status AS media_status), "
            "now() - make_interval(secs => :age) "
            "FROM generate_series(1, :count)"
        ),
        {"uploader_id": uploader_id, "status": status, "age": age_seconds, "count": count},
    )


def _limiter(session, per_minute: int = 5, per_hour: int = 20):
    return _rate_limit().MediaCountRateLimiter(session, per_minute=per_minute, per_hour=per_hour)


# --- interface --------------------------------------------------------------


def test_media_count_rate_limiter_implements_upload_rate_limiter(session):
    assert isinstance(_limiter(session), _rate_limit().UploadRateLimiter)


def test_the_fake_implements_upload_rate_limiter():
    module = _rate_limit()
    assert module.FakeUploadRateLimiter(True).is_allowed(1) is True
    assert module.FakeUploadRateLimiter(False).is_allowed(1) is False
    assert isinstance(module.FakeUploadRateLimiter(True), module.UploadRateLimiter)


def test_a_user_with_no_uploads_is_allowed(session):
    uploader = _make_user(session, "fresh")

    assert _limiter(session).is_allowed(uploader.id) is True


# --- the minute window ------------------------------------------------------


def test_four_uploads_in_the_last_minute_allows_one_more(session):
    uploader = _make_user(session, "four")
    _place_media(session, uploader.id, 4, age_seconds=5)

    assert _limiter(session).is_allowed(uploader.id) is True


def test_five_uploads_in_the_last_minute_is_refused(session):
    uploader = _make_user(session, "five")
    _place_media(session, uploader.id, 5, age_seconds=5)

    assert _limiter(session).is_allowed(uploader.id) is False


def test_an_upload_59_seconds_old_counts_against_the_minute(session):
    uploader = _make_user(session, "minute_59")
    _place_media(session, uploader.id, 1, age_seconds=59)

    assert _limiter(session, per_minute=1).is_allowed(uploader.id) is False


def test_an_upload_exactly_60_seconds_old_no_longer_counts_against_the_minute(session):
    uploader = _make_user(session, "minute_60")
    _place_media(session, uploader.id, 1, age_seconds=60)

    assert _limiter(session, per_minute=1).is_allowed(uploader.id) is True


def test_an_upload_61_seconds_old_does_not_count_against_the_minute(session):
    uploader = _make_user(session, "minute_61")
    _place_media(session, uploader.id, 1, age_seconds=61)

    assert _limiter(session, per_minute=1).is_allowed(uploader.id) is True


# --- the hour window --------------------------------------------------------


def test_nineteen_uploads_in_the_last_hour_none_in_the_last_minute_allows_one_more(session):
    uploader = _make_user(session, "nineteen")
    _place_media(session, uploader.id, 19, age_seconds=2 * MINUTE)

    assert _limiter(session).is_allowed(uploader.id) is True


def test_twenty_uploads_in_the_last_hour_is_refused(session):
    uploader = _make_user(session, "twenty")
    _place_media(session, uploader.id, 20, age_seconds=2 * MINUTE)

    assert _limiter(session).is_allowed(uploader.id) is False


def test_an_upload_3599_seconds_old_counts_against_the_hour(session):
    uploader = _make_user(session, "hour_3599")
    _place_media(session, uploader.id, 1, age_seconds=HOUR - 1)

    assert _limiter(session, per_hour=1).is_allowed(uploader.id) is False


def test_an_upload_exactly_3600_seconds_old_no_longer_counts_against_the_hour(session):
    uploader = _make_user(session, "hour_3600")
    _place_media(session, uploader.id, 1, age_seconds=HOUR)

    assert _limiter(session, per_hour=1).is_allowed(uploader.id) is True


def test_uploads_older_than_an_hour_never_refuse(session):
    uploader = _make_user(session, "old_timer")
    _place_media(session, uploader.id, 100, age_seconds=HOUR + 1)

    assert _limiter(session).is_allowed(uploader.id) is True


# --- whose rows count -------------------------------------------------------


def test_other_users_uploads_never_refuse_this_user(session):
    uploader = _make_user(session, "quiet")
    other = _make_user(session, "loud")
    _place_media(session, other.id, 30, age_seconds=1)

    assert _limiter(session).is_allowed(uploader.id) is True
    assert _limiter(session).is_allowed(other.id) is False


@pytest.mark.parametrize("status", ["UPLOADED", "SCANNING", "PROCESSED", "REJECTED"])
def test_every_status_counts(session, status):
    """A rejected or abandoned row still cost a presign: counting only some
    statuses would let a user dodge the limit by abandoning uploads."""
    uploader = _make_user(session, f"status_{status.lower()}")
    _place_media(session, uploader.id, 1, age_seconds=1, status=status)

    assert _limiter(session, per_minute=1).is_allowed(uploader.id) is False


# --- one statement ----------------------------------------------------------


def test_one_check_issues_exactly_one_sql_statement(engine, session):
    uploader = _make_user(session, "counted")
    _place_media(session, uploader.id, 3, age_seconds=5)
    session.flush()
    limiter = _limiter(session)

    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        limiter.is_allowed(uploader.id)
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    assert len(statements) == 1, statements


# --- module boundary --------------------------------------------------------


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


@pytest.mark.parametrize("filename", ["rate_limit.py", "dependencies.py", "routes.py"])
def test_the_upload_limit_never_imports_posts(filename):
    """0x00-architecture.md Connection rule: media/'s limiter is its own
    interface, never app.posts.moderation's RateLimiter."""
    imported = _imported_modules(_MEDIA_DIR / filename)

    assert not any(name == "app.posts" or name.startswith("app.posts.") for name in imported)
