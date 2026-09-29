"""The production migration runner's Lambda handler (INFRA-003).

`backend/app/migrate.py` is the fifth command override on the one shared
backend image (`docker/backend.Dockerfile`'s `lambda` stage, which copies
`alembic/` and `alembic.ini` to `LAMBDA_TASK_ROOT`). A human invokes it once
after `cdk deploy`; nothing invokes it automatically -- see
`infra/test/app-stack.test.ts` for the infrastructure half of this task.

Deliberately **not** an integration test. `tests/test_migrations.py` already
exercises the migrations themselves against a real testcontainers Postgres;
what is untested is the *handler* -- how it locates its config, what it
returns, and what it does (and does not) say when a migration fails. Those
are decided before a single byte reaches a database, so these drive
`alembic.command.upgrade` through a spy and need neither Docker nor Postgres.

The contract these tests pin, so the implementation has something definite to
satisfy:

* `app.migrate.handler(event, context)` -- the name `app.migrate.handler`
  is what the CDK `cmd` override points at, so the module-level function
  must be called `handler`.
* It builds an `alembic.config.Config` from the `alembic.ini` that sits one
  directory above the `app` package -- `backend/alembic.ini` in the repo,
  `${LAMBDA_TASK_ROOT}/alembic.ini` in the image. The same relative position
  in both, so nothing may be resolved from the process working directory.
* It sets `sqlalchemy.url` on that config from `Settings().database_url`.
  `alembic/env.py` sets the same option from the same place, but doing it
  here is what makes the handler fail fast on an unset `DATABASE_URL` and is
  the only way the data flow is observable at all.
* It calls `alembic.command.upgrade(config, "head")` -- programmatically, not
  through `subprocess`, which would give an exit code and no diagnostics.
* On success it returns a mapping whose `revision` key is the head revision
  it arrived at.
* On failure it **raises**. A handler that catches and returns `{"ok": False}`
  produces a *successful* invocation in the Lambda console, which is exactly
  the signal an operator reads as "migrations applied".
* It never writes the database URL, its userinfo or its password to a log or
  a return value -- including on the failure path, where the message and the
  `__cause__`/`__context__` chain of the escaping exception are the likeliest
  leak. `DATABASE_URL` carries the password inline (the known gap in
  `wiki/CodeContext/Modules/0x00-architecture.md`); this function must not
  widen it into CloudWatch.
"""

from __future__ import annotations

import json
import logging
import traceback
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from alembic import command as alembic_command
from app import migrate

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

# Distinctive, so a substring search over log output means something. Nothing
# here is a real credential and nothing here ever reaches a database: every
# test in this file replaces alembic's upgrade() before the handler runs.
_PASSWORD = "n0t-a-real-password-LEAKCANARY"
_USERINFO = f"fanwire_admin:{_PASSWORD}"
_DATABASE_URL = f"postgresql+psycopg://{_USERINFO}@db.internal.invalid:5432/fanwire"
_SECRETS = (_PASSWORD, _USERINFO, _DATABASE_URL)


def _script_head() -> str:
    """The head revision in backend/alembic/versions, read independently of
    the handler so the assertion is not comparing the handler with itself."""
    return ScriptDirectory.from_config(Config(str(_ALEMBIC_INI))).get_current_head()


def _assert_secret_free(text: str, where: str) -> None:
    for secret in _SECRETS:
        assert secret not in text, f"{where} leaked {secret!r}"


def _assert_nothing_leaked(caplog, capsys, where: str) -> None:
    """No secret in anything the handler emitted.

    Both channels matter: `caplog` sees anything that propagates to the root
    logger, and `capsys` sees anything written straight to stdout/stderr --
    which is where an `aws_lambda_powertools` Logger goes, since it sets
    `propagate = False` and caplog would therefore never see it.
    """
    captured = capsys.readouterr()
    _assert_secret_free(caplog.text, f"{where}: captured log records")
    _assert_secret_free(captured.out + captured.err, f"{where}: stdout/stderr")


@pytest.fixture()
def db_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", _DATABASE_URL)
    return _DATABASE_URL


@pytest.fixture()
def anywhere(monkeypatch, tmp_path):
    """Run the handler from a directory that contains nothing.

    In Lambda the working directory is not guaranteed to be
    `LAMBDA_TASK_ROOT`, so a handler that finds `alembic.ini` relative to the
    CWD is a green test here and a broken deploy there.
    """
    monkeypatch.chdir(tmp_path)


@pytest.fixture()
def upgrades(monkeypatch):
    """Records every `alembic upgrade` the handler drives, running none of them."""
    calls: list[SimpleNamespace] = []

    def fake_upgrade(config, revision, *args, **kwargs):
        calls.append(SimpleNamespace(config=config, revision=revision))

    monkeypatch.setattr(alembic_command, "upgrade", fake_upgrade)
    # Covers `from alembic.command import upgrade` in app/migrate.py as well
    # as `from alembic import command` + `command.upgrade(...)`.
    if hasattr(migrate, "upgrade"):
        monkeypatch.setattr(migrate, "upgrade", fake_upgrade)
    return calls


@pytest.fixture()
def failing_upgrade(monkeypatch):
    """Installs an `alembic upgrade` that raises the given exception."""

    def install(exc: BaseException):
        def boom(config, revision, *args, **kwargs):
            raise exc

        monkeypatch.setattr(alembic_command, "upgrade", boom)
        if hasattr(migrate, "upgrade"):
            monkeypatch.setattr(migrate, "upgrade", boom)

    return install


# ------------------------------------------------------- criterion 7: it migrates


def test_handler_upgrades_to_head_against_the_configured_database(db_url, anywhere, upgrades):
    migrate.handler({}, None)

    assert len(upgrades) == 1, "the handler must drive alembic's Python API exactly once"
    assert upgrades[0].revision == "head"
    assert upgrades[0].config.get_main_option("sqlalchemy.url") == db_url


def test_handler_returns_the_head_revision_it_arrived_at(db_url, anywhere, upgrades):
    head = _script_head()
    assert head, "backend/alembic/versions has no head revision -- fixture problem, not a bug"

    result = migrate.handler({}, None)

    assert result["revision"] == head


def test_handler_locates_alembic_ini_beside_the_app_package_not_via_the_cwd(
    db_url, anywhere, upgrades
):
    migrate.handler({}, None)
    config = upgrades[0].config

    assert config.config_file_name is not None
    # backend/alembic.ini under pytest; ${LAMBDA_TASK_ROOT}/alembic.ini in the
    # image -- the same position relative to app/ in both.
    expected = Path(migrate.__file__).resolve().parents[1] / "alembic.ini"
    assert Path(config.config_file_name).resolve() == expected
    assert expected == _ALEMBIC_INI
    # `script_location = %(here)s/alembic` must therefore resolve to the real
    # versions/ directory from a working directory that has neither.
    assert ScriptDirectory.from_config(config).get_current_head() == _script_head()


def test_a_password_containing_a_percent_sign_reaches_alembic_intact(
    monkeypatch, anywhere, upgrades
):
    """`Config.set_main_option` hands the value to configparser, which reads
    `%` as the start of an interpolation token and raises on a bare one. The
    RDS-generated password excludes `%` today, but a hand-rotated one need
    not, and the failure mode is an unhandled `ValueError` carrying the whole
    URL -- a crash and a credential leak at once."""
    url = "postgresql+psycopg://fanwire_admin:p%40ss%25w0rd@db.internal.invalid:5432/fanwire"
    monkeypatch.setenv("DATABASE_URL", url)

    migrate.handler({}, None)

    assert upgrades[0].config.get_main_option("sqlalchemy.url") == url


# ------------------------------------- criterion 8: a failure must look like a failure


def test_a_failed_migration_raises_instead_of_returning_a_result(db_url, anywhere, failing_upgrade):
    failing_upgrade(RuntimeError('relation "users" already exists'))

    with pytest.raises(Exception) as excinfo:
        migrate.handler({}, None)

    # Not the bare Exception base class either: that is what `raise Exception`
    # in a swallow-and-rethrow looks like, and it tells an operator nothing.
    assert type(excinfo.value) is not Exception


# --------------------------------------------- criterion 9: no credential ever leaks


def test_handler_neither_logs_nor_returns_the_database_url(
    db_url, anywhere, upgrades, caplog, capsys
):
    caplog.set_level(logging.DEBUG)

    result = migrate.handler({}, None)

    _assert_nothing_leaked(caplog, capsys, "successful migration")
    _assert_secret_free(repr(result), "the handler's return value")
    _assert_secret_free(json.dumps(result, default=repr), "the handler's serialized return value")


def test_a_failed_migration_does_not_leak_the_database_url_through_the_exception(
    db_url, anywhere, failing_upgrade, caplog, capsys
):
    """The failure path is where this leaks if it leaks anywhere.

    Lambda prints the full traceback of an unhandled exception to CloudWatch,
    `__cause__`/`__context__` chain included -- so re-raising with
    `raise MigrationFailed(...) from exc` still publishes whatever the
    original error said. SQLAlchemy and psycopg do put the connect string in
    their messages, so that is what this simulates.
    """
    caplog.set_level(logging.DEBUG)
    failing_upgrade(
        RuntimeError(f"connection to {_DATABASE_URL} failed: password authentication failed")
    )

    with pytest.raises(Exception) as excinfo:
        migrate.handler({}, None)

    rendered = "".join(traceback.format_exception(excinfo.value))
    _assert_secret_free(
        rendered, "the exception that escaped the handler (message and cause chain)"
    )
    _assert_nothing_leaked(caplog, capsys, "failed migration")
