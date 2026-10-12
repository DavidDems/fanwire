"""Agent telemetry: append-only, immutable, never LLM-generated.

One JSON file per agent invocation under `.ai/telemetry/runs/<TASK-ID>/`.
Files are written once and never rewritten, so history cannot be quietly
revised — and `.ai/**` is in `guard.ALWAYS_FORBIDDEN`, so no worker can write
here at all. Only the orchestrator's own commit step does.

Derived numbers (total tokens, duration, the estimate, which cost is used)
are computed here rather than taken from the caller.

Cost (handoff.md §10, D6). The provider's own figure for the call
(`provider_cost_usd`, the CLI envelope's `total_cost_usd`) is authoritative:
`cost_usd` is that figure, with `cost_source: "provider"`. Only when the
provider gave none is `cost_usd` the estimate from `.ai/config.json`'s price
table, with `cost_source: "estimate"`. The estimate is always recorded beside
it, so the two can be compared. A record written before D6 has no
`cost_source`; it counts as an estimate, and one that excluded cache tokens.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Any

# 2: provider cost, cost_source, cache/thinking tokens, turns, denials (D6).
SCHEMA_VERSION = 2

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
NULLABLE = (
    "session_id",
    "commit_sha",
    "ci_run_id",
    "provider_cost_usd",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "cache_creation_1h_input_tokens",
    "cache_creation_5m_input_tokens",
    "thinking_tokens",
    "num_turns",
    "permission_denials",
    "is_error",
    "subtype",
)


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
        raise TelemetryError(f"unknown role {rec['role']!r}; known roles: {sorted(KNOWN_ROLES)}")

    out = {"schema": SCHEMA_VERSION, **rec}
    for field in NULLABLE:
        out.setdefault(field, None)

    out["provider_cost_usd"] = _money(out["provider_cost_usd"])
    # Every token billed: cache reads and writes are most of an agent's input.
    out["total_tokens"] = (
        int(rec["input_tokens"])
        + int(rec["output_tokens"])
        + _tokens(out, "cache_creation_input_tokens")
        + _tokens(out, "cache_read_input_tokens")
    )
    out["duration_seconds"] = _duration(rec["started_at"], rec["ended_at"])
    out["estimated_cost_usd"] = _cost(out, prices or {})
    if out["provider_cost_usd"] is not None:
        out["cost_usd"], out["cost_source"] = out["provider_cost_usd"], "provider"
    else:
        out["cost_usd"], out["cost_source"] = out["estimated_cost_usd"], "estimate"

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
    estimated: list[str] = []
    denials: list[dict[str, Any]] = []

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
        if not _is_provider_cost(rec):
            estimated.append(rel)
        if _tokens(rec, "permission_denials"):
            tools = rec.get("permission_denied_tools")
            denials.append(
                {
                    "record": rel,
                    "count": _tokens(rec, "permission_denials"),
                    "tools": [t for t in tools if isinstance(t, str)]
                    if isinstance(tools, list)
                    else [],
                }
            )

    return {
        "schema": SCHEMA_VERSION,
        "totals": totals,
        "by_task": by_task,
        "by_role": by_role,
        "by_model": by_model,
        "unreadable": unreadable,
        "estimated": estimated,
        "denials": denials,
    }


def _bucket() -> dict[str, Any]:
    return {
        "invocations": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "cost_usd": 0.0,
        "estimated_records": 0,
        "unpriced_records": 0,
        "permission_denials": 0,
        "attempts": 0,
        "escalations": 0,
    }


def _accumulate(bucket: dict[str, Any], rec: dict[str, Any]) -> None:
    bucket["invocations"] += 1
    bucket["input_tokens"] += int(rec.get("input_tokens") or 0)
    bucket["output_tokens"] += int(rec.get("output_tokens") or 0)
    bucket["total_tokens"] += int(rec.get("total_tokens") or 0)
    bucket["cache_creation_input_tokens"] += _tokens(rec, "cache_creation_input_tokens")
    bucket["cache_read_input_tokens"] += _tokens(rec, "cache_read_input_tokens")
    # A record from before D6 has only `estimated_cost_usd`.
    cost = _money(rec["cost_usd"] if "cost_usd" in rec else rec.get("estimated_cost_usd"))
    if cost is None:
        bucket["unpriced_records"] += 1
    else:
        bucket["cost_usd"] += cost
    if not _is_provider_cost(rec):
        bucket["estimated_records"] += 1
    bucket["permission_denials"] += _tokens(rec, "permission_denials")
    bucket["attempts"] = max(bucket["attempts"], int(rec.get("attempt") or 0))
    if rec.get("result") == "escalated":
        bucket["escalations"] += 1


def _duration(started: str, ended: str) -> int | None:
    try:
        a = datetime.fromisoformat(str(started))
        b = datetime.fromisoformat(str(ended))
    except ValueError:
        return None
    return int((b - a).total_seconds())


def _cost(rec: dict[str, Any], prices: dict[str, dict[str, float]]) -> float | None:
    """The estimate from the price table, or None when it cannot be honest.

    Cache reads and the two cache-write durations are priced separately (see
    config.json's `_prices_note`). Never guess a price: a null cost is a
    known unknown; a wrong number silently corrupts every aggregate built on
    it. So a model with no entry, cache tokens with no cache price, or cache
    writes whose duration the provider did not split all give None.
    """
    key = f"{rec.get('provider')}/{rec.get('model')}"
    price = prices.get(key) or prices.get(str(rec.get("model")))
    if not price:
        return None
    parts = [
        (int(rec["input_tokens"]), "input_per_mtok"),
        (int(rec["output_tokens"]), "output_per_mtok"),
        (_tokens(rec, "cache_read_input_tokens"), "cache_read_per_mtok"),
    ]
    written = _tokens(rec, "cache_creation_input_tokens")
    one_hour = _tokens(rec, "cache_creation_1h_input_tokens")
    five_min = _tokens(rec, "cache_creation_5m_input_tokens")
    if written != one_hour + five_min:
        return None
    parts += [(one_hour, "cache_write_1h_per_mtok"), (five_min, "cache_write_5m_per_mtok")]
    total = 0.0
    for tokens, field in parts:
        if not tokens:
            continue
        rate = price.get(field)
        if isinstance(rate, bool) or not isinstance(rate, (int, float)):
            return None
        total += tokens / 1e6 * float(rate)
    return total


def _is_provider_cost(rec: dict[str, Any]) -> bool:
    return rec.get("cost_source") == "provider" and _money(rec.get("cost_usd")) is not None


def _tokens(rec: dict[str, Any], field: str) -> int:
    """A count from a record, 0 when absent or not a non-negative int."""
    value = rec.get(field)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def _money(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return float(value)


def iter_records(root: str | Path) -> Iterable[dict[str, Any]]:
    for path in sorted(Path(root).glob("*/*.json")):
        try:
            yield json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
