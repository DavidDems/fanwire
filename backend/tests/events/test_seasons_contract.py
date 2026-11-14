"""EVENTS-007's contract criterion: the new season paths are in the app's
OpenAPI document, their docstrings say which errors are a 422 and which a
404, and every existing events route and schema is unchanged.

"Unchanged" covers every /events/* path in `backend/openapi.json` before
EVENTS-007 (teams, games, players) and every schema they reach.
`tests/fixtures/openapi_events_contract.json` is a frozen copy of those
keys, so regenerating `openapi.json` cannot move it. GET /search/games is
pinned by test_players_contract.py's games fixture, not repeated here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.main import app

BACKEND_ROOT = Path(__file__).resolve().parents[2]
COMMITTED = BACKEND_ROOT / "openapi.json"
FROZEN = BACKEND_ROOT / "tests" / "fixtures" / "openapi_events_contract.json"

# FastAPI's own validation-error schemas are referenced by every route's 422.
FRAMEWORK_SCHEMAS = frozenset({"HTTPValidationError", "ValidationError"})

NEW_PATHS = (
    "/events/seasons",
    "/events/seasons/{season}/standings",
    "/events/seasons/{season}/champion",
    "/events/seasons/{season}/leaders",
    "/events/teams/{team_id}/seasons/{season}",
)
# Routes taking a season: their documentation says what is a 422 and a 404.
DOCUMENTED_ERRORS = NEW_PATHS[1:]


def _refs(node: Any) -> set[str]:
    """Names of every `#/components/schemas/<name>` reference under node."""
    found: set[str] = set()
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            found.add(ref.rsplit("/", 1)[1])
        for value in node.values():
            found |= _refs(value)
    elif isinstance(node, list):
        for value in node:
            found |= _refs(value)
    return found


def events_contract(document: dict[str, Any], paths: list[str]) -> dict[str, Any]:
    """`paths` of the document, with every schema they reach."""
    chosen = {path: document["paths"].get(path) for path in paths}
    all_schemas = document["components"]["schemas"]
    wanted = _refs(chosen)
    seen: set[str] = set()
    while wanted - seen:
        name = (wanted - seen).pop()
        seen.add(name)
        wanted |= _refs(all_schemas.get(name))
    schemas = {name: all_schemas.get(name) for name in sorted(seen - FRAMEWORK_SCHEMAS)}
    return {"paths": chosen, "schemas": schemas}


@pytest.fixture(scope="module")
def live() -> dict[str, Any]:
    return app.openapi()


@pytest.fixture(scope="module")
def frozen() -> dict[str, Any]:
    return json.loads(FROZEN.read_text(encoding="utf-8"))


def test_the_new_season_paths_are_in_the_openapi_document(live):
    missing = [path for path in NEW_PATHS if "get" not in live["paths"].get(path, {})]

    assert missing == []


@pytest.mark.parametrize("path", DOCUMENTED_ERRORS)
def test_each_season_route_documents_its_422_and_404(live, path):
    operation = live["paths"].get(path, {}).get("get", {})
    text = operation.get("description", "") + operation.get("summary", "")

    assert "422" in text, operation
    assert "404" in text, operation


def test_the_frozen_copy_holds_every_existing_events_path(frozen):
    assert sorted(frozen["paths"]) == [
        "/events/games",
        "/events/games/{game_id}",
        "/events/players",
        "/events/players/{player_id}",
        "/events/players/{player_id}/games",
        "/events/teams",
        "/events/teams/{team_id}",
    ]


def test_every_existing_events_route_and_schema_is_unchanged(live, frozen):
    assert events_contract(live, list(frozen["paths"])) == frozen


def test_the_committed_openapi_json_keeps_them_unchanged(frozen):
    committed = json.loads(COMMITTED.read_text(encoding="utf-8"))

    assert events_contract(committed, list(frozen["paths"])) == frozen
