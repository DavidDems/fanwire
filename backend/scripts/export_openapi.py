"""Write the FastAPI app's OpenAPI document to `backend/openapi.json`.

That file is the committed frontend/backend contract: `frontend`'s typed
client is generated from it (`npm run gen:api-types`), so a backend route
change that does not refresh it silently builds the client from a stale
schema. `tests/test_export_openapi.py` compares the committed file to a
fresh export and fails on any difference.

That gate is only worth having if the export is byte-deterministic. Python
dict iteration order is insertion order, but the *sets* FastAPI builds
internally (enum members, `required` lists, union members) are not, and
their order varies with the process hash seed. `sort_keys=True` removes the
key-order half of that problem entirely, which is the half that actually
moves; two-space indentation and a single trailing newline keep the diff
readable and the file POSIX-clean.

Usage (from `backend/`):

    python scripts/export_openapi.py

Writes the file in place and prints where it went. Import side effects are
limited to importing `app.main` — no database connection, no AWS call, no
`Settings()` construction (that happens inside request dependencies only),
so this runs with nothing configured.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = BACKEND_ROOT / "openapi.json"

# The script lives in `backend/scripts/`, so Python puts *that* directory on
# sys.path, not `backend/` — `import app` has to be made possible explicitly
# rather than depending on the caller's working directory or PYTHONPATH. The
# import below therefore cannot move above this block.
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.main import app


def render(document: dict[str, Any]) -> str:
    """Serialise `document` the one way this repo commits it.

    `sort_keys=True` is the determinism guarantee, not a formatting
    preference: it is what makes "regenerate and diff" a real CI gate
    instead of a coin flip. `ensure_ascii=True` (the default) keeps the
    bytes identical regardless of the writing platform's locale.
    """
    return json.dumps(document, indent=2, sort_keys=True) + "\n"


def export(output_path: Path = OUTPUT_PATH) -> Path:
    """Write the app's OpenAPI document to `output_path` and return it."""
    # newline="\n" explicitly: the default would translate to CRLF on
    # Windows and produce a file that differs, byte for byte, from the one
    # CI exports on Linux.
    output_path.write_text(render(app.openapi()), encoding="utf-8", newline="\n")
    return output_path


def main() -> None:
    print(f"wrote {export()}")


if __name__ == "__main__":
    main()
