"""Tests for GET /events/seasons/{season}/leader-boards (EVENTS-017).
Spec: .ai/tasks/EVENTS-017/task.json.

Pinned contract (extra fields are tolerated):

- Query: `limit` 1-10, default 10; anything else is a 422, as is a
  malformed season. A well-formed season with no stored game is a 404.
- The response is {season, complete, rule, minimum_games, boards}.
  `boards` holds exactly BOARDS, in that order; each board is
  {stat, rule, minimum_made, leaders}. Regular-season games only.
- Every leader carries player_id, first_name, last_name, teams (the
  abbreviations; order not pinned), games_played and value.
- Count boards rank by per-game average over played rows, then player id
  ascending; `value` is that average. Percentage boards rank by total made
  / total attempted (exact), then player id; `value` is a 0-1 fraction to
  three places and each leader carries `made` and `attempted` totals.
- `complete` is true when the season has a champion (GET .../champion's
  rule). Games minimum, from 2023-24: complete -> 65; in progress ->
  ceil(65 * T / 82), at most 65, T the most regular-season games any team
  has played; the top-level `rule` names the minimum and T. Before 2023-24:
  70 % of T, rounded up, unchanged.
- Percentage boards also need a made minimum, besides the games minimum:
  300 field goals (field_goal_pct), 82 threes (three_point_pct) when
  complete; in progress ceil(base * T / 82), at most the base. The board's
  `minimum_made` is that number and its `rule` names it.
- At most five SQL statements whatever the season's size.

Arithmetic used below (integer ceilings): T = 10 -> 8 games, 37 field
goals, 10 threes. T = 66 complete -> 65, 300, 82 (in progress it would be
53, 242, 66). T = 83 in progress -> 66, 304, 83 before the caps: 65, 300, 82.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import pytest

from app.db import Base, make_session_factory
from app.events.models import Team
from app.main import app
from tests.events.players_support import (
    add_line,
    add_player,
    add_team,
    make_client,
    make_players_engine,
)
from tests.events.seasons_support import (
    Calendar,
    add_games,
    add_lines,
    add_result,
    statements_for,
)

BOARDS: tuple[str, ...] = (
    "points",
    "assists",
    "rebounds",
    "blocks",
    "steals",
    "field_goals_made",
    "threes",
    "field_goal_pct",
    "three_point_pct",
    "field_goals_attempted",
    "three_pointers_attempted",
)
# The box-score column behind each count board; threes are made threes.
COUNT_COLUMNS: dict[str, str] = {
    "points": "points",
    "assists": "assists",
    "rebounds": "rebounds",
    "blocks": "blocks",
    "steals": "steals",
    "field_goals_made": "field_goals_made",
    "threes": "three_pointers_made",
    "field_goals_attempted": "field_goals_attempted",
    "three_pointers_attempted": "three_pointers_attempted",
}
FINALS = "NBA Finals"
ROUTE = "/events/seasons/{season}/leader-boards"
OPENAPI_PATH = "/events/seasons/{season}/leader-boards"
COMMITTED_OPENAPI = Path(__file__).resolve().parents[2] / "openapi.json"


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


def _boards(client, season: str, **params) -> dict:
    response = client.get(ROUTE.format(season=season), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _board(body: dict, stat: str) -> dict:
    (board,) = [board for board in body["boards"] if board["stat"] == stat]
    return board


def _ids(board: dict) -> list[int]:
    return [row["player_id"] for row in board["leaders"]]


def _names(text: str, number: int) -> bool:
    """`number` appears in `text` as a whole number."""
    return re.search(rf"(?<!\d){number}(?!\d)", text) is not None


def _win_finals(session, *, winner: Team, loser: Team, season: str, calendar: Calendar) -> None:
    """Four 'NBA Finals' playoff games, all won by `winner` at home."""
    for _ in range(4):
        add_result(
            session,
            home=winner,
            away=loser,
            home_won=True,
            season=season,
            when=calendar.next(),
            game_type="playoffs",
            label=FINALS,
        )


# ------------------------------------------------- an in-progress season


@pytest.fixture()
def in_progress(session_factory):
    """2025-26, no champion. OPP plays AAA six times and BBB four: T = 10,
    so 8 games, 37 field goals and 10 threes. Three playoff games (not the
    Finals) and a play-in game carry big lines that must not count.

    - traded: 6 games for AAA, 4 for BBB; 20 points, 8/16 FG, 1/3 3PT a game.
    - eight: 8 games for OPP and 2 DNPs; 10 points, 5/5 FG, 2/2 3PT.
    - seven: 7 games for OPP; 50 points, 10/10 FG, 5/5 3PT: never qualifies.
    - few_made: 10 games for OPP; 6 points, 3/3 FG (30, short of 37),
      1/1 3PT (10: exactly enough).
    - nine_threes: 9 games for OPP; 11 points, 5/10 FG, 1/1 3PT (9: short).
    Returns the ids by name."""
    with session_factory() as session:
        aaa, bbb, opp = add_team(session, "AAA"), add_team(session, "BBB"), add_team(session, "OPP")
        calendar = Calendar(date(2025, 10, 21))
        with_a = add_games(
            session, team=aaa, opponent=opp, season="2025-26", count=6, calendar=calendar
        )
        with_b = add_games(
            session, team=bbb, opponent=opp, season="2025-26", count=4, calendar=calendar
        )
        everything = with_a + with_b
        playoffs = add_games(
            session,
            team=aaa,
            opponent=opp,
            season="2025-26",
            count=3,
            calendar=calendar,
            game_type="playoffs",
        )
        (play_in,) = add_games(
            session,
            team=aaa,
            opponent=opp,
            season="2025-26",
            count=1,
            calendar=calendar,
            game_type="play-in",
        )
        huge = {
            "points": 99,
            "field_goals_made": 50,
            "field_goals_attempted": 50,
            "three_pointers_made": 30,
            "three_pointers_attempted": 30,
        }

        traded = add_player(session, "Traded", "Guard")
        shooting = {
            "field_goals_made": 8,
            "field_goals_attempted": 16,
            "three_pointers_made": 1,
            "three_pointers_attempted": 3,
        }
        add_lines(session, games=with_a, team=aaa, player=traded, points=20, **shooting)
        add_lines(session, games=with_b, team=bbb, player=traded, points=20, **shooting)
        add_lines(session, games=playoffs + [play_in], team=aaa, player=traded, **huge)

        eight = add_player(session, "Eight", "Games")
        add_lines(
            session,
            games=everything[:8],
            team=opp,
            player=eight,
            points=10,
            field_goals_made=5,
            field_goals_attempted=5,
            three_pointers_made=2,
            three_pointers_attempted=2,
        )
        add_lines(
            session,
            games=everything[8:],
            team=opp,
            player=eight,
            seconds_played=None,
            dnp_reason="DNP - Injury/Illness",
        )

        seven = add_player(session, "Seven", "Games")
        add_lines(
            session,
            games=everything[:7],
            team=opp,
            player=seven,
            points=50,
            field_goals_made=10,
            field_goals_attempted=10,
            three_pointers_made=5,
            three_pointers_attempted=5,
        )
        add_lines(session, games=playoffs, team=opp, player=seven, **huge)

        few_made = add_player(session, "Few", "Made")
        add_lines(
            session,
            games=everything,
            team=opp,
            player=few_made,
            points=6,
            field_goals_made=3,
            field_goals_attempted=3,
            three_pointers_made=1,
            three_pointers_attempted=1,
        )

        nine_threes = add_player(session, "Nine", "Threes")
        add_lines(
            session,
            games=everything[:9],
            team=opp,
            player=nine_threes,
            points=11,
            field_goals_made=5,
            field_goals_attempted=10,
            three_pointers_made=1,
            three_pointers_attempted=1,
        )
        session.commit()
        return {
            "traded": traded.id,
            "eight": eight.id,
            "seven": seven.id,
            "few_made": few_made.id,
            "nine_threes": nine_threes.id,
        }


def test_the_response_holds_eleven_boards_in_the_human_s_order(client, in_progress):
    body = _boards(client, "2025-26")

    assert body["season"] == "2025-26"
    assert [board["stat"] for board in body["boards"]] == list(BOARDS)
    for board in body["boards"]:
        assert set(board) >= {"stat", "rule", "minimum_made", "leaders"}, board
        assert isinstance(board["rule"], str)
        assert board["rule"].strip()


def test_an_in_progress_season_qualifies_players_on_pace(client, in_progress):
    """No champion: complete is false; T = 10, so ceil(65 * 10 / 82) = 8."""
    body = _boards(client, "2025-26")

    assert body["complete"] is False
    assert body["minimum_games"] == 8
    assert _names(body["rule"], 8), body["rule"]
    assert _names(body["rule"], 10), body["rule"]
    assert _names(body["rule"], 65), body["rule"]


def test_a_count_board_ranks_by_per_game_average_of_regular_games(client, in_progress):
    """seven (7 games) is out; the playoff and play-in lines do not count."""
    ids = in_progress

    points = _board(_boards(client, "2025-26"), "points")

    assert _ids(points) == [ids["traded"], ids["nine_threes"], ids["eight"], ids["few_made"]]
    assert [row["value"] for row in points["leaders"]] == [20.0, 11.0, 10.0, 6.0]
    assert [row["games_played"] for row in points["leaders"]] == [10, 9, 8, 10]


def test_a_leader_carries_names_teams_and_games(client, in_progress):
    (row, *_) = _board(_boards(client, "2025-26"), "points")["leaders"]

    assert row["player_id"] == in_progress["traded"]
    assert (row["first_name"], row["last_name"]) == ("Traded", "Guard")
    assert sorted(row["teams"]) == ["AAA", "BBB"]
    assert row["games_played"] == 10


def test_field_goal_pct_needs_the_games_and_the_prorated_made_minimum(client, in_progress):
    """37 field goals (ceil(300 * 10 / 82)). eight 40/40; traded 80/160 and
    nine_threes 45/90 tie at .5, so player id; few_made has 30, seven 7
    games."""
    ids = in_progress

    board = _board(_boards(client, "2025-26"), "field_goal_pct")

    assert board["minimum_made"] == 37
    assert _names(board["rule"], 37), board["rule"]
    assert _ids(board) == [ids["eight"], ids["traded"], ids["nine_threes"]]
    assert [row["value"] for row in board["leaders"]] == [1.0, 0.5, 0.5]
    assert [(row["made"], row["attempted"]) for row in board["leaders"]] == [
        (40, 40),
        (80, 160),
        (45, 90),
    ]


def test_three_point_pct_needs_the_prorated_made_minimum(client, in_progress):
    """10 threes (ceil(82 * 10 / 82)): few_made's 10 is enough, nine_threes'
    9 is not. eight 16/16 and few_made 10/10 tie at 1.0: player id. traded
    10/30 is 0.333."""
    ids = in_progress

    board = _board(_boards(client, "2025-26"), "three_point_pct")

    assert board["minimum_made"] == 10
    assert _names(board["rule"], 10), board["rule"]
    assert _ids(board) == [ids["eight"], ids["few_made"], ids["traded"]]
    assert [row["value"] for row in board["leaders"]] == [1.0, 1.0, 0.333]
    assert [(row["made"], row["attempted"]) for row in board["leaders"]] == [
        (16, 16),
        (10, 10),
        (10, 30),
    ]


@pytest.mark.parametrize("limit", [1, 3])
def test_limit_bounds_every_board(client, in_progress, limit):
    body = _boards(client, "2025-26", limit=limit)

    for board in body["boards"]:
        assert len(board["leaders"]) <= limit, board


# ---------------------------------------------------------- each count board


@pytest.mark.parametrize("stat", list(COUNT_COLUMNS))
def test_each_count_board_ranks_by_its_own_column(client, session_factory, stat):
    """One team game, in progress (minimum 1 game). `leader` has 9 of the
    board's column a game and nothing else; `other` 5 of every other column
    and 1 of it."""
    column = COUNT_COLUMNS[stat]
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2025-26",
            count=1,
            calendar=Calendar(date(2025, 10, 21)),
        )
        leader = add_player(session, "Stat", "Leader")
        other = add_player(session, "All", "Rounder")
        add_lines(session, games=games, team=team, player=leader, **{column: 9})
        others = {c: 5 for c in COUNT_COLUMNS.values() if c != column}
        add_lines(session, games=games, team=team, player=other, **others, **{column: 1})
        session.commit()
        leader_id, other_id = leader.id, other.id

    board = _board(_boards(client, "2025-26"), stat)

    assert _ids(board) == [leader_id, other_id]
    assert [row["value"] for row in board["leaders"]] == [9.0, 1.0]


def test_a_count_board_breaks_a_tie_by_player_id(client, session_factory):
    """`low` and `high` both average 12 assists; lines are written highest
    id first."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2025-26",
            count=2,
            calendar=Calendar(date(2025, 10, 21)),
        )
        low = add_player(session, "Low", "Id")
        high = add_player(session, "High", "Id")
        add_lines(session, games=games, team=team, player=high, assists=12)
        add_lines(session, games=games, team=team, player=low, assists=12)
        session.commit()
        assert low.id < high.id
        expected = [low.id, high.id]

    board = _board(_boards(client, "2025-26"), "assists")

    assert _ids(board)[:2] == expected


def test_a_percentage_board_ranks_by_the_exact_ratio(client, session_factory):
    """Ten team games, in progress (8 games, 37 field goals). `exact` makes
    667 of 1000 (.667); `low` and `high` make 2 of 3 (.6667, shown .667
    too) and tie by id. Exact first, then low, then high."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2024-25",
            count=10,
            calendar=Calendar(date(2024, 10, 22)),
        )
        low = add_player(session, "Low", "Id")
        high = add_player(session, "High", "Id")
        exact = add_player(session, "Exact", "Shooter")
        add_lines(
            session,
            games=games,
            team=team,
            player=high,
            field_goals_made=20,
            field_goals_attempted=30,
        )
        add_lines(
            session,
            games=games,
            team=team,
            player=low,
            field_goals_made=20,
            field_goals_attempted=30,
        )
        add_lines(
            session,
            games=games[:9],
            team=team,
            player=exact,
            field_goals_made=67,
            field_goals_attempted=100,
        )
        add_line(
            session,
            game=games[9],
            team=team,
            player=exact,
            field_goals_made=64,
            field_goals_attempted=100,
        )
        session.commit()
        assert low.id < high.id
        expected = [exact.id, low.id, high.id]

    board = _board(_boards(client, "2024-25"), "field_goal_pct")

    assert _ids(board) == expected
    assert [row["value"] for row in board["leaders"]] == [0.667, 0.667, 0.667]
    assert [(row["made"], row["attempted"]) for row in board["leaders"]] == [
        (667, 1000),
        (200, 300),
        (200, 300),
    ]


# ------------------------------------------------------- a complete season


@pytest.fixture()
def complete_2023_24(session_factory):
    """2023-24: AAA and OPP play 66 regular games, AAA wins the Finals 4-0.
    Complete, so 65 games, 300 field goals, 82 threes (on pace it would be
    53, 242 and 66).
    - qualified: 65 games; 10 points, 5/10 FG (325), 2/4 3PT (130).
    - short: 64 games; 30 points, 10/10 FG, 3/3 3PT.
    - low_made: 66 games; 5 points, 4/4 FG (264), 1/1 3PT (66)."""
    with session_factory() as session:
        aaa, opp = add_team(session, "AAA"), add_team(session, "OPP")
        calendar = Calendar(date(2023, 10, 24))
        games = add_games(
            session, team=aaa, opponent=opp, season="2023-24", count=66, calendar=calendar
        )
        _win_finals(session, winner=aaa, loser=opp, season="2023-24", calendar=calendar)
        qualified = add_player(session, "Sixty", "Five")
        add_lines(
            session,
            games=games[:65],
            team=aaa,
            player=qualified,
            points=10,
            field_goals_made=5,
            field_goals_attempted=10,
            three_pointers_made=2,
            three_pointers_attempted=4,
        )
        short = add_player(session, "Sixty", "Four")
        add_lines(
            session,
            games=games[:64],
            team=aaa,
            player=short,
            points=30,
            field_goals_made=10,
            field_goals_attempted=10,
            three_pointers_made=3,
            three_pointers_attempted=3,
        )
        low_made = add_player(session, "Low", "Made")
        add_lines(
            session,
            games=games,
            team=opp,
            player=low_made,
            points=5,
            field_goals_made=4,
            field_goals_attempted=4,
            three_pointers_made=1,
            three_pointers_attempted=1,
        )
        session.commit()
        return {"qualified": qualified.id, "short": short.id, "low_made": low_made.id}


def test_a_season_with_a_champion_is_complete_and_needs_65_games(client, complete_2023_24):
    ids = complete_2023_24
    champion = client.get("/events/seasons/2023-24/champion").json()
    assert champion["champion"] is not None, champion

    body = _boards(client, "2023-24")

    assert body["complete"] is True
    assert body["minimum_games"] == 65
    assert _names(body["rule"], 65), body["rule"]
    assert _ids(_board(body, "points")) == [ids["qualified"], ids["low_made"]]


def test_a_complete_season_needs_300_field_goals_and_82_threes(client, complete_2023_24):
    ids = complete_2023_24

    body = _boards(client, "2023-24")
    field_goals = _board(body, "field_goal_pct")
    threes = _board(body, "three_point_pct")

    assert field_goals["minimum_made"] == 300
    assert _names(field_goals["rule"], 300), field_goals["rule"]
    assert _ids(field_goals) == [ids["qualified"]]
    assert threes["minimum_made"] == 82
    assert _names(threes["rule"], 82), threes["rule"]
    assert _ids(threes) == [ids["qualified"]]
    assert [(r["made"], r["attempted"], r["value"]) for r in threes["leaders"]] == [(130, 260, 0.5)]


def test_the_on_pace_minimums_stop_at_the_full_season_ones(client, session_factory):
    """In progress with T = 83 (more than 82): ceil(65 * 83 / 82) = 66 and
    ceil(300 * 83 / 82) = 304, ceil(82 * 83 / 82) = 83, all capped: 65,
    300, 82. `sixty_five` played 65 games and qualifies."""
    with session_factory() as session:
        aaa, opp = add_team(session, "AAA"), add_team(session, "OPP")
        games = add_games(
            session,
            team=aaa,
            opponent=opp,
            season="2024-25",
            count=83,
            calendar=Calendar(date(2024, 10, 22)),
        )
        sixty_five = add_player(session, "Sixty", "Five")
        add_lines(session, games=games[:65], team=aaa, player=sixty_five, points=10)
        session.commit()
        sixty_five_id = sixty_five.id

    body = _boards(client, "2024-25")

    assert body["complete"] is False
    assert body["minimum_games"] == 65
    assert _ids(_board(body, "points")) == [sixty_five_id]
    assert _board(body, "field_goal_pct")["minimum_made"] == 300
    assert _board(body, "three_point_pct")["minimum_made"] == 82


# ------------------------------------------------------- before 2023-24


@pytest.mark.parametrize("crowned", [False, True])
def test_before_2023_24_the_70_percent_rule_is_unchanged(client, session_factory, crowned):
    """2018-19, ten team games: 70 % rounded up is 7 whether or not the
    season has a champion (on pace would be 8). `seven` is in, `six` out."""
    with session_factory() as session:
        aaa, opp = add_team(session, "AAA"), add_team(session, "OPP")
        calendar = Calendar(date(2018, 10, 16))
        games = add_games(
            session, team=aaa, opponent=opp, season="2018-19", count=10, calendar=calendar
        )
        if crowned:
            _win_finals(session, winner=aaa, loser=opp, season="2018-19", calendar=calendar)
        seven = add_player(session, "Seven", "Games")
        add_lines(session, games=games[:7], team=aaa, player=seven, points=10)
        six = add_player(session, "Six", "Games")
        add_lines(session, games=games[:6], team=aaa, player=six, points=30)
        session.commit()
        seven_id = seven.id

    body = _boards(client, "2018-19")

    assert body["complete"] is crowned
    assert body["minimum_games"] == 7
    assert "70" in body["rule"], body["rule"]
    assert _ids(_board(body, "points")) == [seven_id]


# ------------------------------------------------------------------ queries


def _season_of_size(session_factory, season: str, games: int, players: int) -> None:
    with session_factory() as session:
        team = add_team(session, f"A{season[2:4]}")
        opponent = add_team(session, f"O{season[2:4]}")
        calendar = Calendar(date(int(season[:4]), 11, 1))
        played = add_games(
            session, team=team, opponent=opponent, season=season, count=games, calendar=calendar
        )
        for n in range(players):
            add_lines(
                session,
                games=played,
                team=team if n % 2 else opponent,
                player=add_player(session, "Size", f"P{season}{n}"),
                points=n,
                field_goals_made=n,
                field_goals_attempted=2 * n + 1,
                three_pointers_made=n,
                three_pointers_attempted=n + 1,
            )
        session.commit()


def test_leader_boards_take_at_most_five_statements_whatever_the_size(
    engine, client, session_factory
):
    _season_of_size(session_factory, "2024-25", games=1, players=1)
    _season_of_size(session_factory, "2025-26", games=12, players=14)

    small = statements_for(engine, client, ROUTE.format(season="2024-25"))
    large = statements_for(engine, client, ROUTE.format(season="2025-26"))

    assert len(large) == len(small), (small, large)
    assert len(large) <= 5, large
    assert sum("GROUP BY" in statement.upper() for statement in large) >= 1, large


# ----------------------------------------------------------------- 422 / 404


@pytest.fixture()
def one_game(session_factory):
    with session_factory() as session:
        bos, nyk = add_team(session, "BOS"), add_team(session, "NYK")
        add_games(
            session,
            team=bos,
            opponent=nyk,
            season="2024-25",
            count=1,
            calendar=Calendar(date(2024, 11, 1)),
        )
        session.commit()


def test_a_season_without_stored_games_is_a_404(client, one_game):
    stored = client.get(ROUTE.format(season="2024-25"))
    response = client.get(ROUTE.format(season="1999-00"))

    assert stored.status_code == 200, stored.text
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("season", ["2024", "2024-2025", "24-25", "abcd-ef", "2024_25"])
def test_a_malformed_season_is_a_422(client, one_game, season):
    response = client.get(ROUTE.format(season=season))

    assert response.status_code == 422, response.text


@pytest.mark.parametrize("limit", [0, 11, 50, "ten"])
def test_a_limit_outside_1_to_10_is_a_422(client, one_game, limit):
    ok = client.get(ROUTE.format(season="2024-25"), params={"limit": 10})
    response = client.get(ROUTE.format(season="2024-25"), params={"limit": limit})

    assert ok.status_code == 200, ok.text
    assert response.status_code == 422, response.text


def test_limit_defaults_to_ten(client, session_factory):
    """One team game, twelve scorers: every board lists ten."""
    with session_factory() as session:
        team, opponent = add_team(session, "AAA"), add_team(session, "OPP")
        (game,) = add_games(
            session,
            team=team,
            opponent=opponent,
            season="2025-26",
            count=1,
            calendar=Calendar(date(2025, 10, 21)),
        )
        for n in range(1, 13):
            add_line(
                session,
                game=game,
                team=team,
                player=add_player(session, "Scorer", f"N{n}"),
                points=n,
            )
        session.commit()

    points = _board(_boards(client, "2025-26"), "points")

    assert len(points["leaders"]) == 10
    assert [row["value"] for row in points["leaders"]] == [float(n) for n in range(12, 2, -1)]


# ------------------------------------------------------------------ openapi


def test_the_route_is_in_the_live_and_committed_openapi_documents():
    committed = json.loads(COMMITTED_OPENAPI.read_text(encoding="utf-8"))

    assert "get" in app.openapi()["paths"].get(OPENAPI_PATH, {})
    assert "get" in committed["paths"].get(OPENAPI_PATH, {})
