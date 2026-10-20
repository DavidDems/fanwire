"""Tests for events/' attachment-target validation (EVENTS-009): the
`Game.completed` hybrid and validate_game_final / validate_player_game /
validate_player_career, which posts/ calls on create through
app.events.service only (0x00-architecture.md "Connection rule").

Spec: .ai/tasks/EVENTS-009/task.json. Not-yet-existing names are imported
inside each test so one missing name fails its own tests, not the module.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.db import Base, make_session_factory
from app.events.models import Game
from tests.events.players_support import (
    add_game,
    add_line,
    add_player,
    add_team,
    make_players_engine,
)


@pytest.fixture()
def engine(postgres_url):
    engine = make_players_engine(postgres_url)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def session(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture()
def teams(session):
    return add_team(session, "BOS"), add_team(session, "LAL")


def _game(session, teams, **kwargs):
    home, away = teams
    kwargs.setdefault("when", date(2024, 1, 10))
    kwargs.setdefault("season", "2023-24")
    return add_game(session, home=home, away=away, **kwargs)


# ------------------------------------------------------------ Game.completed


def test_completed_is_true_on_a_scored_game(session, teams):
    game = _game(session, teams, home_score=101, away_score=99)

    assert game.completed is True


def test_completed_is_false_on_a_zero_zero_game(session, teams):
    game = _game(session, teams, home_score=0, away_score=0)

    assert game.completed is False


def test_completed_is_usable_in_a_query(session, teams):
    played = _game(session, teams, home_score=101, away_score=99)
    one_sided = _game(session, teams, when=date(2024, 1, 11), home_score=1, away_score=0)
    _game(session, teams, when=date(2024, 1, 12), home_score=0, away_score=0)

    found = set(session.scalars(select(Game.id).where(Game.completed)).all())

    assert found == {played.id, one_sided.id}


# ------------------------------------------------------- validate_game_final


def test_validate_game_final_accepts_a_completed_game(session, teams):
    from app.events.service import validate_game_final

    game = _game(session, teams, home_score=101, away_score=99)

    assert validate_game_final(session, game.id) is None


def test_validate_game_final_refuses_an_unknown_game(session, teams):
    from app.events.errors import LinkTargetNotFoundError
    from app.events.service import validate_game_final

    game = _game(session, teams)

    with pytest.raises(LinkTargetNotFoundError):
        validate_game_final(session, game.id + 1000)


def test_validate_game_final_refuses_a_game_that_is_not_completed(session, teams):
    from app.events.errors import GameNotCompletedError
    from app.events.service import validate_game_final

    game = _game(session, teams, home_score=0, away_score=0)

    with pytest.raises(GameNotCompletedError):
        validate_game_final(session, game.id)


# ------------------------------------------------------ validate_player_game


def test_validate_player_game_accepts_a_played_line(session, teams):
    from app.events.service import validate_player_game

    game = _game(session, teams)
    line = add_line(session, game=game, team=teams[0], player=add_player(session, "A", "B"))

    assert validate_player_game(session, line.id) is None


def test_validate_player_game_accepts_a_zero_seconds_line(session, teams):
    from app.events.service import validate_player_game

    game = _game(session, teams)
    line = add_line(
        session, game=game, team=teams[0], player=add_player(session, "A", "B"), seconds_played=0
    )

    assert validate_player_game(session, line.id) is None


def test_validate_player_game_refuses_an_unknown_line(session, teams):
    from app.events.errors import LinkTargetNotFoundError
    from app.events.service import validate_player_game

    game = _game(session, teams)
    line = add_line(session, game=game, team=teams[0], player=add_player(session, "A", "B"))

    with pytest.raises(LinkTargetNotFoundError):
        validate_player_game(session, line.id + 1000)


def test_validate_player_game_refuses_a_did_not_play_line(session, teams):
    from app.events.errors import PlayerDidNotPlayError
    from app.events.service import validate_player_game

    game = _game(session, teams)
    line = add_line(
        session,
        game=game,
        team=teams[0],
        player=add_player(session, "A", "B"),
        seconds_played=None,
        dnp_reason="DNP - Coach's Decision",
    )

    with pytest.raises(PlayerDidNotPlayError):
        validate_player_game(session, line.id)


# ---------------------------------------------------- validate_player_career


def _player_with_both_scopes(session, teams):
    player = add_player(session, "Both", "Scopes")
    regular = _game(session, teams, game_type="regular")
    playoffs = _game(session, teams, when=date(2024, 4, 25), game_type="playoffs")
    add_line(session, game=regular, team=teams[0], player=player)
    add_line(session, game=playoffs, team=teams[0], player=player)
    return player


@pytest.mark.parametrize("scope", ["regular", "playoffs"])
def test_validate_player_career_accepts_a_scope_with_a_played_game(session, teams, scope):
    from app.events.service import validate_player_career

    player = _player_with_both_scopes(session, teams)

    assert validate_player_career(session, player.id, scope) is None


@pytest.mark.parametrize("scope", ["play-in", "cup-final", "Regular", "", "career"])
def test_validate_player_career_refuses_any_other_scope_with_value_error(session, teams, scope):
    from app.events.errors import LinkTargetNotFoundError, NoGamesInScopeError
    from app.events.service import validate_player_career

    player = _player_with_both_scopes(session, teams)

    with pytest.raises(ValueError) as raised:
        validate_player_career(session, player.id, scope)
    # The scope is wrong, not the target: neither target refusal.
    assert not isinstance(raised.value, (LinkTargetNotFoundError, NoGamesInScopeError))


def test_validate_player_career_refuses_an_unknown_player(session, teams):
    from app.events.errors import LinkTargetNotFoundError
    from app.events.service import validate_player_career

    player = _player_with_both_scopes(session, teams)

    with pytest.raises(LinkTargetNotFoundError):
        validate_player_career(session, player.id + 1000, "regular")


def test_validate_player_career_refuses_a_scope_with_no_games(session, teams):
    from app.events.errors import NoGamesInScopeError
    from app.events.service import validate_player_career

    player = add_player(session, "Regular", "Only")
    add_line(session, game=_game(session, teams, game_type="regular"), team=teams[0], player=player)

    with pytest.raises(NoGamesInScopeError):
        validate_player_career(session, player.id, "playoffs")


def test_validate_player_career_refuses_a_player_with_no_rows(session, teams):
    from app.events.errors import NoGamesInScopeError
    from app.events.service import validate_player_career

    player = add_player(session, "No", "Rows")

    with pytest.raises(NoGamesInScopeError):
        validate_player_career(session, player.id, "regular")


def test_validate_player_career_does_not_count_did_not_play_rows(session, teams):
    from app.events.errors import NoGamesInScopeError
    from app.events.service import validate_player_career

    player = add_player(session, "Bench", "Only")
    add_line(
        session,
        game=_game(session, teams, game_type="regular"),
        team=teams[0],
        player=player,
        seconds_played=None,
        dnp_reason="DNP - Injury",
    )

    with pytest.raises(NoGamesInScopeError):
        validate_player_career(session, player.id, "regular")


@pytest.mark.parametrize("scope", ["regular", "playoffs"])
def test_validate_player_career_does_not_count_play_in_or_cup_final(session, teams, scope):
    from app.events.errors import NoGamesInScopeError
    from app.events.service import validate_player_career

    player = add_player(session, "Play", "In")
    add_line(session, game=_game(session, teams, game_type="play-in"), team=teams[0], player=player)
    add_line(
        session,
        game=_game(session, teams, when=date(2023, 12, 9), game_type="cup-final"),
        team=teams[0],
        player=player,
    )

    with pytest.raises(NoGamesInScopeError):
        validate_player_career(session, player.id, scope)


def test_validate_player_career_counts_a_zero_seconds_line(session, teams):
    from app.events.service import validate_player_career

    player = add_player(session, "Zero", "Seconds")
    add_line(
        session,
        game=_game(session, teams, game_type="regular"),
        team=teams[0],
        player=player,
        seconds_played=0,
    )

    assert validate_player_career(session, player.id, "regular") is None
