"""Pins the OpenAPI export gate (FRONTEND-001 acceptance criteria 1 and 2).

`backend/openapi.json` is the committed frontend/backend contract:
`frontend` generates its typed client from it (`npm run gen:api-types`), so a
backend route change that does not refresh the file silently breaks the client.
The gate that prevents that is only as good as its determinism -- if
`app.openapi()` serialises in a different order run to run, CI fails on a diff
that means nothing, and the gate gets switched off.

Two things are pinned here:

1. Running `backend/scripts/export_openapi.py` writes `backend/openapi.json`
   with sorted keys, two-space indentation and a trailing newline, and a second
   run produces a byte-identical file. The two runs are separate processes with
   *different* `PYTHONHASHSEED` values, because that is the actual failure mode:
   a dict whose iteration order depends on the process's hash seed looks stable
   inside one interpreter and is a coin flip across CI runs.

2. The committed file matches a freshly exported one, and the failure message
   says which of the two situations occurred -- the file is missing, or it has
   drifted -- and, when it has drifted, which routes and schemas moved. That
   message is the whole user interface of this gate: it is what a maintainer
   reads months from now when an unrelated route change turns this red.

The comparison is deliberately *committed file vs. fresh export*, not export
vs. export. An export compared to itself is always equal and pins nothing.

Note on the side effect: the export script writes `backend/openapi.json` in
place, which is the behaviour criterion 1 describes, so these tests run it for
real and the `committed_openapi` fixture restores the file's original bytes
(or removes it, if it did not exist) afterwards.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = BACKEND_ROOT / "scripts" / "export_openapi.py"
COMMITTED = BACKEND_ROOT / "openapi.json"

REGENERATE_HINT = "regenerate it with: cd backend && python scripts/export_openapi.py"

MISSING_MESSAGE = (
    f"{COMMITTED} does not exist. The committed OpenAPI document is the "
    f"frontend/backend contract and it is missing entirely, which is a "
    f"different situation from drift: nothing has changed, the file was never "
    f"written (or was deleted). Create it -- " + REGENERATE_HINT
)


def _run_export(hash_seed: str) -> None:
    """Run the export script in its own process, and fail loudly if it cannot run."""
    if not SCRIPT.exists():
        pytest.fail(f"{SCRIPT} does not exist yet -- FRONTEND-001 has to create it.")
    env = dict(os.environ, PYTHONHASHSEED=hash_seed)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    if proc.returncode != 0:
        pytest.fail(
            f"export_openapi.py exited {proc.returncode} "
            f"(PYTHONHASHSEED={hash_seed}).\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )


def _unsorted_objects(raw: str) -> list[tuple[str, ...]]:
    """Every JSON object in `raw` whose keys are not in sorted order."""
    found: list[tuple[str, ...]] = []

    def hook(pairs: list[tuple[str, object]]) -> dict[str, object]:
        keys = [key for key, _ in pairs]
        if keys != sorted(keys):
            found.append(tuple(keys))
        return dict(pairs)

    json.loads(raw, object_pairs_hook=hook)
    return found


def _names(document: object, *path: str) -> set[str]:
    node: object = document
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return set()
        node = node[key]
    return set(node) if isinstance(node, dict) else set()


def _summarise(label: str, added: set[str], removed: set[str], changed: set[str]) -> list[str]:
    lines: list[str] = []
    for verb, names in (("added", added), ("removed", removed), ("changed", changed)):
        if names:
            lines.append(f"  {label} {verb}: {', '.join(sorted(names))}")
    return lines


def drift_message(committed: bytes, fresh: bytes) -> str:
    """Explain *what* drifted, not just that something did.

    Named routes and schemas are what a maintainer can act on: they say whether
    the committed file is stale (a route was added and the export was not
    re-run) or whether something unexpected changed.
    """
    lines = [
        (
            f"{COMMITTED} has drifted from a freshly exported document. "
            "The file exists but no longer matches app.openapi(), so the "
            "generated TypeScript client is built from a stale contract."
        )
    ]
    try:
        old = json.loads(committed.decode("utf-8"))
        new = json.loads(fresh.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        old = new = None
    if not isinstance(old, dict) or not isinstance(new, dict):
        lines.append("  (the committed file is not a valid JSON object -- no per-route diff)")
        lines.append(REGENERATE_HINT)
        return "\n".join(lines)

    for label, keys in (("route", ("paths",)), ("schema", ("components", "schemas"))):
        before, after = _names(old, *keys), _names(new, *keys)
        changed = {name for name in before & after if _at(old, keys, name) != _at(new, keys, name)}
        lines += _summarise(label, after - before, before - after, changed)

    top = {k for k in set(old) | set(new) if old.get(k) != new.get(k)} - {"paths", "components"}
    if top:
        lines.append(f"  top-level keys changed: {', '.join(sorted(top))}")
    if len(lines) == 1:
        lines.append(
            "  no structural difference -- the formatting itself differs (byte-level diff)"
        )
    lines.append(REGENERATE_HINT)
    return "\n".join(lines)


def _at(document: dict, keys: tuple[str, ...], name: str) -> object:
    node: object = document
    for key in keys:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node.get(name) if isinstance(node, dict) else None


@pytest.fixture
def committed_openapi():
    """Yield the committed bytes (or None), and put the file back afterwards.

    These tests run the real export script, which writes the real file. The
    fixture makes that a no-op from the working tree's point of view.
    """
    original = COMMITTED.read_bytes() if COMMITTED.exists() else None
    try:
        yield original
    finally:
        if original is None:
            COMMITTED.unlink(missing_ok=True)
        else:
            COMMITTED.write_bytes(original)


def test_export_writes_backend_openapi_json_identically_on_a_second_run(committed_openapi):
    _run_export(hash_seed="0")
    assert COMMITTED.exists(), f"export_openapi.py ran but did not write {COMMITTED}"
    first = COMMITTED.read_bytes()

    _run_export(hash_seed="1")
    second = COMMITTED.read_bytes()

    assert first == second, (
        "export_openapi.py is not deterministic: two runs with different "
        "PYTHONHASHSEED values produced different bytes. A gate that compares "
        "the committed file to a fresh export is worthless if the export "
        "itself varies -- serialise with sort_keys=True."
    )


def test_exported_document_is_sorted_two_space_indented_and_newline_terminated(committed_openapi):
    _run_export(hash_seed="0")
    raw = COMMITTED.read_text(encoding="utf-8")

    assert raw.endswith("\n"), "the exported file must end with exactly one trailing newline"
    assert not raw.endswith("\n\n"), "the exported file must end with exactly one trailing newline"

    lines = raw.splitlines()
    assert lines[0] == "{", "the document must be a pretty-printed JSON object"
    assert lines[1].startswith('  "'), f"expected two-space indentation, got {lines[1]!r}"
    assert not lines[1].startswith("   "), f"expected two-space indentation, got {lines[1]!r}"

    unsorted = _unsorted_objects(raw)
    assert not unsorted, (
        f"{len(unsorted)} JSON object(s) have unsorted keys, e.g. {unsorted[0][:6]} "
        "-- export with sort_keys=True or the gate is a coin flip"
    )


def test_committed_openapi_json_matches_a_fresh_export(committed_openapi):
    assert committed_openapi is not None, MISSING_MESSAGE

    _run_export(hash_seed="0")
    fresh = COMMITTED.read_bytes()

    assert fresh == committed_openapi, drift_message(committed_openapi, fresh)


def test_drift_message_names_the_routes_and_schemas_that_moved():
    old = json.dumps(
        {
            "openapi": "3.1.0",
            "paths": {"/health": {"get": {}}, "/users/me": {"get": {}}},
            "components": {"schemas": {"MeOut": {"type": "object"}}},
        }
    ).encode()
    new = json.dumps(
        {
            "openapi": "3.1.0",
            "paths": {"/health": {"get": {}}, "/posts": {"post": {}}},
            "components": {"schemas": {"MeOut": {"type": "string"}, "PostOut": {}}},
        }
    ).encode()

    message = drift_message(old, new)

    assert "/posts" in message, "an added route must be named"
    assert "/users/me" in message, "a removed route must be named"
    assert "PostOut" in message, "an added schema must be named"
    assert "MeOut" in message, "a changed schema must be named"
    assert "export_openapi.py" in message, "the message must say how to fix it"


def test_missing_file_and_drift_are_reported_as_different_situations():
    drift = drift_message(b'{"paths": {}}', b'{"paths": {"/posts": {}}}')

    assert "does not exist" in MISSING_MESSAGE
    assert "drift" in drift.lower()
    assert "does not exist" not in drift
    assert MISSING_MESSAGE != drift
