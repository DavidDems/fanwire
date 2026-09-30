"""app.migrate.handler -- the production migration runner (INFRA-003).

The fifth command override on the one shared backend image
(`docker/backend.Dockerfile`'s `lambda` stage, which copies `alembic/` and
`alembic.ini` to `LAMBDA_TASK_ROOT`), wired up as
infra/lib/app-stack.ts's `Migration` function. A human invokes it once
after `cdk deploy`, before the API is expected to work; **nothing invokes
it automatically** -- not an EventBridge rule, not a schedule, not a
CloudFormation custom resource. DDL inside a stack update makes every
deploy a schema change, makes rollback ambiguous and puts
`alembic upgrade head` inside CloudFormation's timeout semantics. See
`infra/test/app-stack.test.ts`'s "App stack: migration runner" for the
infrastructure half, which asserts that.

Five decisions this module is built around:

**Only one migration at a time, enforced in Postgres.** A session-level
advisory lock (`pg_try_advisory_lock`), taken before any DDL and held for the
whole upgrade. This replaced `reservedConcurrentExecutions: 1` on the Lambda
after the first real deploy failed on it (2026-09-29; the account's Lambda
concurrency limit was 10, and AWS caps a reservation at the limit minus 100).
The lock is the better guarantee regardless of that quota: it binds *every*
caller, and `alembic upgrade head` also runs from `docker/backend.Dockerfile`'s
`dev` CMD and from any shell holding a `DATABASE_URL`, none of which a Lambda
reservation ever constrained. `pg_try_advisory_lock` does not block, so a
second migration fails fast and legibly instead of sitting in a timeout.

**Alembic's Python API, not `subprocess`.** `alembic.command.upgrade` raises
the real exception; a shelled-out `alembic` gives an exit code and no
diagnostics.

**`alembic.ini` is located relative to this module, never the working
directory.** `Path(__file__).parents[1]` is `backend/` in the repo and
`${LAMBDA_TASK_ROOT}` in the image -- the same position relative to `app/`
in both. In Lambda the process working directory is not guaranteed to be
`LAMBDA_TASK_ROOT`, so anything resolved from the CWD is a green test and a
broken deploy. `alembic.ini`'s `script_location = %(here)s/alembic` then
resolves against the ini's own directory, so `versions/` is found too.

**It raises on failure.** A handler that catches and returns
`{"ok": False}` produces a *successful* invocation in the Lambda console,
which is exactly the signal an operator reads as "migrations applied".

**It never emits the database URL.** `DATABASE_URL` carries the password
inline (the known gap in `wiki/CodeContext/Modules/0x00-architecture.md`),
so this function must not widen it into CloudWatch -- not in a log record,
not in the return value, and above all not through the escaping exception.
Lambda prints an unhandled exception's whole traceback including the
`__cause__`/`__context__` chain, and SQLAlchemy/psycopg do put the connect
string in their messages, so the original exception is **not** chained:
`MigrationFailed` is raised `from None` carrying a redacted rendering of
the original type and message instead (see `_redact`). Breaking the chain
is what keeps the credential out of CloudWatch; redacting rather than
discarding the message is what leaves an operator something to act on.

Note: `Settings()` is constructed directly here rather than via
`app.dependencies.get_settings`. That accessor is `lru_cache`d for the
request-serving app, where config cannot change without a redeploy; this
module is a one-shot entry point with no DI graph, and reading the
environment at invocation time is what makes an unset or changed
`DATABASE_URL` fail fast here rather than resolve to a stale cached value.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from alembic.config import Config
from alembic.script import ScriptDirectory
from aws_lambda_powertools import Logger
from sqlalchemy import text as sql_text

from alembic import command as alembic_command
from app.db import make_engine
from app.settings import Settings

logger = Logger()

#: Key for the `pg_try_advisory_lock` that serializes migrations. Any fixed
#: bigint works -- the value is meaningless to Postgres, it only has to be the
#: same for every caller. Chosen once and pinned: changing it silently removes
#: the mutual exclusion between an old deployment and a new one.
MIGRATION_LOCK_KEY = 8_315_402_771_001

#: `backend/alembic.ini` in the repo, `${LAMBDA_TASK_ROOT}/alembic.ini` in the
#: image -- resolved from this module's location, never the CWD.
ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"

_REDACTED = "[redacted]"

#: Credentials embedded in a URL somewhere in an error message we did not
#: write: `postgresql://user:pass@host/db` -> `postgresql://[redacted]@host/db`.
#: Keeps the host and database name, which is the diagnostically useful part.
_URL_USERINFO = re.compile(r"(?<=://)[^/\s@]+@")

#: `password=...` / `pwd=...`, the shape a psycopg DSN or connection-parameter
#: dump takes rather than a URL.
_PASSWORD_KEYWORD = re.compile(r"(?i)\b(?:password|passwd|pwd)\s*=\s*[^\s,;)\]]+")


class MigrationFailed(RuntimeError):
    """`alembic upgrade head` did not complete.

    Deliberately a named subclass and deliberately not `Exception` itself:
    a bare `raise Exception(...)` in a swallow-and-rethrow tells an operator
    nothing, and `infra`'s runbook step wants a distinguishable failure.
    """


class MigrationLockUnavailable(MigrationFailed):
    """Another migration holds the advisory lock, so this one did not run.

    A subclass of `MigrationFailed` on purpose: from the caller's side this
    is still "the migration did not happen", and it must still fail the
    invocation. It is distinguishable so an operator can tell "someone else
    is already migrating, wait and look again" from "the schema change
    itself broke", which are different next actions.
    """


def _sensitive_fragments(database_url: str) -> list[str]:
    """Every substring of `database_url` that must never appear in output.

    The password first, then the `user:password` userinfo, then the whole
    URL: redacting the narrowest fragment first leaves the driver, host and
    database name intact in a message, which is what makes a failed
    invocation diagnosable at all. Once the password is gone the wider
    fragments no longer match, which is exactly the intent.
    """
    fragments: list[str] = []
    userinfo = ""
    try:
        netloc = urlsplit(database_url).netloc
    except ValueError:  # pragma: no cover - urlsplit on a non-URL string
        netloc = ""
    if "@" in netloc:
        userinfo = netloc.rsplit("@", 1)[0]
        if ":" in userinfo:
            password = userinfo.split(":", 1)[1]
            # Both forms: DATABASE_URL percent-encodes a password, while a
            # driver reporting an auth failure has already decoded it.
            for candidate in (password, unquote(password)):
                if candidate and candidate not in fragments:
                    fragments.append(candidate)
    for wider in (userinfo, database_url):
        if wider and wider not in fragments:
            fragments.append(wider)
    return fragments


def _redact(text: str, database_url: str) -> str:
    """`text` with every trace of `database_url`'s credentials removed.

    No length floor on the fragments: a one-character password would make
    the surviving message close to unreadable, and that is the correct
    direction to fail -- an unreadable error beats a credential in
    CloudWatch. The two regexes are belt and braces for a URL or DSN the
    driver rendered differently from the one we were configured with.
    """
    for fragment in _sensitive_fragments(database_url):
        text = text.replace(fragment, _REDACTED)
    text = _URL_USERINFO.sub(f"{_REDACTED}@", text)
    return _PASSWORD_KEYWORD.sub(f"password={_REDACTED}", text)


def _escape_for_configparser(value: str) -> str:
    """Escape `%` for `Config.set_main_option`.

    The value goes to configparser, whose `BasicInterpolation` reads `%` as
    the start of an interpolation token and raises `ValueError` on a bare
    one -- with the offending value, i.e. the whole database URL, in the
    message. Alembic documents `%%` as the escape, and `get_main_option`
    interpolates on read, so the escaped value reads back identical to this
    one. The RDS-generated password excludes `%` today; a hand-rotated one
    need not.
    """
    return value.replace("%", "%%")


@contextmanager
def _advisory_lock(database_url: str) -> Iterator[None]:
    """Hold the migration lock for the duration of the block.

    A Postgres **session-level** advisory lock, not a row lock and not a
    Lambda concurrency reservation. `pg_try_advisory_lock` returns
    immediately rather than blocking, so a second migration fails fast with
    something an operator can read instead of sitting in a Lambda timeout.

    This binds every caller, which is the whole point: `alembic upgrade head`
    also runs from `docker/backend.Dockerfile`'s `dev` CMD and from any
    developer's shell holding a `DATABASE_URL`. Reserved concurrency on the
    Lambda -- what this replaced, see the history in
    `infra/test/app-stack.test.ts` -- constrained none of those.

    The lock is tied to this connection, so it is released both explicitly and
    by the connection closing; a crashed process cannot strand it.
    """
    engine = make_engine(database_url)
    try:
        with engine.connect() as conn:
            acquired = conn.execute(
                sql_text("SELECT pg_try_advisory_lock(:key)"), {"key": MIGRATION_LOCK_KEY}
            ).scalar()
            if not acquired:
                raise MigrationLockUnavailable(
                    "another migration already holds the advisory lock "
                    f"(key {MIGRATION_LOCK_KEY}); it did not run"
                )
            try:
                yield
            finally:
                # Best effort: if the connection has already died the lock is
                # gone with it, which is the outcome we wanted anyway.
                conn.execute(
                    sql_text("SELECT pg_advisory_unlock(:key)"), {"key": MIGRATION_LOCK_KEY}
                )
    finally:
        engine.dispose()


def _build_config(database_url: str) -> Config:
    config = Config(str(ALEMBIC_INI))
    # `alembic/env.py` sets the same option from the same place, but setting
    # it here is what makes an unset DATABASE_URL fail before any DDL runs.
    config.set_main_option("sqlalchemy.url", _escape_for_configparser(database_url))
    return config


def handler(event: dict[str, Any], context: Any) -> dict[str, str]:
    """Apply every outstanding migration and return the head revision.

    Raises `MigrationFailed` if the upgrade does not complete, so the
    invocation is recorded as a failure rather than a green one.
    """
    database_url = Settings().database_url
    config = _build_config(database_url)
    scripts = ScriptDirectory.from_config(config)

    logger.info("applying migrations", extra={"target": "head"})
    try:
        # Nothing touches the schema without the lock, and the lock is held
        # for the whole upgrade rather than just taken at the start.
        with _advisory_lock(database_url):
            alembic_command.upgrade(config, "head")
    except MigrationLockUnavailable as exc:
        # Distinct from a failed migration: the schema was not touched, and
        # the operator's next action is "wait and look again", not "diagnose
        # a broken migration". Still redacted -- a driver-level lock failure
        # can carry the connect string just as readily.
        reason = _redact(str(exc), database_url)
        logger.error("migration did not run", extra={"reason": reason})
        raise MigrationLockUnavailable(reason) from None
    # Blind on purpose (hence the noqa): anything a migration script, the
    # driver or alembic itself raises may carry the connect string, and every
    # one of those has to be redacted before it escapes to CloudWatch. Nothing
    # is swallowed -- MigrationFailed is raised unconditionally below.
    except Exception as exc:  # noqa: BLE001
        reason = f"{type(exc).__name__}: {_redact(str(exc), database_url)}"
        logger.error("migration failed", extra={"reason": reason})
        # `from None`, not `from exc`: Lambda renders the whole cause chain
        # to CloudWatch, and the original message is where the connect
        # string leaks. `reason` carries it redacted instead.
        raise MigrationFailed(f"alembic upgrade head failed -- {reason}") from None

    revision = scripts.get_current_head()
    if revision is None:  # pragma: no cover - only with an empty versions/
        raise MigrationFailed("alembic upgrade head reported no head revision")
    logger.info("migrations applied", extra={"revision": revision})
    return {"revision": revision}
