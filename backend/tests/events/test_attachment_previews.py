"""Tests for events/' batch attachment previews (EVENTS-009):
game_final_previews, player_game_previews and player_career_previews, the
reads posts/ makes to put a preview in every response.

Pinned: each returns a dict keyed by its input (game id, line id, or a
(player_id, scope) pair) of a frozen dataclass; an id with no row is absent,
never a placeholder; a DNP line comes back as stored; a career preview's
figures are player_detail's career line for the same player; and each read
is 0 queries for an empty input and the same number (at most 2) for 1 id as
for 25. Field names follow the module's own (PlayerGame, StatLine).

Spec: .ai/tasks/EVENTS-009/task.json. Not-yet-existing names are imported
inside each test so one missing name fails its own tests, not the module.
"""

from __future__ import annotations

import dataclasses
from datetime import date, datetime

import pytest

from app.db import Base, make_session_factory
from app.events.service import TeamRef, player_detail
from tests.events.players_support import (
    add_game,
    add_line,
    add_long_career,
    add_player,
    add_team,
    make_players_engine,
    recorded_statements,
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
    return add_team(session, "BOS", "Boston Celtics"), add_team(
        session, "LAL", "Los Angeles Lakers"
    )


def _ref(team) -> TeamRef:
    return TeamRef(id=team.id, name=team.name, abbreviation=team.abbreviation)


def _assert_frozen(preview, field: str) -> None:
    assert dataclasses.is_dataclass(preview)
    with pytest.raises(dataclasses.FrozenInstanceError):
        setattr(preview, field, None)


# ------------------------------------------------------- game_final_previews

GAME_FINAL_FIELDS = {
    "game_id",
    "date",
    "season",
    "game_type",
    "label",
    "sub_label",
    "series_game_number",
    "home_team",
    "away_team",
    "home_score",
    "away_score",
}


def _finals_game(session, teams):
    home, away = teams
    game = add_game(
        session,
        home=home,
        away=away,
        when=datetime(2024, 6, 17, 20, 30),
        season="2023-24",
        game_type="playoffs",
        home_score=106,
        away_score=88,
        label="NBA Finals",
    )
    game.sub_label = "Game 5"
    game.series_game_number = 5
    session.flush()
    return game


def test_game_final_preview_carries_the_game_and_both_teams(session, teams):
    from app.events.service import game_final_previews

    home, away = teams
    game = _finals_game(session, teams)

    previews = game_final_previews(session, [game.id])

    assert set(previews) == {game.id}
    preview = previews[game.id]
    assert GAME_FINAL_FIELDS <= {f.name for f in dataclasses.fields(preview)}
    assert preview.game_id == game.id
    assert preview.date == datetime(2024, 6, 17, 20, 30)
    assert preview.season == "2023-24"
    assert preview.game_type == "playoffs"
    assert preview.label == "NBA Finals"
    assert preview.sub_label == "Game 5"
    assert preview.series_game_number == 5
    assert preview.home_team == _ref(home)
    assert preview.away_team == _ref(away)
    assert preview.home_score == 106
    assert preview.away_score == 88


def test_game_final_preview_is_frozen(session, teams):
    from app.events.service import GameFinalPreview, game_final_previews

    game = _finals_game(session, teams)

    preview = game_final_previews(session, [game.id])[game.id]

    assert isinstance(preview, GameFinalPreview)
    _assert_frozen(preview, "home_score")


def test_game_final_previews_leave_out_an_unknown_id(session, teams):
    from app.events.service import game_final_previews

    game = _finals_game(session, teams)
    unknown = game.id + 1000

    previews = game_final_previews(session, [game.id, unknown])

    assert set(previews) == {game.id}


def test_game_final_previews_of_nothing_is_an_empty_dict(session, teams):
    from app.events.service import game_final_previews

    assert game_final_previews(session, []) == {}


# ------------------------------------------------------ player_game_previews

PLAYER_GAME_FIELDS = {
    "line_id",
    "game_id",
    "player_id",
    "first_name",
    "last_name",
    "team",
    "opponent",
    "is_home",
    "team_score",
    "opponent_score",
    "date",
    "season",
    "game_type",
    "label",
    "starter",
    "seconds_played",
    "points",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "field_goals_made",
    "field_goals_attempted",
    "field_goal_pct",
    "three_pointers_made",
    "three_pointers_attempted",
    "three_point_pct",
    "free_throws_made",
    "free_throws_attempted",
    "free_throw_pct",
    "plus_minus",
    "dnp_reason",
}


def test_player_game_preview_carries_the_line_and_its_game(session, teams):
    from app.events.service import player_game_previews

    home, away = teams
    game = _finals_game(session, teams)
    player = add_player(session, "Jaylen", "Brown")
    line = add_line(
        session,
        game=game,
        team=away,  # the away side, so team/opponent and scores swap
        player=player,
        starter=True,
        starting_position="G",
        seconds_played=2280,
        points=21,
        rebounds=8,
        assists=6,
        steals=2,
        blocks=1,
        turnovers=3,
        field_goals_made=4,
        field_goals_attempted=9,
        three_pointers_made=1,
        three_pointers_attempted=3,
        free_throws_made=2,
        free_throws_attempted=2,
        plus_minus=-7,
    )

    previews = player_game_previews(session, [line.id])

    assert set(previews) == {line.id}
    preview = previews[line.id]
    assert PLAYER_GAME_FIELDS <= {f.name for f in dataclasses.fields(preview)}
    assert preview.line_id == line.id
    assert preview.game_id == game.id
    assert preview.player_id == player.id
    assert preview.first_name == "Jaylen"
    assert preview.last_name == "Brown"
    assert preview.team == _ref(away)
    assert preview.opponent == _ref(home)
    assert preview.is_home is False
    assert preview.team_score == 88
    assert preview.opponent_score == 106
    assert preview.date == datetime(2024, 6, 17, 20, 30)
    assert preview.season == "2023-24"
    assert preview.game_type == "playoffs"
    assert preview.label == "NBA Finals"
    assert preview.starter is True
    assert preview.seconds_played == 2280
    assert preview.points == 21
    assert preview.rebounds == 8
    assert preview.assists == 6
    assert preview.steals == 2
    assert preview.blocks == 1
    assert preview.turnovers == 3
    assert preview.field_goals_made == 4
    assert preview.field_goals_attempted == 9
    assert preview.field_goal_pct == 0.444
    assert preview.three_pointers_made == 1
    assert preview.three_pointers_attempted == 3
    assert preview.three_point_pct == 0.333
    assert preview.free_throws_made == 2
    assert preview.free_throws_attempted == 2
    assert preview.free_throw_pct == 1.0
    assert preview.plus_minus == -7
    assert preview.dnp_reason is None


def test_player_game_preview_of_a_home_line(session, teams):
    from app.events.service import player_game_previews

    home, away = teams
    game = _finals_game(session, teams)
    line = add_line(session, game=game, team=home, player=add_player(session, "J", "T"))

    preview = player_game_previews(session, [line.id])[line.id]

    assert preview.team == _ref(home)
    assert preview.opponent == _ref(away)
    assert preview.is_home is True
    assert preview.team_score == 106
    assert preview.opponent_score == 88
    # Nothing attempted: percentages null, never 0.
    assert preview.field_goal_pct is None
    assert preview.three_point_pct is None
    assert preview.free_throw_pct is None


def test_player_game_preview_returns_a_did_not_play_line_as_stored(session, teams):
    from app.events.service import player_game_previews

    game = _finals_game(session, teams)
    line = add_line(
        session,
        game=game,
        team=teams[0],
        player=add_player(session, "Bench", "Player"),
        seconds_played=None,
        dnp_reason="DNP - Coach's Decision",
    )

    previews = player_game_previews(session, [line.id])

    assert set(previews) == {line.id}
    preview = previews[line.id]
    assert preview.seconds_played is None
    assert preview.dnp_reason == "DNP - Coach's Decision"
    assert preview.points == 0


def test_player_game_preview_is_frozen(session, teams):
    from app.events.service import PlayerGamePreview, player_game_previews

    game = _finals_game(session, teams)
    line = add_line(session, game=game, team=teams[0], player=add_player(session, "A", "B"))

    preview = player_game_previews(session, [line.id])[line.id]

    assert isinstance(preview, PlayerGamePreview)
    _assert_frozen(preview, "points")


def test_player_game_previews_leave_out_an_unknown_id(session, teams):
    from app.events.service import player_game_previews

    game = _finals_game(session, teams)
    line = add_line(session, game=game, team=teams[0], player=add_player(session, "A", "B"))

    previews = player_game_previews(session, [line.id, line.id + 1000])

    assert set(previews) == {line.id}


def test_player_game_previews_of_nothing_is_an_empty_dict(session, teams):
    from app.events.service import player_game_previews

    assert player_game_previews(session, []) == {}


# ---------------------------------------------------- player_career_previews

CAREER_FIELDS = {
    "player_id",
    "first_name",
    "last_name",
    "position",
    "first_season",
    "last_season",
    "scope",
    "games_played",
    "points_per_game",
    "rebounds_per_game",
    "assists_per_game",
    "minutes_per_game",
    "field_goal_pct",
    "three_point_pct",
    "free_throw_pct",
}
# The figures a career preview shares with player_detail's StatLine.
CAREER_FIGURES = (
    "games_played",
    "points_per_game",
    "rebounds_per_game",
    "assists_per_game",
    "minutes_per_game",
    "field_goal_pct",
    "three_point_pct",
    "free_throw_pct",
)


def _career_player(session, teams):
    """add_long_career's regular and playoff rows, plus play-in and
    cup-final rows that must count in neither scope."""
    home, away = teams
    player = add_player(
        session,
        "Devin",
        "Booker",
        position="G",
        first_season="2015-16",
        last_season="2019-20",
    )
    other = add_team(session, "PHX")
    add_long_career(session, player, [home, away], other)
    for when, game_type in ((date(2021, 4, 14), "play-in"), (date(2020, 12, 9), "cup-final")):
        game = add_game(
            session, home=home, away=other, when=when, season="2020-21", game_type=game_type
        )
        add_line(
            session,
            game=game,
            team=home,
            player=player,
            seconds_played=2400,
            points=50,
            rebounds=20,
            field_goals_made=20,
            field_goals_attempted=20,
        )
    return player


def test_player_career_preview_carries_the_player(session, teams):
    from app.events.service import player_career_previews

    player = _career_player(session, teams)
    key = (player.id, "regular")

    previews = player_career_previews(session, [key])

    assert set(previews) == {key}
    preview = previews[key]
    assert CAREER_FIELDS <= {f.name for f in dataclasses.fields(preview)}
    assert preview.player_id == player.id
    assert preview.first_name == "Devin"
    assert preview.last_name == "Booker"
    assert preview.position == "G"
    assert preview.first_season == "2015-16"
    assert preview.last_season == "2019-20"
    assert preview.scope == "regular"


@pytest.mark.parametrize(
    ("scope", "career"), [("regular", "career_regular"), ("playoffs", "career_playoffs")]
)
def test_player_career_preview_figures_equal_player_detail(session, teams, scope, career):
    player = _career_player(session, teams)
    expected = getattr(player_detail(session, player.id), career)
    # Not vacuous: the fixture has games in the scope, play-in/cup-final excluded.
    assert expected.games_played == (35 if scope == "regular" else 10)

    from app.events.service import player_career_previews

    preview = player_career_previews(session, [(player.id, scope)])[(player.id, scope)]

    for figure in CAREER_FIGURES:
        assert getattr(preview, figure) == getattr(expected, figure), figure


def test_player_career_previews_take_both_scopes_of_one_player_at_once(session, teams):
    from app.events.service import player_career_previews

    player = _career_player(session, teams)
    detail = player_detail(session, player.id)

    previews = player_career_previews(session, [(player.id, "regular"), (player.id, "playoffs")])

    assert previews[(player.id, "regular")].games_played == detail.career_regular.games_played
    assert previews[(player.id, "playoffs")].games_played == detail.career_playoffs.games_played
    assert previews[(player.id, "playoffs")].scope == "playoffs"


def test_player_career_preview_of_a_scope_with_no_games_has_null_averages(session, teams):
    from app.events.service import player_career_previews

    home, away = teams
    player = add_player(session, "Regular", "Only")
    game = add_game(session, home=home, away=away, when=date(2024, 1, 10), season="2023-24")
    add_line(session, game=game, team=home, player=player, points=12, field_goals_attempted=5)
    key = (player.id, "playoffs")

    previews = player_career_previews(session, [key])

    assert set(previews) == {key}
    preview = previews[key]
    assert preview.games_played == 0
    for figure in CAREER_FIGURES[1:]:
        assert getattr(preview, figure) is None, figure


def test_player_career_preview_of_a_player_with_no_rows_has_null_averages(session, teams):
    from app.events.service import player_career_previews

    player = add_player(session, "No", "Rows")
    key = (player.id, "regular")

    preview = player_career_previews(session, [key])[key]

    assert preview.games_played == 0
    for figure in CAREER_FIGURES[1:]:
        assert getattr(preview, figure) is None, figure


def test_player_career_preview_is_frozen(session, teams):
    from app.events.service import PlayerCareerPreview, player_career_previews

    player = _career_player(session, teams)
    key = (player.id, "regular")

    preview = player_career_previews(session, [key])[key]

    assert isinstance(preview, PlayerCareerPreview)
    _assert_frozen(preview, "games_played")


def test_player_career_previews_leave_out_an_unknown_player(session, teams):
    from app.events.service import player_career_previews

    player = _career_player(session, teams)
    known, unknown = (player.id, "regular"), (player.id + 1000, "regular")

    previews = player_career_previews(session, [known, unknown])

    assert set(previews) == {known}


def test_player_career_previews_of_nothing_is_an_empty_dict(session, teams):
    from app.events.service import player_career_previews

    assert player_career_previews(session, []) == {}


# --------------------------------------------------------------- query counts


def _many(session_factory):
    """25 games, 25 lines on them (various players, both sides) and 25
    (player_id, scope) keys over 13 players. Returns the three id lists."""
    with session_factory() as session:
        teams = [add_team(session, f"T{n:02d}") for n in range(6)]
        players = [add_player(session, f"P{n}", f"L{n}") for n in range(13)]
        game_ids, line_ids = [], []
        for n in range(25):
            home, away = teams[n % 6], teams[(n + 1) % 6]
            game = add_game(
                session,
                home=home,
                away=away,
                when=date(2024, 1, 1 + n),
                season="2023-24",
                game_type="playoffs" if n % 3 == 0 else "regular",
            )
            line = add_line(
                session,
                game=game,
                team=home if n % 2 else away,
                player=players[n % 13],
                seconds_played=None if n == 7 else 900 + n,
                dnp_reason="DNP - Rest" if n == 7 else None,
                points=n,
            )
            game_ids.append(game.id)
            line_ids.append(line.id)
        keys = [(p.id, scope) for p in players for scope in ("regular", "playoffs")][:25]
        session.commit()
    return game_ids, line_ids, keys


def _count(engine, session_factory, read, ids) -> int:
    with session_factory() as session, recorded_statements(engine) as statements:
        result = read(session, ids)
    assert len(result) == len(ids)
    return len(statements)


@pytest.mark.parametrize("name", ["game_final_previews", "player_game_previews"])
def test_previews_of_nothing_issue_no_query(engine, session_factory, name):
    from app.events import service

    read = getattr(service, name)
    with session_factory() as session, recorded_statements(engine) as statements:
        assert read(session, []) == {}
    assert statements == []


def test_career_previews_of_nothing_issue_no_query(engine, session_factory):
    from app.events.service import player_career_previews

    with session_factory() as session, recorded_statements(engine) as statements:
        assert player_career_previews(session, []) == {}
    assert statements == []


@pytest.mark.parametrize(
    ("name", "which"),
    [("game_final_previews", 0), ("player_game_previews", 1), ("player_career_previews", 2)],
)
def test_previews_cost_the_same_bounded_queries_for_1_and_25(engine, session_factory, name, which):
    ids = _many(session_factory)[which]
    assert len(ids) == 25

    from app.events import service

    read = getattr(service, name)

    one = _count(engine, session_factory, read, ids[:1])
    many = _count(engine, session_factory, read, ids)

    assert one == many
    assert 1 <= many <= 2
