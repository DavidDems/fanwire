"""One additive head backfills only extant profiles, preserving inactivity."""

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from alembic import command
from app.db import make_engine

BACKEND = Path(__file__).resolve().parents[1]
PREVIOUS_HEAD = "217f70776078"
ISSUER = "https://cognito-idp.ca-central-1.amazonaws.com/ca-central-1_lifecycle"


@pytest.fixture()
def migration_case(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    monkeypatch.setenv("COGNITO_REGION", "ca-central-1")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "ca-central-1_lifecycle")
    config = Config(str(BACKEND / "alembic.ini"))
    engine = make_engine(postgres_url)
    command.downgrade(config, "base")
    yield config, engine
    command.downgrade(config, "base")
    engine.dispose()


def test_lifecycle_has_one_new_additive_head(migration_case):
    config, engine = migration_case
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1 and heads[0] != PREVIOUS_HEAD
    assert script.get_revision(heads[0]).down_revision == PREVIOUS_HEAD
    command.upgrade(config, "head")
    for table in ("account_authorities", "account_operations", "account_deletion_objects"):
        columns = {column["name"]: column for column in inspect(engine).get_columns(table)}
        assert columns["id"]["identity"]
        assert "BIGINT" in str(columns["id"]["type"]).upper()
        assert not any(
            fk["referred_table"] == "users" for fk in inspect(engine).get_foreign_keys(table)
        )


def test_backfill_preserves_existing_inactive_time_without_inventing_deleted_subjects(
    migration_case,
):
    config, engine = migration_case
    command.upgrade(config, PREVIOUS_HEAD)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (cognito_sub,username,date_of_birth,deleted_at) VALUES "
                "('backfill-active','backfill_active','1990-01-01',NULL),"
                "('backfill-inactive','backfill_inactive','1990-01-01','2025-12-01T10:00:00Z')"
            )
        )
    command.upgrade(config, "head")
    with engine.connect() as connection:
        rows = (
            connection.execute(
                text(
                    "SELECT issuer,cognito_sub,state,inactive_at FROM account_authorities ORDER BY cognito_sub"
                )
            )
            .mappings()
            .all()
        )
        assert [(row["issuer"], row["cognito_sub"], row["state"]) for row in rows] == [
            (ISSUER, "backfill-active", "active"),
            (ISSUER, "backfill-inactive", "inactive"),
        ]
        assert rows[0]["inactive_at"] is None
        assert rows[1]["inactive_at"].isoformat() == "2025-12-01T10:00:00+00:00"
        assert connection.execute(text("SELECT count(*) FROM account_operations")).scalar_one() == 0
    # An additive rerun must not change generations or synthesize delete work.
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT count(*) FROM account_authorities")).scalar_one() == 2
        )
