"""USERS-005 avatar colour migration and rollback contract."""

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
# The single Alembic head USERS-005 is cut from (USERS-011's lower(username)
# index), not USERS-004's b5e9c3a7d2f1: the preset column exists here, so
# the test can insert a preset and watch the migration drop it.
_PARENT_REVISION = "fd9d2851baf5"


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def _columns(engine) -> dict[str, tuple[str, str, str | None]]:
    with engine.connect() as connection:
        rows = connection.execute(text(
            "SELECT column_name, data_type, is_nullable, column_default "
            "FROM information_schema.columns WHERE table_name = 'users'"
        )).all()
    return {name: (kind, nullable, default) for name, kind, nullable, default in rows}


def test_migration_is_one_revision_on_the_parent_head(alembic_config):
    script = ScriptDirectory.from_config(alembic_config)
    heads = script.get_heads()
    assert len(heads) == 1
    assert script.get_revision(heads[0]).down_revision == _PARENT_REVISION


def test_migration_replaces_preset_with_nullable_colour_columns_and_round_trips(
    alembic_config, engine
):
    command.upgrade(alembic_config, _PARENT_REVISION)
    with engine.begin() as connection:
        user_id = connection.execute(text(
            "INSERT INTO users (cognito_sub, username, date_of_birth, description, "
            "profile_avatar_key) VALUES ('sub-avatar-migration', 'avatar_migration', "
            "'1990-01-01', 'kept bio', 'arc') RETURNING id"
        )).scalar_one()

    command.upgrade(alembic_config, "head")

    columns = _columns(engine)
    assert "profile_avatar_key" not in columns
    assert columns["avatar_inner_color"] == ("text", "YES", None)
    assert columns["avatar_outer_color"] == ("text", "YES", None)
    with engine.connect() as connection:
        row = connection.execute(text(
            "SELECT avatar_inner_color, avatar_outer_color, cognito_sub, username, "
            "date_of_birth::text, description FROM users WHERE id = :id"
        ), {"id": user_id}).one()
    # A preset becomes the default initials; every other value is kept.
    assert tuple(row) == (
        None, None, "sub-avatar-migration", "avatar_migration", "1990-01-01", "kept bio"
    )

    command.downgrade(alembic_config, _PARENT_REVISION)
    columns = _columns(engine)
    assert columns["profile_avatar_key"] == ("text", "YES", None)
    assert "avatar_inner_color" not in columns and "avatar_outer_color" not in columns
    with engine.connect() as connection:
        row = connection.execute(text(
            "SELECT profile_avatar_key, username, description FROM users WHERE id = :id"
        ), {"id": user_id}).one()
    assert tuple(row) == (None, "avatar_migration", "kept bio")
