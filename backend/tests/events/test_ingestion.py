"""Tests for AbstractEventIngestionPipeline / FinalScoreIngestion (Template
Method), per AGENTS.md TDD workflow. Written before app/events/ingestion.py
exists.

Exercises dedupe (via moto's mocked DynamoDB) and fail-fast team validation
against a real Postgres (via testcontainers), per wiki/CodeContext/Modules/
0x00-architecture.md "Data seeding order".
"""

from datetime import UTC, datetime

import boto3
import pytest
from freezegun import freeze_time
from moto import mock_aws
from sqlalchemy import select
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.ingestion import FinalScoreIngestion, UnrecognizedTeamError
from app.events.interfaces import NormalizedGame, SportsDataSource
from app.events.models import Game, Team

# Test-local table name -- the real name comes from Settings.idempotency_table_name
# (IDEMPOTENCY_TABLE_NAME, infra/lib/app-stack.ts) and is injected into
# FinalScoreIngestion explicitly, same as ApiSportsAdapter's base_url/api_key,
# rather than hardcoded in app.events.ingestion. Schema (partition key `id`,
# TTL attribute `expiration`) matches aws-lambda-powertools' Idempotency
# DynamoDBPersistenceLayer defaults (key_attr="id", expiry_attr="expiration")
# even though this pipeline uses a hand-rolled conditional put rather than
# that utility -- see app.events.ingestion's module docstring for why.
IDEMPOTENCY_TABLE_NAME = "fanwire-ingestion-idempotency-test"


class _FakeSource(SportsDataSource):
    def __init__(self, games):
        self._games = games

    def fetch_teams(self):
        return []

    def fetch_games(self, *, since=None):
        return self._games

    def fetch_live_score(self, api_sports_game_id):
        # Unused by these ingestion tests — present only to satisfy
        # SportsDataSource's abstract contract (fetch_live_score, added for
        # CachedEventProxy, app.events.proxy).
        return None


def _sample_game(**overrides) -> NormalizedGame:
    defaults: dict = {
        "api_sports_game_id": 5001,
        "home_team_id": 12,
        "away_team_id": 17,
        "date": datetime(2025, 11, 1, 19, 30, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 112,
        "away_score": 108,
        "venue": "TD Garden",
        "player_stats": [{"player_name": "Jayson Tatum", "team_id": 12, "points": 28}],
    }
    defaults.update(overrides)
    return NormalizedGame(**defaults)


@pytest.fixture()
def dynamodb_client(monkeypatch):
    # docker-compose.yml sets AWS_ENDPOINT_URL_DYNAMODB to point boto3 at the
    # real local `dynamodb-local` service (for tests that want it). Left set,
    # it diverts these calls away from moto's mock and onto that real,
    # state-persisting service instead — breaking isolation between test
    # runs (a table created by one test collides with the next). Unset it so
    # mock_aws reliably intercepts here regardless of which environment
    # (bare venv vs. docker-compose/CI) runs this suite.
    monkeypatch.delenv("AWS_ENDPOINT_URL_DYNAMODB", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-1")
        client.create_table(
            TableName=IDEMPOTENCY_TABLE_NAME,
            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        client.update_time_to_live(
            TableName=IDEMPOTENCY_TABLE_NAME,
            TimeToLiveSpecification={"Enabled": True, "AttributeName": "expiration"},
        )
        yield client


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _seed_teams(session):
    session.add(
        Team(
            api_sports_team_id=12,
            name="Boston Celtics",
            abbreviation="BOS",
            conference="Eastern",
            division="Atlantic",
        )
    )
    session.add(
        Team(
            api_sports_team_id=17,
            name="Los Angeles Lakers",
            abbreviation="LAL",
            conference="Western",
            division="Pacific",
        )
    )
    session.commit()


def _pipeline(source, session, dynamodb_client, **overrides) -> FinalScoreIngestion:
    overrides.setdefault("idempotency_table_name", IDEMPOTENCY_TABLE_NAME)
    return FinalScoreIngestion(source, session, dynamodb_client, **overrides)


def test_run_persists_new_game_and_resolves_internal_team_ids(session_factory, dynamodb_client):
    with session_factory() as session:
        _seed_teams(session)

        pipeline = _pipeline(_FakeSource([_sample_game()]), session, dynamodb_client)
        pipeline.run()

        persisted = session.scalar(select(Game).where(Game.api_sports_game_id == 5001))
        assert persisted is not None
        home_team = session.scalar(select(Team).where(Team.api_sports_team_id == 12))
        assert persisted.home_team_id == home_team.id
        assert persisted.player_stats[0]["team_id"] == home_team.id

        item = dynamodb_client.get_item(TableName=IDEMPOTENCY_TABLE_NAME, Key={"id": {"S": "5001"}})
        assert "Item" in item
        assert "expiration" in item["Item"]


def test_dedupe_writes_an_expiration_ttl_24_hours_out(session_factory, dynamodb_client):
    frozen_now = datetime(2026, 1, 1, tzinfo=UTC)
    with session_factory() as session, freeze_time(frozen_now):
        _seed_teams(session)
        pipeline = _pipeline(_FakeSource([_sample_game()]), session, dynamodb_client)

        pipeline.run()

        item = dynamodb_client.get_item(
            TableName=IDEMPOTENCY_TABLE_NAME, Key={"id": {"S": "5001"}}
        )["Item"]
        expected = int(frozen_now.timestamp()) + FinalScoreIngestion.IDEMPOTENCY_TTL_SECONDS
        assert int(item["expiration"]["N"]) == expected


def test_run_skips_a_game_already_recorded_in_the_idempotency_table(
    session_factory, dynamodb_client
):
    with session_factory() as session:
        _seed_teams(session)
        dynamodb_client.put_item(
            TableName=IDEMPOTENCY_TABLE_NAME,
            Item={"id": {"S": "5001"}, "expiration": {"N": "9999999999"}},
        )

        pipeline = _pipeline(_FakeSource([_sample_game()]), session, dynamodb_client)
        pipeline.run()

        persisted = session.scalar(select(Game).where(Game.api_sports_game_id == 5001))
        assert persisted is None


def test_dedupe_fails_fast_on_unrecognized_home_team(session_factory, dynamodb_client):
    with session_factory() as session:
        pipeline = _pipeline(
            _FakeSource([_sample_game(home_team_id=999)]), session, dynamodb_client
        )

        with pytest.raises(UnrecognizedTeamError):
            pipeline.run()


def test_dedupe_fails_fast_on_unrecognized_team_inside_player_stats(
    session_factory, dynamodb_client
):
    with session_factory() as session:
        _seed_teams(session)
        bad_game = _sample_game(
            player_stats=[{"player_name": "Nobody", "team_id": 999, "points": 1}]
        )
        pipeline = _pipeline(_FakeSource([bad_game]), session, dynamodb_client)

        with pytest.raises(UnrecognizedTeamError):
            pipeline.run()


def test_match_to_mentions_and_publish_are_explicit_noops(session_factory):
    with session_factory() as session:
        pipeline = _pipeline(_FakeSource([]), session, dynamodb_client=None)

        assert pipeline.match_to_mentions(["placeholder"]) is None
        assert pipeline.publish(["placeholder"]) is None
