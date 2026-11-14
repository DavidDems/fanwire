"""EVENTS-014's contract: GET /events/seasons/{season}/schedule is in the
OpenAPI document, public, documents its 422 and 404, and answers
ScheduleOut ({season, games: [ScheduleGameOut]}); every existing events
path and schema is unchanged, in the app and in the committed openapi.json.

`tests/fixtures/openapi_events_schedule_contract.json` is a frozen copy of
every /events/* path in backend/openapi.json before EVENTS-014, with every
schema they reach (test_seasons_contract.events_contract), so regenerating
openapi.json cannot move it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import routing
from fastapi.routing import APIRoute

from app.main import app
from app.users import dependencies as user_dependencies
from tests.events.test_seasons_contract import _refs, events_contract

BACKEND_ROOT = Path(__file__).resolve().parents[2]
COMMITTED = BACKEND_ROOT / "openapi.json"
FROZEN = BACKEND_ROOT / "tests" / "fixtures" / "openapi_events_schedule_contract.json"
SCHEDULE = "/events/seasons/{season}/schedule"
ITEM_FIELDS = {
    "nba_game_id",
    "status",
    "game_id",
    "date",
    "time_tbd",
    "game_type",
    "label",
    "sub_label",
    "series_game_number",
    "venue",
    "home_team",
    "away_team",
    "home_score",
    "away_score",
}


@pytest.fixture(scope="module")
def live() -> dict[str, Any]:
    return app.openapi()


@pytest.fixture(scope="module")
def committed() -> dict[str, Any]:
    return json.loads(COMMITTED.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def frozen() -> dict[str, Any]:
    return json.loads(FROZEN.read_text(encoding="utf-8"))


def _operation(document: dict[str, Any]) -> dict[str, Any]:
    return document["paths"].get(SCHEDULE, {}).get("get", {})


def _resolve(schema: dict[str, Any], document: dict[str, Any]) -> dict[str, Any]:
    if "$ref" in schema:
        return document["components"]["schemas"][schema["$ref"].rsplit("/", 1)[1]]
    return schema


# --------------------------------------------------------------------- existing


def test_the_frozen_copy_holds_every_events_path_before_events_014(frozen):
    assert SCHEDULE not in frozen["paths"]
    assert "/events/seasons/{season}/standings" in frozen["paths"]
    assert "/events/records/{record_id}" in frozen["paths"]
    assert len(frozen["paths"]) == 17


def test_every_existing_events_route_and_schema_is_unchanged_in_the_app(live, frozen):
    assert events_contract(live, list(frozen["paths"])) == frozen


def test_every_existing_events_route_and_schema_is_unchanged_in_openapi_json(committed, frozen):
    assert events_contract(committed, list(frozen["paths"])) == frozen


@pytest.mark.parametrize("which", ["live", "committed"])
def test_the_only_new_events_path_is_the_schedule(request, frozen, which):
    document = request.getfixturevalue(which)
    events = {path for path in document["paths"] if path.startswith("/events")}

    assert events - set(frozen["paths"]) == {SCHEDULE}


@pytest.mark.parametrize("which", ["live", "committed"])
def test_the_schedules_new_schemas_are_its_own(request, frozen, which):
    """Every schema the new route reaches is either an existing one,
    unchanged (TeamRefOut), or one of its own."""
    document = request.getfixturevalue(which)
    reached = events_contract(document, [SCHEDULE])["schemas"]

    assert {"ScheduleOut", "ScheduleGameOut"} <= set(reached), sorted(reached)
    for name, schema in reached.items():
        if name in frozen["schemas"]:
            assert schema == frozen["schemas"][name], name


# --------------------------------------------------------------------- the new route


@pytest.mark.parametrize("which", ["live", "committed"])
def test_the_schedule_route_answers_schedule_out(request, which):
    document = request.getfixturevalue(which)
    operation = _operation(document)
    assert operation, f"GET {SCHEDULE} is not in the {which} document"

    schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert schema == {"$ref": "#/components/schemas/ScheduleOut"}
    out = document["components"]["schemas"]["ScheduleOut"]
    assert set(out["properties"]) == {"season", "games"}
    assert out["properties"]["games"]["items"] == {"$ref": "#/components/schemas/ScheduleGameOut"}


@pytest.mark.parametrize("which", ["live", "committed"])
def test_a_schedule_item_carries_the_spec_fields(request, which):
    document = request.getfixturevalue(which)
    item = document["components"]["schemas"].get("ScheduleGameOut", {})
    properties = item.get("properties", {})

    assert ITEM_FIELDS <= set(properties), sorted(ITEM_FIELDS - set(properties))
    # The teams are TeamRefOut, or null when not decided.
    for side in ("home_team", "away_team"):
        options = properties[side].get("anyOf", [])
        assert {"$ref": "#/components/schemas/TeamRefOut"} in options, properties[side]
        assert {"type": "null"} in options, properties[side]
    assert "TeamRefOut" in _refs(item)


@pytest.mark.parametrize("which", ["live", "committed"])
def test_the_schedule_route_takes_the_three_filters(request, which):
    operation = _operation(request.getfixturevalue(which))
    query = sorted(p["name"] for p in operation.get("parameters", []) if p["in"] == "query")

    assert query == ["date_from", "date_to", "team_id"]


@pytest.mark.parametrize("which", ["live", "committed"])
def test_the_schedule_route_documents_its_422_and_404(request, which):
    operation = _operation(request.getfixturevalue(which))
    text = operation.get("description", "") + operation.get("summary", "")

    assert "422" in text, operation
    assert "404" in text, operation


def _api_routes() -> list:
    iter_route_contexts = getattr(routing, "iter_route_contexts", None)
    if iter_route_contexts is None:
        return [route for route in app.routes if isinstance(route, APIRoute)]
    return [
        context
        for context in iter_route_contexts(app.routes)
        if isinstance(context.original_route, APIRoute)
    ]


def _dependency_calls(dependant) -> list:
    calls = []
    for sub in dependant.dependencies:
        if sub.call is not None:
            calls.append(sub.call)
        calls.extend(_dependency_calls(sub))
    return calls


def test_the_schedule_route_is_public():
    found = [r for r in _api_routes() if r.path == SCHEDULE and "GET" in r.methods]
    assert len(found) == 1, f"GET {SCHEDULE} is not registered on app.main's app exactly once"

    offenders = [
        getattr(call, "__qualname__", repr(call))
        for call in _dependency_calls(found[0].dependant)
        if call is user_dependencies.get_current_user
        or call is user_dependencies.get_optional_current_user
        or getattr(call, "__module__", "").startswith("app.users")
    ]
    assert offenders == []
