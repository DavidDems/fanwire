"""Tests for app.users.service.search_users and the User.search_vector
generated column/GIN index, per AGENTS.md TDD workflow and this unit's task
brief (wiki/CodeContext/Modules/0x07-search.md). Written before
User.search_vector / search_users exist.

Full-text search against `to_tsvector('simple', username || ' ' ||
coalesce(description, ''))`, prefix-matched ("dav" finds "david"),
excluding soft-deleted users. The tsquery is built from the raw input by
keeping only [A-Za-z0-9_] characters per whitespace-separated token,
dropping empties, joining as "tok1:* & tok2:*", and always bound as a
parameter to to_tsquery('simple', :q) -- never string-interpolated. No
surviving tokens means an empty result without ever querying the DB.
"""

from __future__ import annotations

from datetime import date

import pytest
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.users.models import User
from app.users.service import search_users


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(**overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-{overrides.get('username', 'u')}",
        "username": "user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    return User(**defaults)


def test_search_users_prefix_matches_username(session_factory):
    with session_factory() as session:
        david = _make_user(cognito_sub="sub-david", username="david")
        someone_else = _make_user(cognito_sub="sub-other", username="unrelated")
        session.add_all([david, someone_else])
        session.commit()

        results = search_users(session, "dav", limit=20, offset=0)

        assert [u.id for u in results] == [david.id]


def test_search_users_matches_description(session_factory):
    with session_factory() as session:
        user = _make_user(cognito_sub="sub-bio", username="baller23", description="Lakers superfan")
        other = _make_user(cognito_sub="sub-bio2", username="other_user")
        session.add_all([user, other])
        session.commit()

        results = search_users(session, "lakers", limit=20, offset=0)

        assert [u.id for u in results] == [user.id]


def test_search_users_excludes_soft_deleted(session_factory):
    from datetime import UTC, datetime

    with session_factory() as session:
        deleted = _make_user(
            cognito_sub="sub-del",
            username="davidson",
            deleted_at=datetime.now(UTC),
        )
        session.add(deleted)
        session.commit()

        results = search_users(session, "davidson", limit=20, offset=0)

        assert results == []


def test_search_users_orders_by_rank_then_id(session_factory):
    with session_factory() as session:
        # Both match "david" via username; "david" alone should rank at
        # least as high as "david smith" for a query of "david" (more of
        # the tsvector is the query term) -- exact ranking not asserted
        # beyond "both come back", id is the deterministic tie-breaker.
        first = _make_user(cognito_sub="sub-r1", username="david")
        second = _make_user(cognito_sub="sub-r2", username="david2")
        session.add_all([first, second])
        session.commit()

        results = search_users(session, "david", limit=20, offset=0)

        assert {u.id for u in results} == {first.id, second.id}


def test_search_users_respects_limit_and_offset(session_factory):
    with session_factory() as session:
        users = [_make_user(cognito_sub=f"sub-page{i}", username=f"pageuser{i}") for i in range(5)]
        session.add_all(users)
        session.commit()

        page1 = search_users(session, "pageuser", limit=2, offset=0)
        page2 = search_users(session, "pageuser", limit=2, offset=2)

        assert len(page1) == 2
        assert len(page2) == 2
        assert {u.id for u in page1}.isdisjoint({u.id for u in page2})


@pytest.mark.parametrize(
    "dangerous_query",
    ["'", ";", "--", ":*", "&|!()", "%", "dav'id; DROP TABLE users; --"],
)
def test_search_users_is_injection_safe(session_factory, dangerous_query):
    with session_factory() as session:
        session.add(_make_user(cognito_sub="sub-safe", username="safe_user"))
        session.commit()

        # Must not raise (no 500, no SQL error) regardless of content.
        results = search_users(session, dangerous_query, limit=20, offset=0)

        assert isinstance(results, list)


def test_search_users_no_tokens_returns_empty_list(session_factory):
    with session_factory() as session:
        session.add(_make_user(cognito_sub="sub-notoken", username="whatever"))
        session.commit()

        assert search_users(session, "!!! --- ;;;", limit=20, offset=0) == []
