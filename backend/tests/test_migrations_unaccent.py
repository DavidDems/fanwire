"""EVENTS-006's migration: `alembic upgrade head` installs Postgres's
`unaccent` extension, which the player name search uses for accent-
insensitive matching ('doncic' finds 'Dončić'). The tests' own schema comes
from `Base.metadata.create_all`, which creates no extension, so without this
test a database built by migrations alone (the live one) could lack it.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def test_upgrade_head_installs_unaccent(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    with engine.connect() as conn:
        installed = conn.execute(
            text("SELECT 1 FROM pg_extension WHERE extname = 'unaccent'")
        ).first()
        assert installed is not None, "alembic upgrade head did not install unaccent"
        folded = conn.execute(text("SELECT lower(unaccent('Dončić Šarić'))")).scalar_one()

    assert folded == "doncic saric"
