"""USERS-008's nullable author migration and tombstone constraint."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "e6d7328e8881"


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def test_posts_author_becomes_nullable_only_for_deleted_tombstones(alembic_config, engine):
    command.upgrade(alembic_config, _PARENT_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (cognito_sub, username, date_of_birth) "
                "VALUES ('sub-users-008-migration', 'users_008_migration', '1990-01-01')"
            )
        )

    command.upgrade(alembic_config, "head")
    with engine.connect() as connection:
        nullable = connection.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'posts' AND column_name = 'author_id'"
            )
        ).scalar_one()
    assert nullable == "YES"

    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("INSERT INTO posts (author_id, text) VALUES (NULL, NULL)"))

    with engine.begin() as connection:
        tombstone_id = connection.execute(
            text(
                "INSERT INTO posts (author_id, text, deleted_at) "
                "VALUES (NULL, NULL, now()) RETURNING id"
            )
        ).scalar_one()
        assert tombstone_id is not None
