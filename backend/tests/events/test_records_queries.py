"""EVENTS-010 Baseline (b) and (c), reshaped by EVENTS-012: the records
routes are built in a fixed number of queries whatever the data's size.

- GET /events/records, the catalog: exactly one statement (the data window).
- GET /events/records/holders?ids=...: at most 1 + len(ids) statements, each
  fetching at most one row, for up to 24 ids, the featured sixteen among them.
- GET /events/records/{record_id}: at most 3 for any page.

Measured on two sizes: records_support's correctness fixture, then the same
database after every season is copied three times under new season labels
(four times the games and box-score rows). The counts must be identical.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.db import Base, make_session_factory
from app.events import records
from tests.events.players_support import make_client, make_players_engine
from tests.events.records_library import FEATURED, HOLDERS_CAP, LIBRARY_IDS
from tests.events.records_support import (
    RECORD_IDS,
    QueryLog,
    add_copies,
    build_fixture,
    recorded_queries,
)

CATALOG_QUERIES = 1
LIST_MAX_QUERIES = 3
# 24 ids: the featured sixteen, then the first eight others of the library.
HOLDER_IDS: tuple[str, ...] = (
    FEATURED + tuple(i for i in LIBRARY_IDS if i not in FEATURED)[: HOLDERS_CAP - len(FEATURED)]
)
PAGES: tuple[tuple[int, int], ...] = ((1, 0), (25, 0), (100, 0), (1, 50), (25, 50), (100, 50))


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


def _measure(engine, client, url: str, **params: Any) -> QueryLog:
    """One call's statements and rows, after a warm-up call."""
    warm_up = client.get(url, params=params)
    assert warm_up.status_code == 200, warm_up.text
    with recorded_queries(engine) as log:
        response = client.get(url, params=params)
    assert response.status_code == 200, response.text
    return log


def _at_two_sizes(engine, client, session_factory, measure) -> tuple[dict, dict]:
    """`measure(engine, client)` on the correctness fixture, then again after
    every season is copied three times."""
    with session_factory() as session:
        fx = build_fixture(session)
        session.commit()
    small = measure(engine, client)
    with session_factory() as session:
        add_copies(session, fx, copies=3)
        session.commit()
    assert len({g.season for g in fx.games}) == 16, "the copies need new season labels"
    large = measure(engine, client)
    return small, large


def _catalog(engine, client) -> dict[tuple, QueryLog]:
    return {("catalog",): _measure(engine, client, "/events/records")}


def _holders(ids: tuple[str, ...]):
    def measure(engine, client) -> dict[tuple, QueryLog]:
        return {
            ("holders",): _measure(engine, client, "/events/records/holders", ids=",".join(ids))
        }

    return measure


def _lists(record_id: str):
    def measure(engine, client) -> dict[tuple, QueryLog]:
        return {
            (record_id, limit, offset): _measure(
                engine, client, f"/events/records/{record_id}", limit=limit, offset=offset
            )
            for limit, offset in PAGES
        }

    return measure


def test_the_catalog_is_exactly_one_query_at_both_sizes(engine, client, session_factory):
    small, large = _at_two_sizes(engine, client, session_factory, _catalog)

    for log in (small[("catalog",)], large[("catalog",)]):
        assert len(log.statements) == CATALOG_QUERIES, log.statements


def test_the_holder_ids_are_24_distinct_known_ids_with_the_featured_sixteen():
    """Guards this file's own choice."""
    assert len(HOLDER_IDS) == len(set(HOLDER_IDS)) == HOLDERS_CAP
    assert set(FEATURED) <= set(HOLDER_IDS)


@pytest.mark.parametrize(
    "ids",
    [HOLDER_IDS, RECORD_IDS, ("player-career-points",)],
    ids=["24 with the featured 16", "the twelve", "one"],
)
def test_holders_are_at_most_one_plus_len_ids_queries_at_both_sizes(
    engine, client, session_factory, ids
):
    small, large = _at_two_sizes(engine, client, session_factory, _holders(tuple(ids)))

    for log in (small[("holders",)], large[("holders",)]):
        assert 1 <= len(log.statements) <= 1 + len(ids), log.statements
    assert len(large[("holders",)].statements) == len(small[("holders",)].statements)


def test_each_holders_query_fetches_at_most_one_row(engine, client, session_factory):
    small, large = _at_two_sizes(engine, client, session_factory, _holders(HOLDER_IDS))

    for log in (small[("holders",)], large[("holders",)]):
        assert max(log.rows, default=0) <= 1, list(zip(log.statements, log.rows, strict=True))


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_each_list_is_at_most_3_queries_for_any_page_at_both_sizes(
    engine, client, session_factory, record_id
):
    small, large = _at_two_sizes(engine, client, session_factory, _lists(record_id))

    for limit, offset in PAGES:
        key = (record_id, limit, offset)
        assert 1 <= len(small[key].statements) <= LIST_MAX_QUERIES, (key, small[key].statements)
        assert 1 <= len(large[key].statements) <= LIST_MAX_QUERIES, (key, large[key].statements)
        assert len(large[key].statements) == len(small[key].statements), key


def test_holders_build_each_holder_statement_at_most_once(client, session_factory, monkeypatch):
    """The holder statements take no parameters and are built once per
    process, on first use (the brief's "Shape notes"): two calls for the same
    24 ids build at most 24 in all (none, if an earlier test already built
    them), and give the same answer."""
    calls = 0
    original = records._holder_statement

    def counting(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(records, "_holder_statement", counting)
    with session_factory() as session:
        build_fixture(session)
        session.commit()
    params = {"ids": ",".join(HOLDER_IDS)}
    first = client.get("/events/records/holders", params=params)
    second = client.get("/events/records/holders", params=params)

    assert first.status_code == 200, first.text
    assert first.json() == second.json()
    assert calls <= len(HOLDER_IDS), calls
