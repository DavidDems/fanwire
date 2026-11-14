"""USERS-004's nullable profile avatar migration and rollback contract."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "b5e9c3a7d2f1"


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def _user_columns(engine) -> dict[str, tuple[str, str, str | None]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns WHERE table_name = 'users'"
            )
        ).all()
    return {name: (kind, nullable, default) for name, kind, nullable, default in rows}


def test_migration_adds_only_nullable_avatar_key_and_round_trips(alembic_config, engine):
    command.upgrade(alembic_config, _PARENT_REVISION)
    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (cognito_sub, username, date_of_birth) "
                "VALUES ('sub-avatar-migration', 'avatar_migration', '1990-01-01') RETURNING id"
            )
        ).scalar_one()
    before = set(_user_columns(engine))

    command.upgrade(alembic_config, "head")

    columns = _user_columns(engine)
    assert set(columns) - before == {"profile_avatar_key"}
    assert columns["profile_avatar_key"] == ("text", "YES", None)
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT profile_avatar_key FROM users WHERE id = :id"), {"id": user_id}
        ).scalar_one() is None

    command.downgrade(alembic_config, _PARENT_REVISION)
    assert "profile_avatar_key" not in _user_columns(engine)
    command.upgrade(alembic_config, "head")
    assert _user_columns(engine)["profile_avatar_key"] == ("text", "YES", None)
