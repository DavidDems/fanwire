"""EVENTS-010's contract: the records routes are in the app's OpenAPI
document, the list route's docstring names its 404 and 422, and no route
reads the caller.

EVENTS-012 adds GET /events/records/holders and pins, here: it is declared
before /events/records/{record_id} (or "holders" would be read as a record
id), it answers `Cache-Control: public, max-age=300`, and it reads no user
dependency, header or cookie. It takes `ids` and nothing else; the catalog's
records carry exactly id, group, category, title, unit, rule, value_kind,
keywords and featured_rank (no holder).

The CloudFront behaviour for `/api/events/records*` keeps Authorization out
of the cache key (infra/test/cdn-stack.test.ts). That is only safe while the
records routes never resolve a user, so this pins that no dependency from
app.users (get_current_user, get_current_identity, get_own_account,
get_optional_current_user, the token verifier) is anywhere in either
route's dependency tree. The walk is the one test_route_auth.py uses.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import routing
from fastapi.routing import APIRoute

from app.db import Base, make_session_factory
from app.main import app
from app.users import dependencies as user_dependencies
from tests.events.players_support import make_client, make_players_engine

SUMMARY = "/events/records"
HOLDERS = "/events/records/holders"
DETAIL = "/events/records/{record_id}"
CATALOG_FIELDS = {
    "id",
    "group",
    "category",
    "title",
    "unit",
    "rule",
    "value_kind",
    "keywords",
    "featured_rank",
}


@pytest.fixture(scope="module")
def live() -> dict[str, Any]:
    return app.openapi()


def _api_routes() -> list:
    iter_route_contexts = getattr(routing, "iter_route_contexts", None)
    if iter_route_contexts is None:
        return [route for route in app.routes if isinstance(route, APIRoute)]
    return [
        context
        for context in iter_route_contexts(app.routes)
        if isinstance(context.original_route, APIRoute)
    ]


def _route(path: str):
    found = [route for route in _api_routes() if route.path == path and "GET" in route.methods]
    assert len(found) == 1, f"GET {path} is not registered on app.main's app exactly once"
    return found[0]


def _dependency_calls(dependant) -> list:
    calls = []
    for sub in dependant.dependencies:
        if sub.call is not None:
            calls.append(sub.call)
        calls.extend(_dependency_calls(sub))
    return calls


def test_the_records_paths_are_in_the_openapi_document(live):
    missing = [
        path for path in (SUMMARY, HOLDERS, DETAIL) if "get" not in live["paths"].get(path, {})
    ]

    assert missing == []


def test_the_list_route_documents_its_404_and_422(live):
    operation = live["paths"].get(DETAIL, {}).get("get", {})
    text = operation.get("description", "") + operation.get("summary", "")

    assert "404" in text, operation
    assert "422" in text, operation


def test_the_list_route_takes_limit_and_offset_and_nothing_else(live):
    operation = live["paths"].get(DETAIL, {}).get("get", {})
    query = sorted(p["name"] for p in operation.get("parameters", []) if p["in"] == "query")

    assert query == ["limit", "offset"]


@pytest.mark.parametrize("path", [SUMMARY, HOLDERS, DETAIL])
def test_no_records_route_reads_the_caller(path):
    route = _route(path)
    calls = _dependency_calls(route.dependant)
    forbidden = {
        user_dependencies.get_current_user,
        user_dependencies.get_current_identity,
        user_dependencies.get_own_account,
        user_dependencies.get_optional_current_user,
        user_dependencies.get_token_verifier,
    }

    offenders = [
        getattr(call, "__qualname__", repr(call))
        for call in calls
        if call in forbidden or getattr(call, "__module__", "").startswith("app.users")
    ]
    assert offenders == [], f"{path} depends on the caller: {offenders}"


@pytest.mark.parametrize("path", [SUMMARY, HOLDERS, DETAIL])
def test_no_records_route_takes_a_header_or_cookie(path):
    route = _route(path)

    def params(dependant) -> list:
        found = list(dependant.header_params) + list(dependant.cookie_params)
        for sub in dependant.dependencies:
            found.extend(params(sub))
        return found

    assert [param.name for param in params(route.dependant)] == []


# ------------------------------------------------------------ EVENTS-012


def _resolve(schema: dict, live: dict) -> dict:
    if "$ref" in schema:
        return live["components"]["schemas"][schema["$ref"].rsplit("/", 1)[-1]]
    return schema


def _ok_schema(live: dict, path: str) -> dict:
    operation = live["paths"][path]["get"]
    return _resolve(operation["responses"]["200"]["content"]["application/json"]["schema"], live)


def test_the_holders_route_is_declared_before_the_list_route():
    paths = [route.path for route in _api_routes() if "GET" in route.methods]

    assert HOLDERS in paths and DETAIL in paths, paths
    assert paths.index(HOLDERS) < paths.index(DETAIL)


def test_the_holders_route_takes_ids_and_nothing_else(live):
    operation = live["paths"].get(HOLDERS, {}).get("get", {})
    query = [p for p in operation.get("parameters", []) if p["in"] == "query"]

    assert [p["name"] for p in query] == ["ids"]
    assert [p["name"] for p in operation.get("parameters", []) if p["in"] != "query"] == []


def test_the_holders_route_documents_its_422(live):
    operation = live["paths"].get(HOLDERS, {}).get("get", {})

    assert "422" in operation.get("description", "") + operation.get("summary", "")


def test_the_holders_answer_is_a_map_of_holders(live):
    body = _ok_schema(live, HOLDERS)

    assert set(body["properties"]) == {"holders"}
    holders = body["properties"]["holders"]
    assert holders.get("type") == "object", holders
    assert "additionalProperties" in holders, holders


def test_the_catalog_records_carry_exactly_the_catalog_fields(live):
    body = _ok_schema(live, SUMMARY)
    assert {"since_season", "through_season", "records"} <= set(body["properties"])

    record = _resolve(body["properties"]["records"]["items"], live)

    assert set(record["properties"]) == CATALOG_FIELDS
    assert CATALOG_FIELDS <= set(record.get("required", []))


@pytest.fixture()
def client(postgres_url):
    engine = make_players_engine(postgres_url)
    yield make_client(make_session_factory(engine))
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_the_holders_route_is_cacheable_for_five_minutes(client):
    response = client.get(HOLDERS, params={"ids": "team-championships,player-points-game"})

    assert response.status_code == 200, response.text
    assert response.headers.get("cache-control") == "public, max-age=300"
    vary = response.headers.get("vary", "").lower()
    assert "authorization" not in vary and "cookie" not in vary


def test_an_unknown_id_on_the_list_route_is_still_a_404(client):
    assert client.get("/events/records/no-such-record").status_code == 404
    assert client.get("/events/records/team-championships").status_code == 200
