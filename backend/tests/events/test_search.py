"""Tests for app.events.service.filter_games/distinct_seasons and
ALLOWED_POSITIONS, per AGENTS.md TDD workflow and this unit's task brief
(wiki/CodeContext/Modules/0x07-search.md). Written before filter_games/
distinct_seasons/ALLOWED_POSITIONS exist.

Plain WHERE-clause filtering (not full-text search) on season/team_id/
position, all optional and AND'd; team_id matches home or away. Position
filters via JSONB containment on Game.player_stats
(`player_stats @> '[{"position": "<P>"}]'`), built with SQLAlchemy JSONB
operators and bound values -- never string SQL. Ordered by date desc.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team
from app.events.service import ALLOWED_POSITIONS, distinct_seasons, filter_games


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
        "api_sports_game_id": 1,
        "home_team_id": home.id,
        "away_team_id": away.id,
        "date": datetime(2026, 1, 1, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 100,
        "away_score": 98,
        "player_stats": [],
    }
    defaults.update(overrides)
    game = Game(**defaults)
    session.add(game)
    session.commit()
    return game


def test_allowed_positions_is_the_standard_basketball_set():
    assert set(ALLOWED_POSITIONS) == {"PG", "SG", "SF", "PF", "C", "G", "F"}


def test_filter_games_by_season(session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=1)
        b = _make_team(session, api_sports_team_id=2)
        this_season = _make_game(session, a, b, api_sports_game_id=1, season="2025-26")
        _make_game(session, a, b, api_sports_game_id=2, season="2024-25")

        results = filter_games(
            session, season="2025-26", team_id=None, position=None, limit=20, offset=0
        )

        assert [g.id for g in results] == [this_season.id]


def test_filter_games_by_team_id_matches_home_or_away(session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=11)
        b = _make_team(session, api_sports_team_id=12)
        c = _make_team(session, api_sports_team_id=13)
        home_game = _make_game(session, a, b, api_sports_game_id=11)
        away_game = _make_game(session, b, a, api_sports_game_id=12)
        unrelated = _make_game(session, b, c, api_sports_game_id=13)

        results = filter_games(
            session, season=None, team_id=a.id, position=None, limit=20, offset=0
        )

        assert {g.id for g in results} == {home_game.id, away_game.id}
        assert unrelated.id not in {g.id for g in results}


def test_filter_games_by_position(session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=21)
        b = _make_team(session, api_sports_team_id=22)
        with_sf = _make_game(
            session,
            a,
            b,
            api_sports_game_id=21,
            player_stats=[{"player_name": "X", "team_id": a.id, "position": "SF"}],
        )
        _make_game(
            session,
            a,
            b,
            api_sports_game_id=22,
            player_stats=[{"player_name": "Y", "team_id": a.id, "position": "PG"}],
        )

        results = filter_games(
            session, season=None, team_id=None, position="SF", limit=20, offset=0
        )

        assert [g.id for g in results] == [with_sf.id]


def test_filter_games_combined_filters(session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=31)
        b = _make_team(session, api_sports_team_id=32)
        target = _make_game(
            session,
            a,
            b,
            api_sports_game_id=31,
            season="2025-26",
            player_stats=[{"player_name": "X", "team_id": a.id, "position": "C"}],
        )
        # Wrong season, otherwise matches.
        _make_game(
            session,
            a,
            b,
            api_sports_game_id=32,
            season="2024-25",
            player_stats=[{"player_name": "X", "team_id": a.id, "position": "C"}],
        )

        results = filter_games(
            session, season="2025-26", team_id=a.id, position="C", limit=20, offset=0
        )

        assert [g.id for g in results] == [target.id]


def test_filter_games_no_filters_returns_all_ordered_by_date_desc(session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=41)
        b = _make_team(session, api_sports_team_id=42)
        older = _make_game(
            session, a, b, api_sports_game_id=41, date=datetime(2025, 1, 1, tzinfo=UTC)
        )
        newer = _make_game(
            session, a, b, api_sports_game_id=42, date=datetime(2026, 1, 1, tzinfo=UTC)
        )

        results = filter_games(
            session, season=None, team_id=None, position=None, limit=20, offset=0
        )

        assert [g.id for g in results] == [newer.id, older.id]


def test_distinct_seasons(session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=51)
        b = _make_team(session, api_sports_team_id=52)
        _make_game(session, a, b, api_sports_game_id=51, season="2025-26")
        _make_game(session, a, b, api_sports_game_id=52, season="2025-26")
        _make_game(session, a, b, api_sports_game_id=53, season="2024-25")

        result = distinct_seasons(session)

        assert set(result) == {"2025-26", "2024-25"}
