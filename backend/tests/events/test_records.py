"""Tests for GET /events/records and GET /events/records/{record_id}
(EVENTS-010). Spec: .ai/tasks/EVENTS-010/.

Pinned contract (extra fields are tolerated):

- GET /events/records: `{since_season, through_season, records}`; records
  are the twelve of `RECORD_IDS`, in that order, each with `id`, `group`
  ("team" or "player"), `title`, `unit`, `rule` (non-empty strings) and
  `holder`: the list's first entry plus `tied_count` (how many entries
  share the first-ranked value), or null when nothing qualifies.
- GET /events/records/{record_id}?limit=&offset=: `{id, group, title, unit,
  rule, since_season, through_season, total, entries}`. A list holds at
  most its top 100 entries, `total` is min(qualifying, 100), `limit` is
  1-100 (default 25) and `offset` 0-99 (default 0); anything else is a 422,
  an unknown id a 404.
- An entry: `rank` (competition ranking), `value`, `team` ({id, name,
  abbreviation} or null), `player` ({id, first_name, last_name} or null),
  `season` (or null) and `game` ({id, date, game_type,
  opponent_abbreviation} or null).
- `since_season`/`through_season` are the earliest and latest stored
  seasons, null when there are none.

Every expected list is derived in Python from the rows the fixture wrote
(records_support.expected_records), never from app code.
"""

from __future__ import annotations

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import make_client, make_players_engine
from tests.events.records_support import (
    COUNT_RECORDS,
    GAME_RECORDS,
    LIST_CAP,
    PLAYER_RECORDS,
    RECORD_IDS,
    SEASON_RECORDS,
    TEAM_RECORDS,
    build_career_cap,
    build_fixture,
    expected_champions,
    expected_records,
    expected_window,
    normalize,
)

ENTRY_KEYS = {"rank", "value", "team", "player", "season", "game"}
CACHE_CONTROL = "public, max-age=300"
TIES_FOR_FIRST = {
    "team-best-season": 2,  # 10-2 (2011-12 BBB) and 5-1 (2010-11 AAA)
    "team-most-points-game": 2,  # 140 twice
    "player-championships": 3,  # A1, A2 and A3, two titles each
    "player-points-game": 2,  # 50 twice
    "player-rebounds-game": 2,  # 20 and 20 in the same game
}


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


@pytest.fixture()
def fixture(session_factory):
    with session_factory() as session:
        fx = build_fixture(session)
        session.commit()
    return fx


def _summary(client) -> dict:
    response = client.get("/events/records")
    assert response.status_code == 200, response.text
    return response.json()


def _list(client, record_id: str, **params) -> dict:
    response = client.get(f"/events/records/{record_id}", params=params)
    assert response.status_code == 200, response.text
    return response.json()


# ------------------------------------------------------------------ summary


def test_the_summary_lists_the_twelve_records_in_their_fixed_order(client, fixture):
    body = _summary(client)

    assert [record["id"] for record in body["records"]] == list(RECORD_IDS)
    for record in body["records"]:
        assert record["group"] == ("team" if record["id"] in TEAM_RECORDS else "player")
        for key in ("title", "unit", "rule"):
            assert isinstance(record[key], str) and record[key].strip(), (record["id"], key)


def test_the_summary_states_the_data_window(client, fixture):
    body = _summary(client)

    assert (body["since_season"], body["through_season"]) == expected_window(fixture)
    assert (body["since_season"], body["through_season"]) == ("2010-11", "2013-14")


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_each_holder_is_the_derived_first_entry_with_its_tied_count(client, fixture, record_id):
    expected = expected_records(fixture)[record_id]
    assert expected.entries, f"the fixture must give {record_id} a holder"
    # Guards the fixture: these records have a tie for first.
    assert expected.tied_count == TIES_FOR_FIRST.get(record_id, expected.tied_count)

    (record,) = [r for r in _summary(client)["records"] if r["id"] == record_id]
    holder = record["holder"]

    assert holder is not None
    assert normalize(holder) == expected.entries[0]
    assert holder["tied_count"] == expected.tied_count


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_each_summary_holder_equals_its_lists_first_entry(client, fixture, record_id):
    (record,) = [r for r in _summary(client)["records"] if r["id"] == record_id]
    first = _list(client, record_id, limit=1)["entries"][0]

    holder = dict(record["holder"])
    holder.pop("tied_count")
    assert holder == first


# -------------------------------------------------------------------- lists


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_each_list_matches_the_independently_derived_ranking(client, fixture, record_id):
    expected = expected_records(fixture)[record_id]

    body = _list(client, record_id)

    assert body["id"] == record_id
    assert body["group"] == ("team" if record_id in TEAM_RECORDS else "player")
    for key in ("title", "unit", "rule"):
        assert isinstance(body[key], str) and body[key].strip()
    assert (body["since_season"], body["through_season"]) == expected_window(fixture)
    assert body["total"] == min(len(expected.entries), LIST_CAP)
    assert [normalize(entry) for entry in body["entries"][:5]] == expected.entries[:5]
    assert len(body["entries"]) == min(len(expected.entries), 25)


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_a_list_holds_its_whole_derived_ranking_at_limit_100(client, fixture, record_id):
    expected = expected_records(fixture)[record_id]

    body = _list(client, record_id, limit=100)

    assert [normalize(entry) for entry in body["entries"]] == expected.entries[:LIST_CAP]


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_each_entry_carries_exactly_what_its_record_names(client, fixture, record_id):
    body = _list(client, record_id, limit=100)
    assert body["entries"]

    for entry in body["entries"]:
        assert ENTRY_KEYS <= set(entry)
        assert isinstance(entry["rank"], int) and not isinstance(entry["rank"], bool)
        assert isinstance(entry["value"], (int, float)) and not isinstance(entry["value"], bool)
        if record_id in COUNT_RECORDS or record_id in GAME_RECORDS:
            assert isinstance(entry["value"], int), entry
        if record_id in COUNT_RECORDS:
            assert entry["value"] > 0
        if record_id in TEAM_RECORDS:
            assert entry["player"] is None and entry["team"] is not None
        if record_id in PLAYER_RECORDS:
            assert entry["player"] is not None
        if record_id in GAME_RECORDS:
            assert entry["game"] is not None and entry["season"] is not None
            assert entry["team"] is not None
        elif record_id in SEASON_RECORDS:
            assert entry["season"] is not None and entry["game"] is None
        else:
            assert entry["season"] is None and entry["game"] is None
            if record_id in PLAYER_RECORDS:
                assert entry["team"] is None


def test_team_and_player_refs_carry_names_and_games_their_date(client, fixture):
    games = {g.id: g for g in fixture.games}

    for record_id in ("team-most-points-game", "player-points-game"):
        for entry in _list(client, record_id, limit=100)["entries"]:
            team = entry["team"]
            assert team["name"] == fixture.team_names[team["id"]]
            assert team["abbreviation"] == fixture.abbreviations[team["id"]]
            game = entry["game"]
            assert str(game["date"]).startswith(games[game["id"]].date.date().isoformat())
            assert games[game["id"]].season == entry["season"]
            if entry["player"] is not None:
                player = entry["player"]
                assert (player["first_name"], player["last_name"]) == fixture.player_names[
                    player["id"]
                ]


def test_season_records_skip_the_season_without_a_champion(client, fixture):
    """2013-14 has DDD at 6-0 and CCC at 0-6, the best and worst raw
    records, and no champion: neither may appear."""
    champions = expected_champions(fixture)
    assert champions["2013-14"] is None
    assert all(champions[s] is not None for s in ("2010-11", "2011-12", "2012-13"))

    for record_id in ("team-best-season", "team-worst-season"):
        body = _list(client, record_id, limit=100)
        assert body["entries"]
        assert all(entry["season"] != "2013-14" for entry in body["entries"]), record_id


def test_excluded_games_and_lines_never_appear(client, fixture):
    """The play-in (250-240), the cup final (260-120), their 99- and
    95-point lines and the 90-point did-not-play line are nowhere."""
    excluded = {g.id for g in fixture.games if g.game_type not in ("regular", "playoffs")}
    dnp_player = fixture.player_ids["DNP"]
    assert len(excluded) == 2

    for record_id in RECORD_IDS:
        for entry in _list(client, record_id, limit=100)["entries"]:
            if entry["game"] is not None:
                assert entry["game"]["id"] not in excluded, (record_id, entry)
                assert entry["game"]["game_type"] in ("regular", "playoffs")
            if entry["player"] is not None:
                assert entry["player"]["id"] != dnp_player, (record_id, entry)


def test_triple_doubles_count_steals_and_blocks_but_not_a_near_miss(client, fixture):
    ids = fixture.player_ids

    body = _list(client, "player-career-triple-doubles", limit=100)

    counts = {entry["player"]["id"]: entry["value"] for entry in body["entries"]}
    assert counts == {ids["A2"]: 2, ids["C3"]: 1}


def test_championships_agree_with_the_champion_route(client, fixture):
    seasons = sorted({g.season for g in fixture.games})
    titles: dict[int, int] = {}
    for season in seasons:
        response = client.get(f"/events/seasons/{season}/champion")
        assert response.status_code == 200, response.text
        champion = response.json()["champion"]
        expected = expected_champions(fixture)[season]
        assert (champion["id"] if champion else None) == expected, season
        if champion is not None:
            titles[champion["id"]] = titles.get(champion["id"], 0) + 1

    body = _list(client, "team-championships", limit=100)

    assert {entry["team"]["id"]: entry["value"] for entry in body["entries"]} == titles


def test_a_bench_player_with_only_dnp_finals_lines_has_no_title(client, fixture):
    body = _list(client, "player-championships", limit=100)

    players = {entry["player"]["id"] for entry in body["entries"]}
    assert fixture.player_ids["BENCH"] not in players
    assert fixture.player_ids["A1"] in players


# ------------------------------------------------------- the 100-entry cap


@pytest.fixture()
def capped(session_factory):
    with session_factory() as session:
        expected = build_career_cap(session)
        session.commit()
    return expected


def _triples(body: dict) -> list[tuple[int, int, int]]:
    return [(e["rank"], e["value"], e["player"]["id"]) for e in body["entries"]]


def test_a_list_holds_at_most_its_top_100_and_cuts_a_tie_at_the_100th(client, capped):
    body = _list(client, "player-career-points", limit=100)

    assert len(capped) == 106
    assert body["total"] == 100
    assert _triples(body) == capped[:100]
    # Five players share 100 points from place 99: the first two by id are in.
    assert [rank for rank, _, _ in _triples(body)[98:]] == [99, 99]


def test_the_summary_holder_of_a_capped_list(client, capped):
    (record,) = [r for r in _summary(client)["records"] if r["id"] == "player-career-points"]

    assert record["holder"]["value"] == 300
    assert record["holder"]["tied_count"] == 1


@pytest.mark.parametrize(
    ("limit", "offset"),
    [(None, None), (25, 0), (1, 0), (100, 0), (10, 95), (1, 99), (30, 80), (100, 50), (25, 75)],
)
def test_paging_slices_the_top_100(client, capped, limit, offset):
    params = {k: v for k, v in (("limit", limit), ("offset", offset)) if v is not None}
    start, size = offset or 0, limit or 25

    body = _list(client, "player-career-points", **params)

    assert body["total"] == 100
    assert _triples(body) == capped[:100][start : start + size]


# --------------------------------------------------------------- empty data


def test_an_empty_database_gives_null_holders_and_no_window(client):
    body = _summary(client)

    assert (body["since_season"], body["through_season"]) == (None, None)
    assert [record["id"] for record in body["records"]] == list(RECORD_IDS)
    assert all(record["holder"] is None for record in body["records"])


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_an_empty_database_gives_empty_lists(client, record_id):
    body = _list(client, record_id)

    assert body["id"] == record_id
    assert (body["since_season"], body["through_season"]) == (None, None)
    assert body["total"] == 0
    assert body["entries"] == []


# ---------------------------------------------------------------- refusals


def test_an_unknown_record_is_a_404_where_a_known_one_is_a_200(client):
    assert client.get("/events/records/team-championships").status_code == 200

    response = client.get("/events/records/team-most-fouls")

    assert response.status_code == 404
    assert response.json()["detail"]


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 101},
        {"limit": -1},
        {"offset": -1},
        {"offset": 100},
        {"offset": 250},
        {"limit": "many"},
    ],
)
def test_limit_and_offset_out_of_range_are_a_422(client, params):
    response = client.get("/events/records/team-championships", params=params)

    assert response.status_code == 422, response.text


@pytest.mark.parametrize(("limit", "offset"), [(1, 0), (100, 0), (100, 99), (1, 99)])
def test_the_bounds_themselves_are_accepted(client, limit, offset):
    response = client.get(
        "/events/records/team-championships", params={"limit": limit, "offset": offset}
    )

    assert response.status_code == 200, response.text


# ------------------------------------------------------------------- cache


@pytest.mark.parametrize("url", ["/events/records", "/events/records/player-career-points"])
def test_the_records_routes_are_cacheable_for_five_minutes(client, fixture, url):
    response = client.get(url)

    assert response.status_code == 200, response.text
    assert response.headers.get("cache-control") == CACHE_CONTROL
    vary = response.headers.get("vary", "").lower()
    assert "authorization" not in vary
    assert "cookie" not in vary


@pytest.mark.parametrize("url", ["/events/seasons", "/events/teams", "/events/games"])
def test_other_events_routes_send_no_cache_control(client, fixture, url):
    records = client.get("/events/records")
    assert records.headers.get("cache-control") == CACHE_CONTROL

    response = client.get(url)

    assert response.status_code == 200, response.text
    assert "cache-control" not in response.headers
