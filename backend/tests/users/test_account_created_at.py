"""POSTS-003: app.users.service.account_created_at, the public read posts/'s
spam scorer uses for an author's account age (instead of querying the users
table itself, per wiki/CodeContext/Modules/0x00-architecture.md "Connection
rule"). Written before the function exists.

Same exclusion rule as get_public_profiles: an unknown or soft-deleted user
gives None.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import text

from app.db import Base, make_engine, make_session_factory
from app.users import service
from app.users.models import User
from app.users.service import create_user, soft_delete_user


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _create(session, cognito_sub, username) -> User:
    return create_user(
        session,
        cognito_sub=cognito_sub,
        username=username,
        date_of_birth=date(1990, 1, 1),
    )


def test_account_created_at_returns_the_users_creation_time(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-aca-1", "aca_user")
        session.refresh(user)

        created_at = service.account_created_at(session, user.id)

        assert created_at == user.created_at
        assert created_at is not None and created_at.tzinfo is not None


def test_account_created_at_returns_a_backdated_creation_time(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-aca-old", "aca_old")
        session.execute(
            text("UPDATE users SET created_at = :at WHERE id = :id"),
            {"at": datetime(2020, 1, 2, 3, 4, 5, tzinfo=UTC), "id": user.id},
        )
        session.commit()

        assert service.account_created_at(session, user.id) == datetime(
            2020, 1, 2, 3, 4, 5, tzinfo=UTC
        )


def test_account_created_at_is_per_user(session_factory):
    with session_factory() as session:
        a = _create(session, "sub-aca-a", "aca_a")
        b = _create(session, "sub-aca-b", "aca_b")
        session.execute(
            text("UPDATE users SET created_at = now() - interval '10 days' WHERE id = :id"),
            {"id": a.id},
        )
        session.commit()
        session.refresh(a)
        session.refresh(b)

        assert service.account_created_at(session, a.id) == a.created_at
        assert service.account_created_at(session, b.id) == b.created_at
        assert a.created_at < b.created_at


def test_account_created_at_is_none_for_an_unknown_user(session_factory):
    with session_factory() as session:
        assert service.account_created_at(session, 999_999) is None


def test_account_created_at_is_none_for_a_soft_deleted_user(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-aca-del", "aca_deleted")
        soft_delete_user(session, user.id)

        assert service.account_created_at(session, user.id) is None
