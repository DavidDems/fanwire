"""`backend/alembic/env.py` and a `%` in the database password.

`Config.set_main_option` hands its value to configparser, whose
interpolation reads `%` as the start of a token and raises `ValueError` on a
bare one -- with the whole URL in the message. `app.migrate` escapes for its
own call; env.py must too, because `alembic upgrade head` also runs outside
the handler (the `dev` image's CMD, `docker compose exec backend-dev`), where
nothing redacts that message. Since ADR 0045 the URL is built from the RDS
secret with the password URL-quoted, so a `%` in it is always `%25`.

Offline (`--sql`) mode against an in-memory Config: no database, no Docker,
and no `fileConfig` (that needs an ini file), so the test process's logging
is left alone.
"""

from __future__ import annotations

import io
from pathlib import Path

from alembic.config import Config

from alembic import command

_ALEMBIC_DIR = Path(__file__).resolve().parents[1] / "alembic"
_BASE_REVISION = "aab36ebaba5f"
_URL = "postgresql+psycopg://fanwire_admin:p%40ss%25w0rd@db.internal.invalid:5432/fanwire"


def test_escape_for_configparser_doubles_every_percent_sign():
    from app.migrate import escape_for_configparser

    assert escape_for_configparser("a%b%%c") == "a%%b%%%%c"
    assert escape_for_configparser("plain") == "plain"


def test_env_py_accepts_a_url_with_a_percent_sign_and_keeps_it_intact(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", _URL)
    buffer = io.StringIO()
    config = Config(output_buffer=buffer)
    config.set_main_option("script_location", str(_ALEMBIC_DIR))

    command.upgrade(config, _BASE_REVISION, sql=True)

    assert config.get_main_option("sqlalchemy.url") == _URL
    assert "CREATE TABLE" in buffer.getvalue()
    assert "p%40ss" not in buffer.getvalue()

