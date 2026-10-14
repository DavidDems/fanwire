"""Tests for app.events.service.filter_games/distinct_seasons and
ALLOWED_POSITIONS, per AGENTS.md TDD workflow and this unit's task brief
(wiki/CodeContext/Modules/0x07-search.md). Written before filter_games/
distinct_seasons/ALLOWED_POSITIONS exist.

Plain WHERE-clause filtering (not full-text search) on season/team_id/
position, all optional and AND'd; team_id matches home or away. Ordered by
date desc.

Since EVENTS-004 the position filter reads the box-score table: a game
matches when any player in its box score started at that position
(PlayerGameStats.starting_position). Bench rows have no position and never
match. Written before filter_games reads player_game_stats.
"""

from __future__ import annotations

import itertools
from datetime import UTC, datetime

import pytest

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Player, PlayerGameStats, Team
from app.events.service import ALLOWED_POSITIONS, distinct_seasons, filter_games

_person_ids = itertools.count(1)

_ZERO_STATS = dict.fromkeys(
    (
        "field_goals_made",
        "field_goals_attempted",
        "three_pointers_made",
        "three_pointers_attempted",
        "free_throws_made",
        "free_throws_attempted",
        "offensive_rebounds",
        "defensive_rebounds",
        "rebounds",
        "assists",
        "steals",
        "blocks",
        "turnovers",
        "personal_fouls",
        "points",
        "plus_minus",
    ),
    0,
)


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_team(session, **overrides) -> Team:
    defaults = {
        "nba_team_id": 1,
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


def _make_game(session, home, away, starting_positions=(), **overrides) -> Game:
    """`starting_positions`: one box-score row per entry, for a new player on
    the home team; None is a bench row (no starting position)."""
    defaults = {
        "nba_game_id": 1,
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
    session.flush()
    for position in starting_positions:
        player = Player(nba_person_id=next(_person_ids), last_name="Player")
        session.add(player)
        session.flush()
        session.add(
            PlayerGameStats(
                game_id=game.id,
                player_id=player.id,
                team_id=home.id,
                starter=position is not None,
                starting_position=position,
                seconds_played=600,
                **_ZERO_STATS,
            )
        )
    session.commit()
    return game


def test_allowed_positions_is_the_standard_basketball_set():
    assert set(ALLOWED_POSITIONS) == {"PG", "SG", "SF", "PF", "C", "G", "F"}


def test_filter_games_by_season(session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=1)
        b = _make_team(session, nba_team_id=2)
        this_season = _make_game(session, a, b, nba_game_id=1, season="2025-26")
        _make_game(session, a, b, nba_game_id=2, season="2024-25")

        results = filter_games(
            session, season="2025-26", team_id=None, position=None, limit=20, offset=0
        )

        assert [g.id for g in results] == [this_season.id]


def test_filter_games_by_team_id_matches_home_or_away(session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=11)
        b = _make_team(session, nba_team_id=12)
        c = _make_team(session, nba_team_id=13)
        home_game = _make_game(session, a, b, nba_game_id=11)
        away_game = _make_game(session, b, a, nba_game_id=12)
        unrelated = _make_game(session, b, c, nba_game_id=13)

        results = filter_games(
            session, season=None, team_id=a.id, position=None, limit=20, offset=0
        )

        assert {g.id for g in results} == {home_game.id, away_game.id}
        assert unrelated.id not in {g.id for g in results}


def test_filter_games_by_position(session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=21)
        b = _make_team(session, nba_team_id=22)
        with_sf = _make_game(
            session,
            a,
            b,
            nba_game_id=21,
            starting_positions=["SF"],
        )
        _make_game(
            session,
            a,
            b,
            nba_game_id=22,
            starting_positions=["PG"],
        )

        results = filter_games(
            session, season=None, team_id=None, position="SF", limit=20, offset=0
        )

        assert [g.id for g in results] == [with_sf.id]


def test_filter_games_by_position_matches_any_starter_of_the_game(session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=61)
        b = _make_team(session, nba_team_id=62)
        game = _make_game(session, a, b, nba_game_id=61, starting_positions=["G", "F", "C", None])

        for position in ("G", "F", "C"):
            results = filter_games(
                session, season=None, team_id=None, position=position, limit=20, offset=0
            )
            assert [g.id for g in results] == [game.id], position

        assert (
            filter_games(session, season=None, team_id=None, position="PG", limit=20, offset=0)
            == []
        )


def test_filter_games_by_position_ignores_bench_rows(session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=71)
        b = _make_team(session, nba_team_id=72)
        _make_game(session, a, b, nba_game_id=71, starting_positions=[None, None])

        results = filter_games(session, season=None, team_id=None, position="G", limit=20, offset=0)

        assert results == []


def test_filter_games_by_position_returns_each_game_once(session_factory):
    """Two starters at the same position must not repeat the game."""
    with session_factory() as session:
        a = _make_team(session, nba_team_id=81)
        b = _make_team(session, nba_team_id=82)
        game = _make_game(session, a, b, nba_game_id=81, starting_positions=["G", "G"])

        results = filter_games(session, season=None, team_id=None, position="G", limit=20, offset=0)

        assert [g.id for g in results] == [game.id]


def test_game_has_no_player_stats_column():
    assert "player_stats" not in Game.__table__.c


def test_filter_games_combined_filters(session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=31)
        b = _make_team(session, nba_team_id=32)
        target = _make_game(
            session,
            a,
            b,
            nba_game_id=31,
            season="2025-26",
            starting_positions=["C"],
        )
        # Wrong season, otherwise matches.
        _make_game(
            session,
            a,
            b,
            nba_game_id=32,
            season="2024-25",
            starting_positions=["C"],
        )

        results = filter_games(
            session, season="2025-26", team_id=a.id, position="C", limit=20, offset=0
        )

        assert [g.id for g in results] == [target.id]


def test_filter_games_no_filters_returns_all_ordered_by_date_desc(session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=41)
        b = _make_team(session, nba_team_id=42)
        older = _make_game(session, a, b, nba_game_id=41, date=datetime(2025, 1, 1, tzinfo=UTC))
        newer = _make_game(session, a, b, nba_game_id=42, date=datetime(2026, 1, 1, tzinfo=UTC))

        results = filter_games(
            session, season=None, team_id=None, position=None, limit=20, offset=0
        )

        assert [g.id for g in results] == [newer.id, older.id]


def test_distinct_seasons(session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=51)
        b = _make_team(session, nba_team_id=52)
        _make_game(session, a, b, nba_game_id=51, season="2025-26")
        _make_game(session, a, b, nba_game_id=52, season="2025-26")
        _make_game(session, a, b, nba_game_id=53, season="2024-25")

        result = distinct_seasons(session)

        assert set(result) == {"2025-26", "2024-25"}
