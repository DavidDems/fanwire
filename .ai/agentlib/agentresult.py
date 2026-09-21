"""The provider-agnostic contract for "what an agent invocation produced".

`.ai/bin/invoke_agent.sh` normalises a provider's native output into this JSON
shape, and nothing downstream knows which provider produced it:

    {
      "provider":   "anthropic",
      "model":      "claude-sonnet-5",
      "session_id": "sess-abc123" | null,
      "usage":      {"input_tokens": 0, "output_tokens": 0},
      "summary":    "one line, used as the commit subject",
      "decision":   "MANAGER_RETRY" | "MANAGER_RESCOPE" | "ESCALATE" | null,
      "reason":     "free text, recorded in the state file"
    }

Everything here degrades rather than raises. A provider that returns nothing
useful must still leave a committable run and an honest telemetry record.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

FALLBACK_SUMMARY = "no summary reported"
MAX_SUMMARY_LINE = 72

# The only decisions a manager can make. Anything else means a human looks.
MANAGER_DECISIONS = frozenset({"MANAGER_RETRY", "MANAGER_RESCOPE", "ESCALATE"})

_FIELDS = ("provider", "model", "session_id", "summary", "decision", "reason")

# `<TASK-ID> <verb>: ` written by the agent into its own summary. The worker
# prepends exactly this itself, so a summary carrying one produces a doubled
# subject and wastes the length cap on a repeat.
_REDUNDANT_PREFIX = re.compile(r"^[A-Z][A-Z0-9]*-\d+\s+(?:test|impl|fix|wiki|chore)\s*:\s*")


def parse(path: str | Path) -> dict[str, Any]:
    """Read a normalised result. Never raises."""
    raw: dict[str, Any] = {}
    try:
        loaded = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            raw = loaded
    except (OSError, json.JSONDecodeError):
        raw = {}

    usage = raw.get("usage") if isinstance(raw.get("usage"), dict) else {}
    out = {field: raw.get(field) for field in _FIELDS}
    out["input_tokens"] = _int(usage.get("input_tokens"))
    out["output_tokens"] = _int(usage.get("output_tokens"))
    if not isinstance(out["summary"], str) or not out["summary"].strip():
        out["summary"] = FALLBACK_SUMMARY
    return out


def summary_line(result: dict[str, Any]) -> str:
    """A single-line, length-capped commit subject.

    Collapsed to one line on purpose: the summary is model-authored text going
    into a git command, and a newline in a commit subject silently turns the
    rest into a body.
    """
    flat = " ".join(str(result.get("summary") or "").split())
    flat = _REDUNDANT_PREFIX.sub("", flat).strip()
    if not flat:
        return FALLBACK_SUMMARY
    return flat[:MAX_SUMMARY_LINE]


def manager_decision(result: dict[str, Any]) -> str:
    """Read the manager's decision from the structured field, and nowhere else.

    Never inferred from prose: `reason` is free text that may quote something
    the manager read, and a decision parsed out of free text is a decision
    anything in the repository could forge.
    """
    decision = result.get("decision")
    if isinstance(decision, str) and decision in MANAGER_DECISIONS:
        return decision
    return "ESCALATE"


def telemetry_record(
    result: dict[str, Any],
    task_id: str,
    role: str,
    attempt: int,
    workflow_run_id: str,
    started_at: str,
    outcome: str,
    ended_at: str | None = None,
    ci_run_id: str | None = None,
    commit_sha: str | None = None,
) -> dict[str, Any]:
    """Build the telemetry record for this invocation.

    Token counts come from the provider; everything derived from them
    (totals, cost, duration) is recomputed by `telemetry.record`, so an agent
    cannot under-report what it spent.
    """
    from datetime import UTC, datetime

    return {
        "task_id": task_id,
        "workflow_run_id": workflow_run_id,
        "role": role,
        "provider": result.get("provider") or "unknown",
        "model": result.get("model") or "unknown",
        "session_id": result.get("session_id"),
        "attempt": attempt,
        "started_at": started_at,
        "ended_at": ended_at or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "input_tokens": result.get("input_tokens", 0),
        "output_tokens": result.get("output_tokens", 0),
        "result": "completed" if outcome == "success" else "failed",
        "commit_sha": commit_sha,
        "ci_run_id": ci_run_id,
    }


def _int(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0
