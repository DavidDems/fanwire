"""Tests for AbstractEventIngestionPipeline / FinalScoreIngestion (Template
Method), per AGENTS.md TDD workflow. Written before app/events/ingestion.py
exists.

Exercises dedupe (via moto's mocked DynamoDB) and fail-fast team validation
against a real Postgres (via testcontainers), per wiki/CodeContext/Modules/
0x00-architecture.md "Data seeding order".
"""

from datetime import datetime

import boto3
import pytest
from moto import mock_aws
from sqlalchemy import select
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.ingestion import (
    IDEMPOTENCY_TABLE_NAME,
    FinalScoreIngestion,
    UnrecognizedTeamError,
)
from app.events.interfaces import NormalizedGame, SportsDataSource
from app.events.models import Game, Team


class _FakeSource(SportsDataSource):
    def __init__(self, games):
        self._games = games

    def fetch_teams(self):
        return []

    def fetch_games(self, *, since=None):
        return self._games


def _sample_game(**overrides) -> NormalizedGame:
    defaults: dict = dict(
        api_sports_game_id=5001,
        home_team_id=12,
        away_team_id=17,
        date=datetime(2025, 11, 1, 19, 30),
        season="2025-26",
        home_score=112,
        away_score=108,
        venue="TD Garden",
        player_stats=[{"player_name": "Jayson Tatum", "team_id": 12, "points": 28}],
    )
    defaults.update(overrides)
    return NormalizedGame(**defaults)


def _make_idempotency_table():
    client = boto3.client("dynamodb", region_name="us-east-1")
    client.create_table(
        TableName=IDEMPOTENCY_TABLE_NAME,
        KeySchema=[{"AttributeName": "event_id", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "event_id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    return client


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


@mock_aws
def test_run_persists_new_game_and_resolves_internal_team_ids(session_factory):
    dynamodb_client = _make_idempotency_table()
    with session_factory() as session:
        _seed_teams(session)

        pipeline = FinalScoreIngestion(_FakeSource([_sample_game()]), session, dynamodb_client)
        pipeline.run()

        persisted = session.scalar(select(Game).where(Game.api_sports_game_id == 5001))
        assert persisted is not None
        home_team = session.scalar(select(Team).where(Team.api_sports_team_id == 12))
        assert persisted.home_team_id == home_team.id
        assert persisted.player_stats[0]["team_id"] == home_team.id

        item = dynamodb_client.get_item(
            TableName=IDEMPOTENCY_TABLE_NAME, Key={"event_id": {"S": "5001"}}
        )
        assert "Item" in item


@mock_aws
def test_run_skips_a_game_already_recorded_in_the_idempotency_table(session_factory):
    dynamodb_client = _make_idempotency_table()
    with session_factory() as session:
        _seed_teams(session)
        dynamodb_client.put_item(
            TableName=IDEMPOTENCY_TABLE_NAME, Item={"event_id": {"S": "5001"}}
        )

        pipeline = FinalScoreIngestion(_FakeSource([_sample_game()]), session, dynamodb_client)
        pipeline.run()

        persisted = session.scalar(select(Game).where(Game.api_sports_game_id == 5001))
        assert persisted is None


@mock_aws
def test_dedupe_fails_fast_on_unrecognized_home_team(session_factory):
    dynamodb_client = _make_idempotency_table()
    with session_factory() as session:
        pipeline = FinalScoreIngestion(
            _FakeSource([_sample_game(home_team_id=999)]), session, dynamodb_client
        )

        with pytest.raises(UnrecognizedTeamError):
            pipeline.run()


@mock_aws
def test_dedupe_fails_fast_on_unrecognized_team_inside_player_stats(session_factory):
    dynamodb_client = _make_idempotency_table()
    with session_factory() as session:
        _seed_teams(session)
        bad_game = _sample_game(
            player_stats=[{"player_name": "Nobody", "team_id": 999, "points": 1}]
        )
        pipeline = FinalScoreIngestion(_FakeSource([bad_game]), session, dynamodb_client)

        with pytest.raises(UnrecognizedTeamError):
            pipeline.run()


def test_match_to_mentions_and_publish_are_explicit_noops(session_factory):
    with session_factory() as session:
        pipeline = FinalScoreIngestion(_FakeSource([]), session, dynamodb_client=None)

        assert pipeline.match_to_mentions(["placeholder"]) is None
        assert pipeline.publish(["placeholder"]) is None
