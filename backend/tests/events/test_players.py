"""Tests for GET /events/players: the player list and name search
(EVENTS-006). Spec: .ai/tasks/EVENTS-006/.

Pinned contract (the response field names the spec leaves to the unit):

- The response is a bare JSON list. Each item carries `id`, `first_name`,
  `last_name`, `position`, `jersey`, `first_season`, `last_season` and
  `latest_team_abbreviation`: the abbreviation of the team on the player's
  newest box-score row by game date (DNP rows included, as the spec says
  "box-score row"), null when the player has no row.
- Ordered by last name, then first name, then id. `limit` defaults to 20
  (1-100), `offset` to 0.
- `q` (1-100 characters after trimming): every whitespace-separated word must
  be a prefix of the first or the last name, case- and accent-insensitively
  (Postgres `unaccent`). `%` and `_` are literal characters, never wildcards.
- `season` (`YYYY-YY`) keeps players with a played row (seconds_played not
  null) in that season. `q` and `season` AND together.
- Every malformed value is a 422, never an empty list.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import (
    add_game,
    add_line,
    add_player,
    add_team,
    make_client,
    make_players_engine,
)

ITEM_KEYS = {
    "id",
    "first_name",
    "last_name",
    "position",
    "jersey",
    "first_season",
    "last_season",
    "latest_team_abbreviation",
}


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_players_engine(postgres_url)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def client(session_factory):
    return make_client(session_factory)


def _list(client, **params) -> list[dict]:
    response = client.get("/events/players", params=params)
    assert response.status_code == 200, response.text
    body = response.json()
    assert isinstance(body, list), body
    return body


def _ids(rows: list[dict]) -> list[int]:
    return [row["id"] for row in rows]


@pytest.fixture()
def named(session_factory):
    """Players for the search tests, returned as {key: id}."""
    with session_factory() as session:
        players = {
            "doncic": add_player(session, "Luka", "Dončić"),
            "samanic": add_player(session, "Luka", "Šamanić"),
            "jokic": add_player(session, "Nikola", "Jokić"),
            "james": add_player(session, "LeBron", "James"),
            "bronny": add_player(session, "Bronny", "James"),
            "lu_dort": add_player(session, "Luguentz", "Dort"),
            "dorian": add_player(session, "Dorian", "Finney-Smith"),
        }
        session.commit()
        return {key: player.id for key, player in players.items()}


# ----------------------------------------------------------------- the list


def test_item_carries_the_player_fields_and_latest_team(client, session_factory):
    with session_factory() as session:
        bos, mia = add_team(session, "BOS"), add_team(session, "MIA")
        player = add_player(
            session,
            "Jimmy",
            "Butler",
            position="F",
            jersey="22",
            first_season="2011-12",
            last_season="2025-26",
        )
        old = add_game(session, home=bos, away=mia, when=date(2024, 3, 1), season="2023-24")
        add_line(session, game=old, team=mia, player=player)
        session.commit()
        player_id = player.id

    (item,) = _list(client)

    assert set(item) >= ITEM_KEYS
    assert {key: item[key] for key in ITEM_KEYS} == {
        "id": player_id,
        "first_name": "Jimmy",
        "last_name": "Butler",
        "position": "F",
        "jersey": "22",
        "first_season": "2011-12",
        "last_season": "2025-26",
        "latest_team_abbreviation": "MIA",
    }


def test_latest_team_is_the_newest_row_by_game_date_not_by_insertion(client, session_factory):
    with session_factory() as session:
        tor, ind, bos = add_team(session, "TOR"), add_team(session, "IND"), add_team(session, "BOS")
        traded = add_player(session, "Pascal", "Siakam")
        # The newest game is written first, so its ids are the lowest: the
        # latest team must come from the game date, not from id order.
        newest = add_game(session, home=ind, away=bos, when=date(2024, 2, 1), season="2023-24")
        add_line(session, game=newest, team=ind, player=traded)
        oldest = add_game(session, home=tor, away=bos, when=date(2023, 11, 1), season="2023-24")
        add_line(session, game=oldest, team=tor, player=traded)
        session.commit()

    (item,) = _list(client)

    assert item["latest_team_abbreviation"] == "IND"


def test_latest_team_counts_a_did_not_play_row(client, session_factory):
    with session_factory() as session:
        tor, ind, bos = add_team(session, "TOR"), add_team(session, "IND"), add_team(session, "BOS")
        traded = add_player(session, "Pascal", "Siakam")
        played = add_game(session, home=tor, away=bos, when=date(2024, 1, 10), season="2023-24")
        add_line(session, game=played, team=tor, player=traded)
        dnp = add_game(session, home=ind, away=bos, when=date(2024, 1, 20), season="2023-24")
        add_line(
            session,
            game=dnp,
            team=ind,
            player=traded,
            seconds_played=None,
            dnp_reason="DNP - Coach's Decision",
        )
        session.commit()

    (item,) = _list(client)

    assert item["latest_team_abbreviation"] == "IND"


def test_latest_team_is_null_for_a_player_without_box_score_rows(client, session_factory):
    with session_factory() as session:
        add_player(session, "Never", "Played")
        session.commit()

    (item,) = _list(client)

    assert item["latest_team_abbreviation"] is None


def test_list_is_ordered_by_last_name_then_first_name_then_id(client, session_factory):
    with session_factory() as session:
        davis_ben = add_player(session, "Ben", "Davis")
        adams = add_player(session, "Steven", "Adams")
        davis_anthony_1 = add_player(session, "Anthony", "Davis")
        james = add_player(session, "LeBron", "James")
        davis_anthony_2 = add_player(session, "Anthony", "Davis")
        session.commit()
        expected = [
            adams.id,
            davis_anthony_1.id,
            davis_anthony_2.id,
            davis_ben.id,
            james.id,
        ]

    assert _ids(_list(client)) == expected


def test_limit_defaults_to_20_and_offset_skips(client, session_factory):
    with session_factory() as session:
        # Zero-padded last names sort the same as their numbers.
        ids = [add_player(session, "P", f"Player{n:02d}").id for n in range(25)]
        session.commit()

    assert _ids(_list(client)) == ids[:20]
    assert _ids(_list(client, limit=5, offset=3)) == ids[3:8]
    assert _ids(_list(client, offset=20)) == ids[20:]
    assert _ids(_list(client, limit=100)) == ids
    assert _list(client, offset=25) == []


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 101},
        {"offset": -1},
        {"season": "2023"},
        {"season": "2023-2024"},
        {"season": "23-24"},
        {"q": ""},
        {"q": "   "},
        {"q": "a" * 101},
        {"q": "  " + "a" * 101 + "  "},
    ],
)
def test_bad_values_are_422_not_an_empty_list(client, named, params):
    response = client.get("/events/players", params=params)

    assert response.status_code == 422, response.text


def test_q_length_is_measured_after_trimming(client, session_factory):
    with session_factory() as session:
        add_player(session, "A" * 100, "Long")
        session.commit()

    assert len(_list(client, q="   " + "a" * 100 + "   ")) == 1


# --------------------------------------------------------------------- search


@pytest.mark.parametrize("q", ["doncic", "DONČIĆ", "luka don", "lu do", "Dončić", "  lu   do  "])
def test_q_finds_luka_doncic_case_and_accent_insensitively(client, named, q):
    assert named["doncic"] in _ids(_list(client, q=q))


def test_lu_do_matches_only_players_with_both_prefixes(client, named):
    # "lu" is a prefix of Luka and Luguentz, "do" of Dončić, Dort and Dorian:
    # Luka Dončić and Luguentz Dort have one of each, Dorian Finney-Smith no "lu".
    assert set(_ids(_list(client, q="lu do"))) == {named["doncic"], named["lu_dort"]}


def test_q_word_order_does_not_matter(client, named):
    assert _ids(_list(client, q="doncic luka")) == [named["doncic"]]


def test_q_matches_a_word_against_either_name(client, named):
    assert set(_ids(_list(client, q="luka"))) == {named["doncic"], named["samanic"]}
    assert set(_ids(_list(client, q="james"))) == {named["james"], named["bronny"]}
    assert _ids(_list(client, q="jok")) == [named["jokic"]]
    assert _ids(_list(client, q="SAMAN")) == [named["samanic"]]


def test_q_is_a_prefix_match_not_a_substring_match(client, named):
    assert _list(client, q="uka") == []
    assert _list(client, q="oncic") == []


def test_every_word_of_q_must_match(client, named):
    assert _list(client, q="luka james") == []


def test_q_results_keep_the_list_order(client, named):
    assert _ids(_list(client, q="james")) == [named["bronny"], named["james"]]


@pytest.mark.parametrize("q", ["%", "_", "%%", "l_ka", "d%c", "_uka"])
def test_like_wildcards_in_q_are_literal(client, named, q):
    assert _list(client, q=q) == []


def test_a_literal_underscore_or_percent_still_matches_itself(client, session_factory):
    with session_factory() as session:
        odd = add_player(session, "A_b", "100%")
        add_player(session, "Axb", "100x")
        session.commit()
        odd_id = odd.id

    assert _ids(_list(client, q="a_")) == [odd_id]
    assert _ids(_list(client, q="100%")) == [odd_id]


def test_q_handles_a_player_with_one_name(client, session_factory):
    with session_factory() as session:
        nene = add_player(session, None, "Nenê")
        session.commit()
        nene_id = nene.id

    assert _ids(_list(client, q="nene")) == [nene_id]


# --------------------------------------------------------------------- season


@pytest.fixture()
def seasons(session_factory):
    """played: a played 2023-24 row. dnp_only: only a DNP row in 2023-24,
    a played row in 2022-23. never: no rows. Returns {key: id}."""
    with session_factory() as session:
        bos, lal = add_team(session, "BOS"), add_team(session, "LAL")
        played = add_player(session, "Luka", "Played")
        dnp_only = add_player(session, "Luka", "Benched")
        never = add_player(session, "Luka", "Never")
        other = add_player(session, "Anthony", "Davis")
        g2324 = add_game(session, home=bos, away=lal, when=date(2024, 1, 5), season="2023-24")
        g2223 = add_game(session, home=bos, away=lal, when=date(2023, 1, 5), season="2022-23")
        add_line(session, game=g2324, team=bos, player=played, seconds_played=1200)
        add_line(session, game=g2324, team=lal, player=other, seconds_played=0)
        add_line(
            session,
            game=g2324,
            team=bos,
            player=dnp_only,
            seconds_played=None,
            dnp_reason="DNP - Injury/Illness",
        )
        add_line(session, game=g2223, team=bos, player=dnp_only, seconds_played=900)
        session.commit()
        return {
            "played": played.id,
            "dnp_only": dnp_only.id,
            "never": never.id,
            "other": other.id,
        }


def test_season_keeps_players_with_a_played_row_in_that_season(client, seasons):
    # Zero seconds is still played (minutes are not null).
    assert set(_ids(_list(client, season="2023-24"))) == {seasons["played"], seasons["other"]}
    assert _ids(_list(client, season="2022-23")) == [seasons["dnp_only"]]
    assert _list(client, season="2019-20") == []


def test_q_and_season_combine_with_and(client, seasons):
    assert _ids(_list(client, q="luka", season="2023-24")) == [seasons["played"]]
    assert _ids(_list(client, q="davis", season="2022-23")) == []
