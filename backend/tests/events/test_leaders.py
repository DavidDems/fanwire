"""Tests for GET /events/seasons/{season}/leaders (EVENTS-007). Spec:
.ai/tasks/EVENTS-007/.

Pinned contract (extra fields are tolerated):

- Query: `stat` is one of points, rebounds, assists, steals, blocks,
  threes (three-pointers made); `game_type` is `regular` (the default) or
  `playoffs`; `limit` defaults to 10 (1-50). Any other value is a 422.
- The response is an object with `rule` (a non-empty string naming the
  qualifying rule applied), `minimum_games` (an int; for the playoffs 0 or
  null, there being no minimum) and `leaders`: a list of rows, each with
  `player_id`, `first_name`, `last_name`, `teams` (the abbreviations of the
  teams the player played for in those games; order not pinned),
  `games_played` and `average` (the per-game average, one place).
- Order: average desc, then player id ASCENDING (pinned).
- Only played rows (seconds_played not null) of the chosen game type count,
  for games played and for the average. For `regular`, only `regular`
  games: play-in, cup-final and playoff games are in no regular line.
- Qualifier, regular season: from 2023-24 on, 65 games; before 2023-24,
  70 % of the most `regular` games any team played that season, rounded
  up (10 team games: 7, not 8, though 0.7 * 10 is 7.000000000000001 in
  floating point; 11: 8). The playoffs have no minimum.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import (
    add_line,
    add_player,
    add_team,
    make_client,
    make_players_engine,
)
from tests.events.seasons_support import (
    STAT_COLUMNS,
    STATS,
    Calendar,
    add_games,
    add_lines,
    statements_for,
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
def client(session_factory):
    return make_client(session_factory)


def _leaders(client, season: str, **params) -> dict:
    params.setdefault("stat", "points")
    response = client.get(f"/events/seasons/{season}/leaders", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _ids(body: dict) -> list[int]:
    return [row["player_id"] for row in body["leaders"]]


# ---------------------------------------------------------------- the stats


@pytest.mark.parametrize("stat", STATS)
def test_each_stat_ranks_by_its_own_column(client, session_factory, stat):
    """Three team games (minimum 3). `leader` has 9 of the stat's column a
    game and nothing else; `other` has 5 of every other column and 1 of it."""
    column = STAT_COLUMNS[stat]
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2016-17",
            count=3,
            calendar=Calendar(date(2016, 11, 1)),
        )
        leader = add_player(session, "Stat", "Leader")
        other = add_player(session, "All", "Rounder")
        add_lines(session, games=games, team=team, player=leader, **{column: 9})
        others = {c: 5 for c in STAT_COLUMNS.values() if c != column}
        add_lines(session, games=games, team=team, player=other, **others, **{column: 1})
        session.commit()
        leader_id, other_id = leader.id, other.id

    body = _leaders(client, "2016-17", stat=stat)

    assert _ids(body) == [leader_id, other_id]
    assert [row["average"] for row in body["leaders"]] == [9.0, 1.0]


def test_a_row_carries_player_names_teams_games_and_average(client, session_factory):
    """A player traded mid-season: two games for AAA, one for BBB, 31
    points in all: 10.333... a game, 10.3. OPP played all three games, so
    the most team games is 3 and the minimum 3."""
    with session_factory() as session:
        one, two = add_team(session, "AAA"), add_team(session, "BBB")
        opponent = add_team(session, "OPP")
        calendar = Calendar(date(2016, 11, 1))
        first = add_games(
            session, team=one, opponent=opponent, season="2016-17", count=2, calendar=calendar
        )
        second = add_games(
            session, team=two, opponent=opponent, season="2016-17", count=1, calendar=calendar
        )
        player = add_player(session, "Traded", "Guard")
        add_line(session, game=first[0], team=one, player=player, points=10)
        add_line(session, game=first[1], team=one, player=player, points=11)
        add_line(session, game=second[0], team=two, player=player, points=10)
        session.commit()
        player_id = player.id

    (row,) = _leaders(client, "2016-17")["leaders"]

    assert row["player_id"] == player_id
    assert (row["first_name"], row["last_name"]) == ("Traded", "Guard")
    assert sorted(row["teams"]) == ["AAA", "BBB"]
    assert row["games_played"] == 3
    assert row["average"] == 10.3


def test_order_is_average_desc_then_player_id_ascending(client, session_factory):
    """`low` and `high` (lower and higher id) both average 12.0; `third`
    scores 10, 11, 11: 10.666..., shown 10.7. Lines are written highest id
    first, so insertion order proves nothing."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2016-17",
            count=3,
            calendar=Calendar(date(2016, 11, 1)),
        )
        low = add_player(session, "Low", "Id")
        high = add_player(session, "High", "Id")
        third = add_player(session, "Third", "Place")
        for game, points in zip(games, (10, 11, 11), strict=True):
            add_line(session, game=game, team=team, player=third, points=points)
        add_lines(session, games=games, team=team, player=high, points=12)
        add_lines(session, games=games, team=team, player=low, points=12)
        session.commit()
        assert low.id < high.id
        expected = [low.id, high.id, third.id]

    body = _leaders(client, "2016-17")

    assert _ids(body) == expected
    assert [row["average"] for row in body["leaders"]] == [12.0, 12.0, 10.7]


# -------------------------------------------------------------------- limit


@pytest.fixture()
def twelve_scorers(session_factory):
    """One regular game (minimum 1); twelve players scoring 1 to 12.
    Returns their ids, best scorer first."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        (game,) = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2016-17",
            count=1,
            calendar=Calendar(date(2016, 11, 1)),
        )
        players = []
        for points in range(1, 13):
            player = add_player(session, "Scorer", f"N{points}")
            add_line(session, game=game, team=team, player=player, points=points)
            players.append(player.id)
        session.commit()
        return list(reversed(players))


def test_limit_defaults_to_ten(client, twelve_scorers):
    body = _leaders(client, "2016-17")

    assert _ids(body) == twelve_scorers[:10]


@pytest.mark.parametrize("limit", [1, 3, 50])
def test_limit_bounds_the_list(client, twelve_scorers, limit):
    body = _leaders(client, "2016-17", limit=limit)

    assert _ids(body) == twelve_scorers[:limit]


@pytest.mark.parametrize(
    "params",
    [
        {"stat": "minutes"},
        {"stat": "Points"},
        {"stat": "three_pointers_made"},
        {"stat": "points", "game_type": "play-in"},
        {"stat": "points", "game_type": "cup-final"},
        {"stat": "points", "game_type": "preseason"},
        {"stat": "points", "limit": 0},
        {"stat": "points", "limit": 51},
        {"stat": "points", "limit": "ten"},
    ],
)
def test_a_bad_query_value_is_a_422(client, twelve_scorers, params):
    ok = client.get("/events/seasons/2016-17/leaders", params={"stat": "points"})
    response = client.get("/events/seasons/2016-17/leaders", params=params)

    assert ok.status_code == 200, ok.text
    assert response.status_code == 422, response.text


# ---------------------------------------------------------- what counts


def test_regular_leaders_count_regular_games_only(client, session_factory):
    """Two regular games at 10 points; 50-point play-in, cup-final and
    playoff games do not move the line (minimum: 70 % of 2, rounded up, 2)."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        calendar = Calendar(date(2016, 11, 1))
        regular = add_games(
            session, team=team, opponent=opponent, season="2016-17", count=2, calendar=calendar
        )
        player = add_player(session, "Regular", "Only")
        add_lines(session, games=regular, team=team, player=player, points=10)
        for game_type in ("play-in", "cup-final", "playoffs"):
            others = add_games(
                session,
                team=team,
                opponent=opponent,
                season="2016-17",
                count=2,
                calendar=calendar,
                game_type=game_type,
            )
            add_lines(session, games=others, team=team, player=player, points=50)
        session.commit()
        player_id = player.id

    (row,) = _leaders(client, "2016-17")["leaders"]

    assert row["player_id"] == player_id
    assert (row["games_played"], row["average"]) == (2, 10.0)


def test_playoff_leaders_count_playoff_games_without_a_minimum(client, session_factory):
    """Ten regular games, then three playoff rows: 20 and 30 points played,
    and a DNP. The playoff line is 2 games, 25.0; one playoff game is
    enough. A play-in game is not a playoff game."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        calendar = Calendar(date(2016, 11, 1))
        regular = add_games(
            session, team=team, opponent=opponent, season="2016-17", count=10, calendar=calendar
        )
        playoffs = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2016-17",
            count=3,
            calendar=calendar,
            game_type="playoffs",
        )
        (play_in,) = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2016-17",
            count=1,
            calendar=calendar,
            game_type="play-in",
        )
        star = add_player(session, "Playoff", "Star")
        add_lines(session, games=regular, team=team, player=star, points=5)
        add_line(session, game=playoffs[0], team=team, player=star, points=20)
        add_line(session, game=playoffs[1], team=team, player=star, points=30)
        add_line(
            session,
            game=playoffs[2],
            team=team,
            player=star,
            seconds_played=None,
            dnp_reason="DNP - Injury/Illness",
        )
        add_line(session, game=play_in, team=team, player=star, points=60)
        one_game = add_player(session, "One", "Game")
        add_line(session, game=playoffs[0], team=team, player=one_game, points=3)
        session.commit()
        star_id, one_game_id = star.id, one_game.id

    body = _leaders(client, "2016-17", game_type="playoffs")

    assert _ids(body) == [star_id, one_game_id]
    star_row, one_game_row = body["leaders"]
    assert (star_row["games_played"], star_row["average"]) == (2, 25.0)
    assert (one_game_row["games_played"], one_game_row["average"]) == (1, 3.0)
    assert body["minimum_games"] in (0, None)
    assert isinstance(body["rule"], str)
    assert body["rule"].strip()


# ---------------------------------------------------------- the qualifier


def test_before_2023_24_the_minimum_is_70_percent_of_10_team_games_7(client, session_factory):
    """AAA and OPP each play ten regular games (and AAA three playoff games,
    which do not raise the count: 70 % of 13 would be 10).
    - `seven` played 7 regular games at 10 points: qualifies.
    - `six` played 6 at 30 points, plus a DNP: 6 games, out.
    - `mixed` played 6 regular games at 40 and 3 playoff games: 6, out."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        calendar = Calendar(date(2018, 10, 17))
        regular = add_games(
            session, team=team, opponent=opponent, season="2018-19", count=10, calendar=calendar
        )
        playoffs = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2018-19",
            count=3,
            calendar=calendar,
            game_type="playoffs",
        )
        seven = add_player(session, "Seven", "Games")
        add_lines(session, games=regular[:7], team=team, player=seven, points=10)
        six = add_player(session, "Six", "Games")
        add_lines(session, games=regular[:6], team=team, player=six, points=30)
        add_line(
            session,
            game=regular[6],
            team=team,
            player=six,
            seconds_played=None,
            dnp_reason="DNP - Coach's Decision",
        )
        mixed = add_player(session, "Mixed", "Games")
        add_lines(session, games=regular[:6], team=team, player=mixed, points=40)
        add_lines(session, games=playoffs, team=team, player=mixed, points=40)
        session.commit()
        seven_id = seven.id

    body = _leaders(client, "2018-19")

    assert body["minimum_games"] == 7
    assert "70" in body["rule"]
    assert _ids(body) == [seven_id]


def test_before_2023_24_eleven_team_games_need_8(client, session_factory):
    """70 % of 11 is 7.7, rounded up to 8."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2017-18",
            count=11,
            calendar=Calendar(date(2017, 10, 17)),
        )
        eight = add_player(session, "Eight", "Games")
        add_lines(session, games=games[:8], team=team, player=eight, points=10)
        seven = add_player(session, "Seven", "Games")
        add_lines(session, games=games[:7], team=team, player=seven, points=30)
        session.commit()
        eight_id = eight.id

    body = _leaders(client, "2017-18")

    assert body["minimum_games"] == 8
    assert _ids(body) == [eight_id]


@pytest.mark.parametrize(
    ("season", "minimum"),
    [("2022-23", 3), ("2023-24", 65), ("2025-26", 65)],
)
def test_the_rule_changes_in_2023_24(client, session_factory, season, minimum):
    """Three team games: 70 % rounded up is 3 before 2023-24; from 2023-24
    the minimum is 65 whatever the team count."""
    start = int(season[:4])
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=team,
            opponent=opponent,
            season=season,
            count=3,
            calendar=Calendar(date(start, 11, 1)),
        )
        add_lines(session, games=games, team=team, player=add_player(session, "A", "B"), points=1)
        session.commit()

    body = _leaders(client, season)

    assert body["minimum_games"] == minimum
    assert ("65" if minimum == 65 else "70") in body["rule"]
    assert len(body["leaders"]) == (0 if minimum == 65 else 1)


def test_from_2023_24_the_minimum_is_65_games(client, session_factory):
    """AAA and OPP play 66 regular games (70 % would be 47).
    - `qualified` played 65 at 10 points: in.
    - `short` played 64 at 30, and two DNPs: out.
    - `half` played 50 at 40: out."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2023-24",
            count=66,
            calendar=Calendar(date(2023, 10, 24)),
        )
        qualified = add_player(session, "Sixty", "Five")
        add_lines(session, games=games[:65], team=team, player=qualified, points=10)
        short = add_player(session, "Sixty", "Four")
        add_lines(session, games=games[:64], team=team, player=short, points=30)
        add_lines(
            session,
            games=games[64:],
            team=team,
            player=short,
            seconds_played=None,
            dnp_reason="DNP - Injury/Illness",
        )
        half = add_player(session, "Fifty", "Games")
        add_lines(session, games=games[:50], team=team, player=half, points=40)
        session.commit()
        qualified_id = qualified.id

    body = _leaders(client, "2023-24")

    assert body["minimum_games"] == 65
    assert "65" in body["rule"]
    assert _ids(body) == [qualified_id]
    assert (body["leaders"][0]["games_played"], body["leaders"][0]["average"]) == (65, 10.0)


# ------------------------------------------------------------------ queries


def _season_of_size(session_factory, season: str, games: int, players: int) -> None:
    with session_factory() as session:
        team = add_team(session, f"A{season[2:4]}")
        opponent = add_team(session, f"O{season[2:4]}")
        played = add_games(
            session,
            team=team,
            opponent=opponent,
            season=season,
            count=games,
            calendar=Calendar(date(int(season[:4]), 11, 1)),
        )
        for n in range(players):
            add_lines(
                session,
                games=played,
                team=team if n % 2 else opponent,
                player=add_player(session, "Size", f"P{season}{n}"),
                points=n,
            )
        session.commit()


@pytest.mark.parametrize("game_type", ["regular", "playoffs"])
def test_leaders_is_a_fixed_number_of_grouped_queries(engine, client, session_factory, game_type):
    _season_of_size(session_factory, "2015-16", games=1, players=1)
    _season_of_size(session_factory, "2016-17", games=12, players=14)
    params = {"stat": "rebounds", "game_type": game_type}

    small = statements_for(engine, client, "/events/seasons/2015-16/leaders", **params)
    large = statements_for(engine, client, "/events/seasons/2016-17/leaders", **params)

    assert len(large) == len(small), (small, large)
    assert 1 <= len(large) <= 6, large
    assert any("GROUP BY" in statement.upper() for statement in large), large
