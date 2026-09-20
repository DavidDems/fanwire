"""Agent telemetry: append-only, immutable, never LLM-generated.

One JSON file per agent invocation under `.ai/telemetry/runs/<TASK-ID>/`.
Files are written once and never rewritten, so history cannot be quietly
revised — and `.ai/**` is in `guard.ALWAYS_FORBIDDEN`, so no worker can write
here at all. Only the orchestrator's own commit step does.

Derived numbers (total tokens, duration, cost) are computed here rather than
taken from the caller, so a worker cannot under-report what it spent.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1

KNOWN_ROLES = frozenset(
    {"director", "manager", "test_agent", "code_agent", "distiller", "context_maintainer"}
)

REQUIRED_FIELDS = (
    "task_id",
    "workflow_run_id",
    "role",
    "provider",
    "model",
    "attempt",
    "started_at",
    "ended_at",
    "input_tokens",
    "output_tokens",
    "result",
)

# Fields that are allowed to be absent or null — they simply are not always known.
NULLABLE = ("session_id", "commit_sha", "ci_run_id")


class TelemetryError(Exception):
    pass


def record(
    root: str | Path,
    rec: dict[str, Any],
    prices: dict[str, dict[str, float]] | None = None,
    filename: str | None = None,
) -> Path:
    """Write one invocation record. Refuses to overwrite an existing file."""
    for field in REQUIRED_FIELDS:
        if field not in rec:
            raise TelemetryError(f"telemetry record is missing required field: {field}")
    if rec["role"] not in KNOWN_ROLES:
        raise TelemetryError(
            f"unknown role {rec['role']!r}; known roles: {sorted(KNOWN_ROLES)}"
        )

    out = {"schema": SCHEMA_VERSION, **rec}
    for field in NULLABLE:
        out.setdefault(field, None)

    out["total_tokens"] = int(rec["input_tokens"]) + int(rec["output_tokens"])
    out["duration_seconds"] = _duration(rec["started_at"], rec["ended_at"])
    out["estimated_cost_usd"] = _cost(out, prices or {})

    task_dir = Path(root) / str(rec["task_id"])
    task_dir.mkdir(parents=True, exist_ok=True)
    name = filename or f"{rec['workflow_run_id']}-{rec['role']}-a{rec['attempt']}.json"
    path = task_dir / name
    if path.exists():
        raise TelemetryError(f"{path} already exists; telemetry is append-only")
    path.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def aggregate(root: str | Path) -> dict[str, Any]:
    """Roll up everything under `root`. Pure reporting — no model involved."""
    totals = _bucket()
    by_task: dict[str, dict[str, Any]] = {}
    by_role: dict[str, dict[str, Any]] = {}
    by_model: dict[str, dict[str, Any]] = {}
    unreadable: list[str] = []

    for path in sorted(Path(root).glob("*/*.json")) if Path(root).exists() else []:
        rel = f"{path.parent.name}/{path.name}"
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            unreadable.append(rel)
            continue

        task = by_task.setdefault(rec.get("task_id", "?"), _bucket())
        role = by_role.setdefault(rec.get("role", "?"), _bucket())
        model = by_model.setdefault(rec.get("model", "?"), _bucket())
        for bucket in (totals, task, role, model):
            _accumulate(bucket, rec)

    return {
        "schema": SCHEMA_VERSION,
        "totals": totals,
        "by_task": by_task,
        "by_role": by_role,
        "by_model": by_model,
        "unreadable": unreadable,
    }


def _bucket() -> dict[str, Any]:
    return {
        "invocations": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "estimated_cost_usd": 0.0,
        "attempts": 0,
        "escalations": 0,
    }


def _accumulate(bucket: dict[str, Any], rec: dict[str, Any]) -> None:
    bucket["invocations"] += 1
    bucket["input_tokens"] += int(rec.get("input_tokens") or 0)
    bucket["output_tokens"] += int(rec.get("output_tokens") or 0)
    bucket["total_tokens"] += int(rec.get("total_tokens") or 0)
    bucket["estimated_cost_usd"] += float(rec.get("estimated_cost_usd") or 0.0)
    bucket["attempts"] = max(bucket["attempts"], int(rec.get("attempt") or 0))
    if rec.get("result") == "escalated":
        bucket["escalations"] += 1


def _duration(started: str, ended: str) -> int | None:
    try:
        a = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        b = datetime.fromisoformat(str(ended).replace("Z", "+00:00"))
    except ValueError:
        return None
    return int((b - a).total_seconds())


def _cost(rec: dict[str, Any], prices: dict[str, dict[str, float]]) -> float | None:
    key = f"{rec.get('provider')}/{rec.get('model')}"
    price = prices.get(key) or prices.get(str(rec.get("model")))
    if not price:
        # Never guess a price. A null cost is a known unknown; a wrong number
        # silently corrupts every aggregate built on it.
        return None
    return (
        int(rec["input_tokens"]) / 1e6 * float(price.get("input_per_mtok", 0.0))
        + int(rec["output_tokens"]) / 1e6 * float(price.get("output_per_mtok", 0.0))
    )


def iter_records(root: str | Path) -> Iterable[dict[str, Any]]:
    for path in sorted(Path(root).glob("*/*.json")):
        try:
            yield json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
