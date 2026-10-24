"""EVENTS-010 Baseline (b) and (c): the records routes are built in a fixed
number of queries whatever the data's size, and the summary fetches at
most one row per query (the data window, then one holder per record).

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
from tests.events.records_support import (
    RECORD_IDS,
    QueryLog,
    add_copies,
    build_fixture,
    recorded_queries,
)

SUMMARY_MAX_QUERIES = 13
SUMMARY_MAX_ROWS = 13
LIST_MAX_QUERIES = 3
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


def _summary(engine, client) -> dict[tuple, QueryLog]:
    return {("summary",): _measure(engine, client, "/events/records")}


def _lists(record_id: str):
    def measure(engine, client) -> dict[tuple, QueryLog]:
        return {
            (record_id, limit, offset): _measure(
                engine, client, f"/events/records/{record_id}", limit=limit, offset=offset
            )
            for limit, offset in PAGES
        }

    return measure


def test_the_summary_is_at_most_13_queries_at_both_sizes(engine, client, session_factory):
    small, large = _at_two_sizes(engine, client, session_factory, _summary)

    for log in (small[("summary",)], large[("summary",)]):
        assert 1 <= len(log.statements) <= SUMMARY_MAX_QUERIES, log.statements
    assert len(large[("summary",)].statements) == len(small[("summary",)].statements)


def test_the_summary_fetches_at_most_one_row_per_query(engine, client, session_factory):
    small, large = _at_two_sizes(engine, client, session_factory, _summary)

    for log in (small[("summary",)], large[("summary",)]):
        assert sum(log.rows) <= SUMMARY_MAX_ROWS, list(zip(log.statements, log.rows, strict=True))


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


def test_the_summary_builds_each_holder_statement_at_most_once(session_factory, monkeypatch):
    """The holder statements take no parameters, yet building all twelve
    costs about 20 ms of Python per summary on the full load, against a
    250 ms latency ceiling the summary measures close to. Each is built once
    per process and reused: two summaries build at most len(RECORDS) in all
    (none, if an earlier test already built them), and give the same answer."""
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
        first = records.records_summary(session)
        second = records.records_summary(session)

    assert first == second
    assert calls <= len(records.RECORDS), calls
