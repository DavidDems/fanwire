"""EVENTS-010's contract: both records routes are in the app's OpenAPI
document, the list route's docstring names its 404 and 422, and neither
route reads the caller.

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

from app.main import app
from app.users import dependencies as user_dependencies

SUMMARY = "/events/records"
DETAIL = "/events/records/{record_id}"


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


def test_both_records_paths_are_in_the_openapi_document(live):
    missing = [path for path in (SUMMARY, DETAIL) if "get" not in live["paths"].get(path, {})]

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


@pytest.mark.parametrize("path", [SUMMARY, DETAIL])
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


@pytest.mark.parametrize("path", [SUMMARY, DETAIL])
def test_no_records_route_takes_a_header_or_cookie(path):
    route = _route(path)

    def params(dependant) -> list:
        found = list(dependant.header_params) + list(dependant.cookie_params)
        for sub in dependant.dependencies:
            found.extend(params(sub))
        return found

    assert [param.name for param in params(route.dependant)] == []
