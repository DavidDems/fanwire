"""EVENTS-016: GET /events/records/holders also returns each record's top
three entries. Spec: .ai/tasks/EVENTS-016/task.json.

Pinned:

- Each non-null holder gains `top`: the record list's first three entries
  (fewer when the list holds fewer), each exactly as GET
  /events/records/{id}?limit=3 returns it at the same position (rank, value,
  figures, team, player, season, game), in list order. Compared with the
  list route's own answer for a team single-game record, a team season
  record, a player single-game record and a player season record, ties at
  rank 1 among them, and a record whose list holds fewer than three.
- Every existing holder field (the first entry and tied_count) is unchanged;
  null holders stay null.
- Still at most one statement per asked id, each fetching at most three
  rows (1, 3 and 6 ids).

The expected values come from the list route's response, never from the
holders code. The Cache-Control header, the 24-id cap and the 422 rules are
pinned by test_records_catalog.py and test_records_contract.py.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import make_client, make_players_engine
from tests.events.records_support import RECORD_IDS, build_fixture, recorded_queries

HOLDERS = "/events/records/holders"
TOP = 3
ENTRY_FIELDS = frozenset(
    {
        "rank",
        "value",
        "team",
        "player",
        "season",
        "game",
        "wins",
        "losses",
        "made",
        "attempted",
        "pct",
    }
)
# A team single-game record and a player single-game record, each tied at
# rank 1 in the fixture (140 points twice; 50 points twice); a team season
# record also tied at rank 1 (10-2 and 5-1); a player season record.
TIED_AT_FIRST: tuple[str, ...] = (
    "team-most-points-game",
    "player-points-game",
    "team-best-season",
)
PLAYER_SEASON = "player-points-season"
# Three seasons have a champion, AAA twice and BBB once: two entries.
SHORT_LIST = "team-championships"
COMPARED: tuple[str, ...] = (*TIED_AT_FIRST, PLAYER_SEASON, SHORT_LIST)
STATEMENT_SIZES: tuple[tuple[str, ...], ...] = (
    RECORD_IDS[:1],
    (RECORD_IDS[1], RECORD_IDS[3], RECORD_IDS[6]),
    (*COMPARED, "player-career-points"),
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


@pytest.fixture()
def fixture(session_factory):
    with session_factory() as session:
        fx = build_fixture(session)
        session.commit()
    return fx


def _holders(client, ids) -> dict[str, Any]:
    response = client.get(HOLDERS, params={"ids": ",".join(ids)})
    assert response.status_code == 200, response.text
    holders = response.json()["holders"]
    assert sorted(holders) == sorted(ids), holders
    return holders


def _first_page(client, record_id: str) -> list[dict[str, Any]]:
    """The list route's first page of TOP entries for `record_id`."""
    response = client.get(f"/events/records/{record_id}", params={"limit": TOP, "offset": 0})
    assert response.status_code == 200, response.text
    return response.json()["entries"]


# ------------------------------------------------------------------ guards


def test_the_compared_records_hold_the_traps_this_file_relies_on(client, fixture):
    """Guards this file's own choice of records against the fixture."""
    for record_id in TIED_AT_FIRST:
        page = _first_page(client, record_id)
        assert len(page) == TOP, (record_id, page)
        assert page[0]["rank"] == page[1]["rank"] == 1, (record_id, page)
    season = _first_page(client, PLAYER_SEASON)
    assert len(season) == TOP and season[0]["player"] is not None, season
    assert season[0]["season"] is not None and season[0]["game"] is None, season
    short = _first_page(client, SHORT_LIST)
    assert 1 <= len(short) < TOP, short


# ------------------------------------------------------------------ top


@pytest.mark.parametrize("record_id", COMPARED)
def test_top_is_the_list_routes_first_page_of_three(client, fixture, record_id):
    expected = _first_page(client, record_id)

    holder = _holders(client, COMPARED)[record_id]

    assert holder is not None
    assert holder["top"] == expected, record_id


def test_top_is_the_list_routes_first_page_of_three_for_every_fixture_record(client, fixture):
    holders = _holders(client, RECORD_IDS)

    for record_id in RECORD_IDS:
        expected = _first_page(client, record_id)
        holder = holders[record_id]
        if not expected:
            assert holder is None, record_id
            continue
        assert holder is not None, record_id
        assert holder["top"] == expected, record_id


def test_a_short_list_gives_a_shorter_top(client, fixture):
    expected = _first_page(client, SHORT_LIST)

    holder = _holders(client, [SHORT_LIST])[SHORT_LIST]

    assert len(holder["top"]) == len(expected) < TOP
    assert holder["top"] == expected


def test_each_top_entry_has_exactly_the_list_entry_fields(client, fixture):
    holders = _holders(client, COMPARED)

    for record_id in COMPARED:
        for entry in holders[record_id]["top"]:
            assert set(entry) == ENTRY_FIELDS, (record_id, entry)


def test_top_is_the_same_whether_asked_alone_or_among_others(client, fixture):
    together = _holders(client, COMPARED)

    for record_id in COMPARED:
        alone = _holders(client, [record_id])[record_id]
        assert alone["top"] == together[record_id]["top"], record_id


# ------------------------------------------------------------------ unchanged


def test_the_holders_own_fields_are_still_the_first_entry_and_tied_count(client, fixture):
    holders = _holders(client, COMPARED)

    for record_id in COMPARED:
        holder = holders[record_id]
        first = _first_page(client, record_id)[0]
        assert set(holder) == ENTRY_FIELDS | {"tied_count", "top"}, (record_id, holder)
        assert {field: holder[field] for field in ENTRY_FIELDS} == first, record_id
    for record_id in TIED_AT_FIRST:
        assert holders[record_id]["tied_count"] >= 2, record_id
    assert holders[PLAYER_SEASON]["tied_count"] >= 1


def test_null_holders_stay_null_with_no_top(client):
    """An empty database: nothing qualifies for any record."""
    assert _holders(client, COMPARED) == dict.fromkeys(COMPARED)


# ------------------------------------------------------------------ statements


@pytest.mark.parametrize("ids", STATEMENT_SIZES, ids=lambda ids: f"{len(ids)} ids")
def test_at_most_one_statement_per_id_each_fetching_at_most_three_rows(
    engine, client, fixture, ids
):
    warm_up = client.get(HOLDERS, params={"ids": ",".join(ids)})
    assert warm_up.status_code == 200, warm_up.text

    with recorded_queries(engine) as log:
        holders = _holders(client, ids)

    assert 1 <= len(log.statements) <= len(ids), log.statements
    pairs = list(zip(log.statements, log.rows, strict=True))
    assert max(log.rows, default=0) <= TOP, pairs
    for record_id in ids:
        assert holders[record_id] is not None and "top" in holders[record_id], record_id
