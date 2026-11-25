"""USERS-011: the migration that makes usernames unique regardless of case.

Upgrading to head creates ux_users_username_lower, a unique index on
lower(username); downgrading to its parent, f2b8d4a6c9e3, drops it. If the
users table already holds names that differ only by case, the upgrade
refuses: it raises naming how many groups collide and each group's user ids
(as a list, in id order), never
the usernames (the Migration Lambda's error reaches CloudWatch), and creates
nothing, so the human decides what happens to them (ADR 0042).

The tests share this module's one database (tests/conftest.py postgres_url),
so each starts from an empty public schema.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "f2b8d4a6c9e3"  # head before USERS-011
_INDEX = "ux_users_username_lower"


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    engine = make_engine(postgres_url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def _has_index(engine, name: str) -> bool:
    with engine.connect() as conn:
        return (
            conn.execute(
                text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": name}
            ).first()
            is not None
        )


def _index_definition(engine, name: str) -> str:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT indexdef FROM pg_indexes WHERE indexname = :name"), {"name": name}
        ).scalar_one()


def _insert_user(engine, sub: str, username: str) -> int:
    with engine.begin() as conn:
        return conn.execute(
            text(
                "INSERT INTO users (cognito_sub, username, date_of_birth) "
                "VALUES (:sub, :username, DATE '1990-01-01') RETURNING id"
            ),
            {"sub": sub, "username": username},
        ).scalar_one()


def test_upgrade_creates_the_unique_lower_username_index(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    assert _has_index(engine, _INDEX)
    definition = _index_definition(engine, _INDEX).lower()
    assert definition.startswith("create unique index")
    assert "lower(username)" in definition


def test_downgrade_to_the_parent_drops_it(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, _PARENT_REVISION)

    assert not _has_index(engine, _INDEX)


def test_upgrade_succeeds_over_names_that_differ_by_more_than_case(alembic_config, engine):
    command.upgrade(alembic_config, _PARENT_REVISION)
    _insert_user(engine, "sub-a", "Raptors")
    _insert_user(engine, "sub-b", "Raptors2")

    command.upgrade(alembic_config, "head")

    assert _has_index(engine, _INDEX)


def test_upgrade_refuses_existing_case_collisions_and_names_ids_not_usernames(
    alembic_config, engine
):
    command.upgrade(alembic_config, _PARENT_REVISION)
    first = _insert_user(engine, "sub-a", "Raptors")
    second = _insert_user(engine, "sub-b", "raptors")
    _insert_user(engine, "sub-c", "Celtics")

    with pytest.raises(RuntimeError) as raised:
        command.upgrade(alembic_config, "head")

    message = str(raised.value)
    assert f"[{first}, {second}]" in message
    assert "1 username group" in message
    assert "raptors" not in message.lower()
    assert "celtics" not in message.lower()
    assert not _has_index(engine, _INDEX)
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert version == _PARENT_REVISION
