"""Tests for app.events.lambda_handler.handler -- the ingestion Lambda, per
AGENTS.md TDD workflow. Written before app/events/lambda_handler.py exists.

Two trigger shapes (infra/lib/app-stack.ts): a direct EventBridge Scheduler
invocation (the event IS the Scheduler's `input`, no envelope) and the
ingestion-retry SQS queue (Lambda's own on-failure destination, batch size
1, reportBatchItemFailures: true). Fixtures: tests/fixtures/
ingestion_scheduler_event.json / ingestion_retry_sqs_event.json.

app.events.factory.SportsProviderFactory.create_adapter is monkeypatched to
a fake source rather than exercising the real ApiSportsAdapter/urllib HTTP
path -- no live API-SPORTS endpoint exists to call in tests, same reasoning
as every other events/ test using _FakeSource.
"""

from __future__ import annotations

import json
from pathlib import Path

import boto3
import pytest
from moto import mock_aws
from sqlalchemy import select
from testcontainers.postgres import PostgresContainer

import app.dependencies as app_dependencies
from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_settings
from app.events.factory import SportsProviderFactory
from app.events.interfaces import NormalizedGame, SportsDataSource
from app.events.ingestion import UnrecognizedTeamError
from app.events.models import Game, Team

FIXTURES = Path(__file__).parent.parent / "fixtures"
IDEMPOTENCY_TABLE_NAME = "fanwire-ingestion-idempotency-test"


def _load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


class _FakeSource(SportsDataSource):
    def __init__(self, games: list[NormalizedGame]) -> None:
        self._games = games

    def fetch_teams(self):
        return []

    def fetch_games(self, *, since=None):
        return self._games

    def fetch_live_score(self, api_sports_game_id: int):
        return None


def _sample_game(**overrides) -> NormalizedGame:
    from datetime import UTC, datetime

    defaults: dict = {
        "api_sports_game_id": 5001,
        "home_team_id": 12,
        "away_team_id": 17,
        "date": datetime(2025, 11, 1, 19, 30, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 112,
        "away_score": 108,
        "venue": "TD Garden",
        "player_stats": [],
    }
    defaults.update(overrides)
    return NormalizedGame(**defaults)


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    with engine.connect() as conn:
        conn.execute(
            Team.__table__.insert(),
            [
                {
                    "api_sports_team_id": 12,
                    "name": "Boston Celtics",
                    "abbreviation": "BOS",
                    "conference": "Eastern",
                    "division": "Atlantic",
                },
                {
                    "api_sports_team_id": 17,
                    "name": "Los Angeles Lakers",
                    "abbreviation": "LAL",
                    "conference": "Western",
                    "division": "Pacific",
                },
            ],
        )
        conn.commit()
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(autouse=True)
def _wire_env_and_caches(monkeypatch, postgres_url):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    monkeypatch.setenv("IDEMPOTENCY_TABLE_NAME", IDEMPOTENCY_TABLE_NAME)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("API_SPORTS_KEY", "test-key")
    monkeypatch.delenv("AWS_ENDPOINT_URL_DYNAMODB", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    get_settings.cache_clear()
    app_dependencies._get_session_factory.cache_clear()
    yield
    get_settings.cache_clear()
    app_dependencies._get_session_factory.cache_clear()


@pytest.fixture()
def dynamodb_table():
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-1")
        client.create_table(
            TableName=IDEMPOTENCY_TABLE_NAME,
            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield client


def _fake_factory(monkeypatch, games) -> None:
    monkeypatch.setattr(
        SportsProviderFactory,
        "create_adapter",
        staticmethod(lambda *a, **kw: _FakeSource(games)),
    )


def test_scheduler_invocation_runs_the_ingestion_pipeline(
    session_factory, dynamodb_table, monkeypatch
):
    from app.events.lambda_handler import handler

    _fake_factory(monkeypatch, [_sample_game()])
    event = _load_fixture("ingestion_scheduler_event.json")

    result = handler(event, None)

    assert result is None
    with session_factory() as session:
        persisted = session.scalar(select(Game).where(Game.api_sports_game_id == 5001))
        assert persisted is not None


def test_scheduler_invocation_lets_exceptions_propagate(
    session_factory, dynamodb_table, monkeypatch
):
    # No Team seeded for 999 -- fails fast. Exceptions from a direct
    # Scheduler invocation must propagate uncaught so Lambda's own async
    # on-failure destination (infra/lib/app-stack.ts's IngestionAsyncConfig)
    # routes this invocation to the ingestion-retry queue.
    from app.events.lambda_handler import handler

    _fake_factory(monkeypatch, [_sample_game(home_team_id=999)])
    event = _load_fixture("ingestion_scheduler_event.json")

    with pytest.raises(UnrecognizedTeamError):
        handler(event, None)


def test_retry_queue_record_re_runs_the_carried_payload(
    session_factory, dynamodb_table, monkeypatch
):
    from app.events.lambda_handler import handler

    _fake_factory(monkeypatch, [_sample_game()])
    event = _load_fixture("ingestion_retry_sqs_event.json")

    result = handler(event, None)

    assert result == {"batchItemFailures": []}
    with session_factory() as session:
        persisted = session.scalar(select(Game).where(Game.api_sports_game_id == 5001))
        assert persisted is not None


def test_retry_queue_record_failure_is_reported_as_a_batch_item_failure(
    session_factory, dynamodb_table, monkeypatch
):
    from app.events.lambda_handler import handler

    _fake_factory(monkeypatch, [_sample_game(home_team_id=999)])
    event = _load_fixture("ingestion_retry_sqs_event.json")

    result = handler(event, None)

    assert result == {
        "batchItemFailures": [{"itemIdentifier": event["Records"][0]["messageId"]}]
    }
