"""Tests for app.events.service -- the public read interface feed/ (a later
unit, per wiki/CodeContext/Modules/0x06-feed.md) calls instead of querying
app.events.models directly (0x00-architecture.md Connection rule). Written
before app/events/service.py exists, per AGENTS.md TDD workflow.

game_ids_for_team: games where the team played home OR away.
games_by_ids: batch lookup of the narrow GameRef projection feed/ needs
(id, api_sports_game_id, date) -- never the ORM row itself.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team
from app.events.service import GameRef, game_ids_for_team, games_by_ids


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


def _make_team(session, **overrides) -> Team:
    defaults = {
        "api_sports_team_id": 1,
        "name": "Team",
        "abbreviation": "TM",
        "conference": "Eastern",
        "division": "Atlantic",
    }
    defaults.update(overrides)
    team = Team(**defaults)
    session.add(team)
    session.commit()
    return team


def _make_game(session, home, away, **overrides) -> Game:
    defaults = {
        "api_sports_game_id": 5001,
        "home_team_id": home.id,
        "away_team_id": away.id,
        "date": datetime(2026, 1, 1, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 100,
        "away_score": 98,
    }
    defaults.update(overrides)
    game = Game(**defaults)
    session.add(game)
    session.commit()
    return game


def test_game_ids_for_team_returns_home_and_away_games(session_factory):
    with session_factory() as session:
        team_a = _make_team(session, api_sports_team_id=101)
        team_b = _make_team(session, api_sports_team_id=102)
        team_c = _make_team(session, api_sports_team_id=103)

        home_game = _make_game(session, team_a, team_b, api_sports_game_id=1)
        away_game = _make_game(session, team_b, team_a, api_sports_game_id=2)
        unrelated_game = _make_game(session, team_b, team_c, api_sports_game_id=3)

        result = game_ids_for_team(session, team_a.id)

        assert set(result) == {home_game.id, away_game.id}
        assert unrelated_game.id not in result


def test_game_ids_for_team_returns_empty_list_when_no_games(session_factory):
    with session_factory() as session:
        team = _make_team(session, api_sports_team_id=201)

        result = game_ids_for_team(session, team.id)

        assert result == []


def test_games_by_ids_returns_game_ref_projection(session_factory):
    with session_factory() as session:
        team_a = _make_team(session, api_sports_team_id=301)
        team_b = _make_team(session, api_sports_team_id=302)
        game = _make_game(
            session,
            team_a,
            team_b,
            api_sports_game_id=9001,
            date=datetime(2026, 2, 1, 18, 0, tzinfo=UTC),
        )

        result = games_by_ids(session, [game.id])

        assert result == {
            game.id: GameRef(
                id=game.id,
                api_sports_game_id=9001,
                date=datetime(2026, 2, 1, 18, 0, tzinfo=UTC),
            )
        }


def test_games_by_ids_empty_ids_returns_empty_dict(session_factory):
    with session_factory() as session:
        assert games_by_ids(session, []) == {}
