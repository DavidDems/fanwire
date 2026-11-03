"""EVENTS-012: GET /events/records is the catalog, GET /events/records/holders
the holders of up to 24 records. Spec: .ai/tasks/EVENTS-012/ (criteria 6-8).

Pinned:

- The catalog: `{since_season, through_season, records}`, one record per
  registry entry in the registry's order, each `{id, group, category, title,
  unit, rule, value_kind, keywords, featured_rank}` as the registry holds it,
  and no holder.
- Holders: `ids` is a comma-separated list of 1 to 24 distinct known ids, in
  any order; the answer is `{holders: {id: holder or null}}` with exactly the
  asked ids as keys. None, an empty list, more than 24, a duplicate or an
  unknown id is a 422.
"""

from __future__ import annotations

import pytest

from app.db import Base, make_session_factory
from app.events.records import RECORDS
from tests.events.players_support import make_client, make_players_engine
from tests.events.records_library import FEATURED, HOLDERS_CAP, LIBRARY_IDS
from tests.events.records_support import RECORD_IDS, build_fixture, expected_records, normalize

HOLDERS = "/events/records/holders"
CATALOG_FIELDS = (
    "id",
    "group",
    "category",
    "title",
    "unit",
    "rule",
    "value_kind",
    "keywords",
    "featured_rank",
)
TWENTY_FOUR: tuple[str, ...] = (
    FEATURED + tuple(i for i in LIBRARY_IDS if i not in FEATURED)[: HOLDERS_CAP - len(FEATURED)]
)
TWENTY_FIVE: tuple[str, ...] = (
    TWENTY_FOUR + tuple(i for i in LIBRARY_IDS if i not in TWENTY_FOUR)[:1]
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


def _holders(client, ids: str):
    return client.get(HOLDERS, params={"ids": ids})


# ------------------------------------------------------------------ catalog


def test_the_catalog_is_the_registry_field_for_field(client, fixture):
    response = client.get("/events/records")
    assert response.status_code == 200, response.text
    body = response.json()

    assert [r["id"] for r in body["records"]] == [r.id for r in RECORDS]
    for got, record in zip(body["records"], RECORDS, strict=True):
        assert set(got) == set(CATALOG_FIELDS), got
        for field in CATALOG_FIELDS:
            expected = getattr(record, field)
            if field == "keywords":
                expected = list(expected)
            assert got[field] == expected, (record.id, field)


def test_the_catalog_has_the_sixteen_featured_ranks(client, fixture):
    body = client.get("/events/records").json()

    featured = {r["id"]: r["featured_rank"] for r in body["records"] if r["featured_rank"]}
    assert sorted(featured, key=featured.__getitem__) == list(FEATURED)


# ------------------------------------------------------------------ holders


def test_24_ids_with_the_featured_sixteen_answer_one_holder_each(client, fixture):
    assert len(set(TWENTY_FOUR)) == HOLDERS_CAP and set(FEATURED) <= set(TWENTY_FOUR)

    response = _holders(client, ",".join(TWENTY_FOUR))

    assert response.status_code == 200, response.text
    holders = response.json()["holders"]
    assert sorted(holders) == sorted(TWENTY_FOUR)


def test_holders_answer_the_same_whatever_the_order_of_ids(client, fixture):
    ids = sorted(RECORD_IDS)
    forward = _holders(client, ",".join(ids)).json()
    backward = _holders(client, ",".join(reversed(ids))).json()

    assert forward == backward


def test_the_twelve_holders_are_the_derived_first_entries(client, fixture):
    expected = expected_records(fixture)

    holders = _holders(client, ",".join(RECORD_IDS)).json()["holders"]

    for record_id in RECORD_IDS:
        assert normalize(holders[record_id]) == expected[record_id].entries[0], record_id
        assert holders[record_id]["tied_count"] == expected[record_id].tied_count


def test_a_record_nothing_qualifies_for_has_a_null_holder(client):
    response = _holders(client, "team-championships,player-points-game")

    assert response.status_code == 200, response.text
    assert response.json() == {"holders": {"team-championships": None, "player-points-game": None}}


@pytest.mark.parametrize(
    "params",
    [
        pytest.param({}, id="no ids"),
        pytest.param({"ids": ""}, id="empty"),
        pytest.param({"ids": ",".join(TWENTY_FIVE)}, id="25 ids"),
        pytest.param({"ids": "team-championships,team-championships"}, id="duplicate"),
        pytest.param({"ids": "team-championships,team-most-fouls"}, id="unknown"),
        pytest.param({"ids": "team-most-fouls"}, id="unknown alone"),
    ],
)
def test_bad_ids_are_a_422(client, params):
    response = client.get(HOLDERS, params=params)

    assert response.status_code == 422, response.text


def test_the_cap_itself_and_one_id_are_accepted(client):
    assert _holders(client, ",".join(TWENTY_FOUR)).status_code == 200
    assert _holders(client, "team-largest-win").status_code == 200


def test_holders_is_not_read_as_a_record_id(client):
    """Declared before /events/records/{record_id}: never that route's 404."""
    response = _holders(client, "team-largest-win")

    assert response.status_code == 200, response.text
    assert "holders" in response.json()
