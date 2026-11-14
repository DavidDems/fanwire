"""PERF-001: backend/scripts/perf_compare.py, per AGENTS.md TDD workflow.
Written before the script exists.

`python scripts/perf_compare.py --run RUN.json --baseline BASE.json
[--max-regression PCT]` compares a k6 handleSummary JSON with a baseline one
from the same machine. Endpoints are the `endpoint` tag values of the
`http_req_duration{endpoint:<name>}` submetrics; the untagged
`http_req_duration` and every other metric are ignored. It exits non-zero
when any endpoint's p(95) or p(99) is more than PCT percent (default 20)
slower than the baseline, or when a baseline endpoint is missing from the
run, and prints a per-endpoint table. With no baseline file it stores the
run as the baseline and exits 0. Standard library only.
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPT = _BACKEND_DIR / "scripts" / "perf_compare.py"

_BASE = {"feed": (100.0, 200.0), "game": (80.0, 160.0), "search": (120.0, 300.0)}


def _summary(endpoints: dict[str, tuple[float, float]]) -> dict:
    metrics: dict = {
        # Untagged and unrelated metrics: present in every real k6 summary,
        # never treated as endpoints.
        "http_req_duration": {
            "type": "trend",
            "values": {"avg": 50.0, "p(95)": 9999.0, "p(99)": 9999.0},
        },
        "http_req_failed": {"type": "rate", "values": {"rate": 0.0, "passes": 0, "fails": 10}},
        "iterations": {"type": "counter", "values": {"count": 10, "rate": 1.0}},
        "http_req_waiting{endpoint:feed}": {
            "type": "trend",
            "values": {"p(95)": 1.0, "p(99)": 1.0},
        },
    }
    for name, (p95, p99) in endpoints.items():
        metrics[f"http_req_duration{{endpoint:{name}}}"] = {
            "type": "trend",
            "contains": "time",
            "values": {
                "avg": p95 / 2,
                "min": 1.0,
                "med": p95 / 2,
                "max": p99 * 2,
                "p(90)": p95 * 0.9,
                "p(95)": p95,
                "p(99)": p99,
            },
            "thresholds": {"p(95)<500": {"ok": True}},
        }
    return {"root_group": {}, "options": {}, "state": {}, "metrics": metrics}


def _write(path: Path, data: dict) -> Path:
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _compare(tmp_path: Path, run: dict, baseline: dict | None, *extra: str):
    assert _SCRIPT.is_file(), f"{_SCRIPT} does not exist"
    run_path = _write(tmp_path / "run.json", run)
    baseline_path = tmp_path / "baseline.json"
    if baseline is not None:
        _write(baseline_path, baseline)
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    result = subprocess.run(
        [
            sys.executable,
            str(_SCRIPT),
            "--run",
            str(run_path),
            "--baseline",
            str(baseline_path),
            *extra,
        ],
        check=False,
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return result, baseline_path


def _with(endpoint: str, *, p95: float | None = None, p99: float | None = None) -> dict:
    endpoints = dict(_BASE)
    old95, old99 = endpoints[endpoint]
    endpoints[endpoint] = (p95 if p95 is not None else old95, p99 if p99 is not None else old99)
    return _summary(endpoints)


def test_no_baseline_stores_the_run_and_passes(tmp_path):
    run = _summary(_BASE)

    result, baseline_path = _compare(tmp_path, run, None)

    assert result.returncode == 0, result.stdout + result.stderr
    assert baseline_path.is_file()
    assert json.loads(baseline_path.read_text(encoding="utf-8")) == run


def test_an_identical_run_passes(tmp_path):
    result, _ = _compare(tmp_path, _summary(_BASE), _summary(_BASE))

    assert result.returncode == 0, result.stdout + result.stderr


def test_an_existing_baseline_is_not_overwritten(tmp_path):
    baseline = _summary(_BASE)

    _, baseline_path = _compare(tmp_path, _with("feed", p95=90.0), baseline)

    assert json.loads(baseline_path.read_text(encoding="utf-8")) == baseline


def test_p95_25_percent_slower_fails_at_the_default(tmp_path):
    result, _ = _compare(tmp_path, _with("feed", p95=125.0), _summary(_BASE))

    assert result.returncode == 1


def test_p95_15_percent_slower_passes_at_the_default(tmp_path):
    result, _ = _compare(tmp_path, _with("feed", p95=115.0), _summary(_BASE))

    assert result.returncode == 0, result.stdout + result.stderr


def test_p99_25_percent_slower_fails_at_the_default(tmp_path):
    result, _ = _compare(tmp_path, _with("search", p99=375.0), _summary(_BASE))

    assert result.returncode == 1


def test_max_regression_30_lets_a_25_percent_regression_pass(tmp_path):
    result, _ = _compare(
        tmp_path, _with("feed", p95=125.0), _summary(_BASE), "--max-regression", "30"
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_max_regression_10_fails_a_15_percent_regression(tmp_path):
    result, _ = _compare(
        tmp_path, _with("game", p95=92.0), _summary(_BASE), "--max-regression", "10"
    )

    assert result.returncode == 1


def test_a_faster_run_passes(tmp_path):
    faster = _summary({name: (p95 / 2, p99 / 2) for name, (p95, p99) in _BASE.items()})

    result, _ = _compare(tmp_path, faster, _summary(_BASE))

    assert result.returncode == 0, result.stdout + result.stderr


def test_an_endpoint_missing_from_the_run_fails(tmp_path):
    run = _summary({name: v for name, v in _BASE.items() if name != "game"})

    result, _ = _compare(tmp_path, run, _summary(_BASE))

    assert result.returncode == 1


def test_a_new_endpoint_in_the_run_passes(tmp_path):
    run = _summary({**_BASE, "profile": (50.0, 90.0)})

    result, _ = _compare(tmp_path, run, _summary(_BASE))

    assert result.returncode == 0, result.stdout + result.stderr


def test_the_untagged_duration_is_ignored(tmp_path):
    run = _summary(_BASE)
    run["metrics"]["http_req_duration"]["values"]["p(95)"] = 1_000_000.0
    run["metrics"]["http_req_duration"]["values"]["p(99)"] = 1_000_000.0

    result, _ = _compare(tmp_path, run, _summary(_BASE))

    assert result.returncode == 0, result.stdout + result.stderr


def test_prints_a_table_naming_each_endpoint(tmp_path):
    result, _ = _compare(tmp_path, _summary(_BASE), _summary(_BASE))

    for name in _BASE:
        assert name in result.stdout


def test_a_regression_names_the_regressed_endpoint(tmp_path):
    result, _ = _compare(tmp_path, _with("game", p99=400.0), _summary(_BASE))

    assert result.returncode == 1
    assert "game" in result.stdout + result.stderr


def test_imports_only_the_standard_library():
    tree = ast.parse(_SCRIPT.read_text(encoding="utf-8"), filename=str(_SCRIPT))
    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0, "no relative imports"
            assert node.module is not None
            modules.add(node.module.split(".")[0])

    non_stdlib = modules - set(sys.stdlib_module_names) - {"__future__"}
    assert non_stdlib == set()
