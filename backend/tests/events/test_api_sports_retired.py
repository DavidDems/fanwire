"""EVENTS-003: the API-SPORTS path is gone from backend/app, per AGENTS.md TDD
workflow. Written before the removal.

A static sweep, not a behaviour test: no module under backend/app may define
or import the adapter, the provider factory, the data-source interface, the
ingestion pipeline, the live-score proxy or its caches, or the dependency
that built the proxy; and the modules that held them no longer exist.
`UnrecognizedTeamError` survives in app.events.errors, because
app.events.nba_history still raises it (its behaviour is pinned in
test_nba_history.py).
"""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

import pytest

_APP_DIR = Path(__file__).resolve().parents[2] / "app"

_RETIRED_NAMES = (
    "ApiSportsAdapter",
    "SportsProviderFactory",
    "SportsDataSource",
    "AbstractEventIngestionPipeline",
    "FinalScoreIngestion",
    "CachedEventProxy",
    "LiveScoreCache",
    "InMemoryLiveScoreCache",
    "DynamoDbLiveScoreCache",
    "get_live_score_proxy",
    "resolve_api_sports_key",
)

_RETIRED_MODULES = ("adapters", "factory", "interfaces", "proxy", "lambda_handler")


def _app_python_files() -> list[Path]:
    files = sorted(_APP_DIR.rglob("*.py"))
    assert files, f"no python files under {_APP_DIR} -- path problem, not a pass"
    return files


def _offences(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name in _RETIRED_NAMES:
                found.append(f"defines {node.name} (line {node.lineno})")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if any(module == f"app.events.{name}" for name in _RETIRED_MODULES):
                found.append(f"imports from {module} (line {node.lineno})")
            for alias in node.names:
                if alias.name in _RETIRED_NAMES:
                    found.append(f"imports {alias.name} (line {node.lineno})")
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if any(alias.name == f"app.events.{name}" for name in _RETIRED_MODULES):
                    found.append(f"imports {alias.name} (line {node.lineno})")
    return found


def test_no_app_module_defines_or_imports_the_api_sports_path():
    offences = {
        str(path.relative_to(_APP_DIR)): found
        for path in _app_python_files()
        if (found := _offences(path))
    }
    assert offences == {}


@pytest.mark.parametrize("module", _RETIRED_MODULES)
def test_retired_events_module_file_is_gone(module):
    assert not (_APP_DIR / "events" / f"{module}.py").exists()


@pytest.mark.parametrize("module", _RETIRED_MODULES)
def test_retired_events_module_is_not_importable(module):
    assert importlib.util.find_spec(f"app.events.{module}") is None


def test_events_dependencies_has_no_live_score_proxy():
    path = _APP_DIR / "events" / "dependencies.py"
    if not path.exists():
        return  # removing the module outright is also fine
    from app.events import dependencies as deps

    assert not hasattr(deps, "get_live_score_proxy")


def test_ingestion_module_is_gone():
    """EVENTS-003 kept app/events/ingestion.py as a re-export of
    UnrecognizedTeamError for backend/scripts/load_nba_history.py; EVENTS-004
    points the script at app.events.errors and removes the module."""
    assert not (_APP_DIR / "events" / "ingestion.py").exists()
    assert importlib.util.find_spec("app.events.ingestion") is None


def test_unrecognized_team_error_lives_in_app_events_errors():
    from app.events.errors import UnrecognizedTeamError

    assert issubclass(UnrecognizedTeamError, Exception)
    # Kept a ValueError, as it was in app.events.ingestion.
    assert issubclass(UnrecognizedTeamError, ValueError)
