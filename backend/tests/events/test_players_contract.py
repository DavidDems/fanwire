"""EVENTS-006's contract criterion: the new player paths are in the app's
OpenAPI document, and the existing games contract is unchanged.

"Unchanged" covers GameOut, GameDetailOut (with every schema it embeds),
GET /events/games, GET /events/games/{game_id} and GET /search/games. The
app's live document is compared, on exactly those keys, with two references:

- `tests/fixtures/openapi_games_contract.json`, a frozen copy of those keys
  taken from `backend/openapi.json` before EVENTS-006. Regenerating
  `openapi.json` cannot move it, so a change to the games contract fails
  here even when the committed file is refreshed along with it.
- the committed `backend/openapi.json`.

File equality between the committed document and the app is the
openapi-drift job's (tests/test_export_openapi.py), not repeated here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.main import app

BACKEND_ROOT = Path(__file__).resolve().parents[2]
COMMITTED = BACKEND_ROOT / "openapi.json"
FROZEN = BACKEND_ROOT / "tests" / "fixtures" / "openapi_games_contract.json"

UNCHANGED_PATHS = ("/events/games", "/events/games/{game_id}", "/search/games")
UNCHANGED_SCHEMAS = ("GameOut", "GameDetailOut")
# FastAPI's own validation-error schemas are referenced by every route's 422;
# they are the framework's, not this contract's.
FRAMEWORK_SCHEMAS = frozenset({"HTTPValidationError", "ValidationError"})

NEW_PATHS = (
    "/events/players",
    "/events/players/{player_id}",
    "/events/players/{player_id}/games",
)


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


def games_contract(document: dict[str, Any]) -> dict[str, Any]:
    """The unchanged paths and schemas, with every schema they reach."""
    paths = {path: document["paths"].get(path) for path in UNCHANGED_PATHS}
    all_schemas = document["components"]["schemas"]
    wanted = set(UNCHANGED_SCHEMAS) | _refs(paths)
    seen: set[str] = set()
    while wanted - seen:
        name = (wanted - seen).pop()
        seen.add(name)
        wanted |= _refs(all_schemas.get(name))
    schemas = {name: all_schemas.get(name) for name in sorted(seen - FRAMEWORK_SCHEMAS)}
    return {"paths": paths, "schemas": schemas}


@pytest.fixture(scope="module")
def live() -> dict[str, Any]:
    return app.openapi()


def test_the_new_player_paths_are_in_the_openapi_document(live):
    missing = [path for path in NEW_PATHS if "get" not in live["paths"].get(path, {})]

    assert missing == []


def test_the_games_contract_matches_its_frozen_copy(live):
    frozen = json.loads(FROZEN.read_text(encoding="utf-8"))

    assert games_contract(live) == frozen


def test_the_games_contract_matches_the_committed_openapi_json(live):
    committed = json.loads(COMMITTED.read_text(encoding="utf-8"))

    assert games_contract(live) == games_contract(committed)
