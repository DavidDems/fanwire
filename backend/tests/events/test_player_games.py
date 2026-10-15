"""Tests for GET /events/players/{player_id}/games: a player's game log
(EVENTS-006). Spec: .ai/tasks/EVENTS-006/.

Pinned contract (the response field names the spec leaves to the unit):

- The response is a bare JSON list of the player's box-score rows, played
  and did-not-play, newest first by game date, then by game id (highest
  first). `limit` defaults to 50 (1-200), `offset` to 0; `season`
  ("YYYY-YY") and `game_type` (`regular`, `cup-final`, `play-in`,
  `playoffs`) filter, ANDed. A bad value is a 422; an unknown player a 404.
- Each row carries `game_id`, `date` (the game's ISO datetime), `season`,
  `game_type`, `label`; `team` and `opponent`, each an object with at least
  `id` and `abbreviation` (TeamRefOut's names); `is_home` (the player's
  team was home); `team_score` and `opponent_score` (the player's team's and
  the opponent's final score); `starter`; `seconds_played` (null for a
  DNP); every counting stat under BoxScorePlayerOut's names; `plus_minus`;
  `field_goal_pct`, `three_point_pct`, `free_throw_pct` (the box score's
  rule: three places, null at zero attempts); and `dnp_reason`.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import (
    COUNTING_STATS,
    add_game,
    add_line,
    add_long_career,
    add_player,
    add_team,
    make_client,
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
def client(session_factory):
    return make_client(session_factory)


def _games(client, player_id: int, **params) -> list[dict]:
    response = client.get(f"/events/players/{player_id}/games", params=params)
    assert response.status_code == 200, response.text
    body = response.json()
    assert isinstance(body, list), body
    return body


def _game_ids(rows: list[dict]) -> list[int]:
    return [row["game_id"] for row in rows]


@pytest.fixture()
def career(session_factory):
    """One player's rows across 2022-23 and 2023-24, every game type, a DNP,
    written out of date order. Returns (player_id, {key: game_id}) where the
    keys are in newest-first order."""
    with session_factory() as session:
        mia, bos = add_team(session, "MIA"), add_team(session, "BOS")
        player = add_player(session, "Bam", "Adebayo")
        specs = {
            # key: (date, season, game_type, played)
            "playoffs_2": (date(2024, 4, 24), "2023-24", "playoffs", True),
            "playoffs_1": (date(2024, 4, 21), "2023-24", "playoffs", True),
            "play_in": (date(2024, 4, 17), "2023-24", "play-in", True),
            "dnp": (date(2024, 2, 1), "2023-24", "regular", False),
            "regular_2324": (date(2023, 11, 1), "2023-24", "regular", True),
            "cup_final": (date(2023, 12, 9), "2023-24", "cup-final", True),
            "regular_2223": (date(2023, 1, 5), "2022-23", "regular", True),
        }
        game_ids = {}
        for key in ("regular_2223", "playoffs_1", "dnp", "cup_final", "playoffs_2", "play_in"):
            when, season, game_type, played = specs[key]
            game = add_game(
                session, home=mia, away=bos, when=when, season=season, game_type=game_type
            )
            add_line(
                session,
                game=game,
                team=mia,
                player=player,
                seconds_played=1800 if played else None,
                dnp_reason=None if played else "DNP - Injury/Illness",
            )
            game_ids[key] = game.id
        when, season, game_type, _ = specs["regular_2324"]
        game = add_game(session, home=mia, away=bos, when=when, season=season, game_type=game_type)
        add_line(session, game=game, team=mia, player=player)
        game_ids["regular_2324"] = game.id
        session.commit()
        newest_first = [
            "playoffs_2",
            "playoffs_1",
            "play_in",
            "dnp",
            "cup_final",
            "regular_2324",
            "regular_2223",
        ]
        return player.id, {key: game_ids[key] for key in newest_first}


# ---------------------------------------------------------------------- rows


def test_row_carries_every_field_for_a_home_game(client, session_factory):
    with session_factory() as session:
        bos, lal = add_team(session, "BOS"), add_team(session, "LAL")
        player = add_player(session, "Jayson", "Tatum")
        game = add_game(
            session,
            home=bos,
            away=lal,
            when=datetime.combine(date(2024, 6, 17), time(20, 30)),
            season="2023-24",
            game_type="playoffs",
            home_score=106,
            away_score=88,
            label="NBA Finals",
        )
        add_line(
            session,
            game=game,
            team=bos,
            player=player,
            starter=True,
            starting_position="F",
            seconds_played=2718,
            field_goals_made=11,
            field_goals_attempted=23,
            three_pointers_made=2,
            three_pointers_attempted=7,
            free_throws_made=7,
            free_throws_attempted=9,
            offensive_rebounds=1,
            defensive_rebounds=7,
            rebounds=8,
            assists=11,
            steals=1,
            blocks=0,
            turnovers=4,
            personal_fouls=2,
            points=31,
            plus_minus=19,
        )
        session.commit()
        ids = (player.id, game.id, bos.id, lal.id)

    player_id, game_id, bos_id, lal_id = ids
    (row,) = _games(client, player_id)

    assert row["date"].startswith("2024-06-17T20:30")
    assert row["team"]["id"] == bos_id
    assert row["team"]["abbreviation"] == "BOS"
    assert row["opponent"]["id"] == lal_id
    assert row["opponent"]["abbreviation"] == "LAL"
    expected = {
        "game_id": game_id,
        "season": "2023-24",
        "game_type": "playoffs",
        "label": "NBA Finals",
        "is_home": True,
        "team_score": 106,
        "opponent_score": 88,
        "starter": True,
        "seconds_played": 2718,
        "field_goals_made": 11,
        "field_goals_attempted": 23,
        "field_goal_pct": 0.478,
        "three_pointers_made": 2,
        "three_pointers_attempted": 7,
        "three_point_pct": 0.286,
        "free_throws_made": 7,
        "free_throws_attempted": 9,
        "free_throw_pct": 0.778,
        "offensive_rebounds": 1,
        "defensive_rebounds": 7,
        "rebounds": 8,
        "assists": 11,
        "steals": 1,
        "blocks": 0,
        "turnovers": 4,
        "personal_fouls": 2,
        "points": 31,
        "plus_minus": 19,
        "dnp_reason": None,
    }
    assert {key: row[key] for key in expected} == expected


def test_away_game_flips_team_and_opponent(client, session_factory):
    with session_factory() as session:
        bos, lal = add_team(session, "BOS"), add_team(session, "LAL")
        player = add_player(session, "LeBron", "James")
        game = add_game(
            session,
            home=bos,
            away=lal,
            when=date(2024, 1, 5),
            season="2023-24",
            home_score=106,
            away_score=88,
        )
        add_line(session, game=game, team=lal, player=player, plus_minus=-15)
        session.commit()
        ids = (player.id, bos.id, lal.id)

    player_id, bos_id, lal_id = ids
    (row,) = _games(client, player_id)

    assert row["is_home"] is False
    assert (row["team"]["id"], row["team"]["abbreviation"]) == (lal_id, "LAL")
    assert (row["opponent"]["id"], row["opponent"]["abbreviation"]) == (bos_id, "BOS")
    assert (row["team_score"], row["opponent_score"]) == (88, 106)
    assert row["plus_minus"] == -15
    assert row["starter"] is False


def test_did_not_play_row_has_no_minutes_and_its_reason(client, session_factory):
    with session_factory() as session:
        bos, lal = add_team(session, "BOS"), add_team(session, "LAL")
        player = add_player(session, "Kristaps", "Porzingis")
        game = add_game(session, home=bos, away=lal, when=date(2024, 1, 5), season="2023-24")
        add_line(
            session,
            game=game,
            team=bos,
            player=player,
            seconds_played=None,
            dnp_reason="DNP - Injury/Illness",
        )
        session.commit()
        player_id = player.id

    (row,) = _games(client, player_id)

    assert row["seconds_played"] is None
    assert row["dnp_reason"] == "DNP - Injury/Illness"
    for stat in COUNTING_STATS:
        assert row[stat] == 0, stat
    for pct in ("field_goal_pct", "three_point_pct", "free_throw_pct"):
        assert row[pct] is None, pct


def test_log_has_played_and_dnp_rows_of_every_game_type_newest_first(client, career):
    player_id, game_ids = career

    assert _game_ids(_games(client, player_id)) == list(game_ids.values())


def test_games_on_the_same_date_are_ordered_by_game_id_highest_first(client, session_factory):
    with session_factory() as session:
        bos, lal = add_team(session, "BOS"), add_team(session, "LAL")
        player = add_player(session, "Same", "Day")
        when = datetime.combine(date(2024, 1, 5), time(19, 30))
        ids = []
        for _ in range(3):
            game = add_game(session, home=bos, away=lal, when=when, season="2023-24")
            add_line(session, game=game, team=bos, player=player)
            ids.append(game.id)
        session.commit()
        player_id = player.id

    assert _game_ids(_games(client, player_id)) == sorted(ids, reverse=True)


def test_log_holds_only_this_players_rows(client, session_factory, career):
    player_id, game_ids = career
    with session_factory() as session:
        tor, nyk = add_team(session, "TOR"), add_team(session, "NYK")
        other = add_player(session, "Other", "Player")
        game = add_game(session, home=tor, away=nyk, when=date(2025, 1, 1), season="2024-25")
        add_line(session, game=game, team=tor, player=other)
        session.commit()

    assert _game_ids(_games(client, player_id)) == list(game_ids.values())


def test_player_without_rows_has_an_empty_log(client, session_factory):
    with session_factory() as session:
        player = add_player(session, "No", "Games")
        session.commit()
        player_id = player.id

    assert _games(client, player_id) == []


# ------------------------------------------------------------ paging/filters


def test_limit_defaults_to_50_and_offset_skips(client, session_factory):
    with session_factory() as session:
        team, opponent = add_team(session, "OKC"), add_team(session, "DEN")
        player = add_player(session, "Iron", "Man")
        ids = []
        for n in range(205):
            game = add_game(
                session,
                home=team,
                away=opponent,
                when=date(2020, 1, 1) + timedelta(days=n),
                season="2019-20",
            )
            add_line(session, game=game, team=team, player=player)
            ids.append(game.id)
        session.commit()
        player_id = player.id
    newest_first = list(reversed(ids))

    assert _game_ids(_games(client, player_id)) == newest_first[:50]
    assert _game_ids(_games(client, player_id, limit=3, offset=2)) == newest_first[2:5]
    assert _game_ids(_games(client, player_id, limit=200)) == newest_first[:200]
    assert _game_ids(_games(client, player_id, limit=200, offset=200)) == newest_first[200:]


def test_season_filter(client, career):
    player_id, game_ids = career

    assert _game_ids(_games(client, player_id, season="2022-23")) == [game_ids["regular_2223"]]
    assert _game_ids(_games(client, player_id, season="2023-24")) == list(game_ids.values())[:-1]
    assert _games(client, player_id, season="2010-11") == []


@pytest.mark.parametrize(
    ("game_type", "keys"),
    [
        ("playoffs", ["playoffs_2", "playoffs_1"]),
        ("play-in", ["play_in"]),
        ("cup-final", ["cup_final"]),
        ("regular", ["dnp", "regular_2324", "regular_2223"]),
    ],
)
def test_game_type_filter(client, career, game_type, keys):
    player_id, game_ids = career

    rows = _games(client, player_id, game_type=game_type)

    assert _game_ids(rows) == [game_ids[key] for key in keys]


def test_season_and_game_type_combine_with_and(client, career):
    player_id, game_ids = career

    rows = _games(client, player_id, season="2022-23", game_type="regular")

    assert _game_ids(rows) == [game_ids["regular_2223"]]
    assert _games(client, player_id, season="2022-23", game_type="playoffs") == []


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 201},
        {"offset": -1},
        {"season": "2023"},
        {"season": "2023-2024"},
        {"game_type": "preseason"},
        {"game_type": "Regular"},
    ],
)
def test_bad_values_are_422(client, career, params):
    player_id, _ = career

    response = client.get(f"/events/players/{player_id}/games", params=params)

    assert response.status_code == 422, response.text


def test_unknown_player_is_404(client, career):
    player_id, _ = career
    assert client.get(f"/events/players/{player_id}/games").status_code == 200

    response = client.get(f"/events/players/{player_id + 1000}/games")

    assert response.status_code == 404


# -------------------------------------------------------------------- queries


def _log_statements(engine, client, player_id: int) -> list[str]:
    _games(client, player_id)  # warm-up: connection setup is not the log's
    with recorded_statements(engine) as statements:
        _games(client, player_id, limit=200)
    return statements


def test_log_is_a_fixed_number_of_queries_whatever_the_career(engine, client, session_factory):
    with session_factory() as session:
        one, two, opponent = (
            add_team(session, "PHX"),
            add_team(session, "DAL"),
            add_team(session, "SAS"),
        )
        short = add_player(session, "Short", "Career")
        for day in (1, 2, 3):
            game = add_game(
                session, home=one, away=opponent, when=date(2024, 1, day), season="2023-24"
            )
            add_line(session, game=game, team=one, player=short, points=day)
        long = add_player(session, "Long", "Career")
        assert add_long_career(session, long, [one, two], opponent) >= 40
        session.commit()
        short_id, long_id = short.id, long.id

    small = _log_statements(engine, client, short_id)
    large = _log_statements(engine, client, long_id)

    assert len(_games(client, long_id, limit=200)) >= 40
    assert len(large) == len(small), (small, large)
    assert 1 <= len(large) <= 4, large
