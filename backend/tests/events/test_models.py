"""Round-trip tests for the events/ models against a real Postgres, per
AGENTS.md TDD workflow. Written before app/events/models.py exists.

See wiki/CodeContext/Modules/0x02-events.md for the Team/Game schema.
"""

from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team


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


def _make_team(**overrides):
    defaults = dict(
        api_sports_team_id=12,
        name="Boston Celtics",
        abbreviation="BOS",
        conference="Eastern",
        division="Atlantic",
    )
    defaults.update(overrides)
    return Team(**defaults)


def test_team_and_game_round_trip(session_factory):
    with session_factory() as session:
        home = _make_team(api_sports_team_id=12, name="Boston Celtics", abbreviation="BOS")
        away = _make_team(
            api_sports_team_id=17,
            name="Los Angeles Lakers",
            abbreviation="LAL",
            conference="Western",
            division="Pacific",
        )
        session.add_all([home, away])
        session.commit()

        game = Game(
            api_sports_game_id=5001,
            home_team_id=home.id,
            away_team_id=away.id,
            date=datetime(2025, 11, 1, 19, 30),
            season="2025-26",
            home_score=112,
            away_score=108,
            venue="TD Garden",
            player_stats=[{"player_name": "Jayson Tatum", "team_id": home.id, "points": 28}],
        )
        session.add(game)
        session.commit()

        fetched = session.scalar(select(Game).where(Game.api_sports_game_id == 5001))
        assert fetched is not None
        assert fetched.home_team_id == home.id
        assert fetched.away_team_id == away.id
        assert fetched.season == "2025-26"
        assert fetched.player_stats[0]["player_name"] == "Jayson Tatum"


def test_team_api_sports_team_id_is_unique(session_factory):
    with session_factory() as session:
        session.add(_make_team(api_sports_team_id=99))
        session.commit()

        session.add(_make_team(api_sports_team_id=99, name="Duplicate"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_game_home_team_id_requires_existing_team(session_factory):
    with session_factory() as session:
        session.add(
            Game(
                api_sports_game_id=1,
                home_team_id=999_999,
                away_team_id=999_998,
                date=datetime(2025, 11, 1),
                season="2025-26",
                home_score=1,
                away_score=0,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_game_player_stats_defaults_to_empty_list(session_factory):
    with session_factory() as session:
        team = _make_team()
        session.add(team)
        session.commit()

        game = Game(
            api_sports_game_id=2,
            home_team_id=team.id,
            away_team_id=team.id,
            date=datetime(2025, 11, 1),
            season="2025-26",
            home_score=0,
            away_score=0,
        )
        session.add(game)
        session.commit()
        session.refresh(game)

        assert game.player_stats == []
