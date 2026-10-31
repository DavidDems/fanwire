"""Measured hand-session usage from explicitly selected Claude JSONL files.

Only counters and provenance leave this module. Request/message identities are
used transiently to deduplicate content chunks and overlapping transcript files.
Output snapshots are cumulative: count the greatest completed snapshot once,
requiring the input/cache counters to agree. No prices or task allocation are
inferred from the session, and no transcript discovery is performed.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path

TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)
_FIXED_FIELDS = tuple(field for field in TOKEN_FIELDS if field != "output_tokens")
_FIELDS = frozenset((*TOKEN_FIELDS, "num_turns", "source"))
SOURCE = "claude_transcript"


class HandUsageError(Exception):
    """Selected evidence cannot establish a complete, sanitized usage total."""


def _counter(value, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise HandUsageError("usage counters must be nonnegative integers; turns must be positive")
    return value


def validate(value) -> dict | None:
    """Validate stored/caller-supplied metadata, returning an independent copy."""
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != _FIELDS or value.get("source") != SOURCE:
        raise HandUsageError(
            "hand usage must contain only measured counters and supported provenance"
        )
    return {
        **{field: _counter(value[field]) for field in TOKEN_FIELDS},
        "num_turns": _counter(value["num_turns"], 1),
        "source": SOURCE,
    }


def _assistant(record: dict) -> tuple[tuple[str, str], dict, bool]:
    message = record.get("message")
    if not isinstance(message, dict):
        raise HandUsageError("assistant usage metadata is incomplete")
    request, identity = record.get("requestId"), message.get("id")
    if not all(isinstance(value, str) and value.strip() for value in (request, identity)):
        raise HandUsageError("assistant usage identity is missing")
    usage = message.get("usage")
    if not isinstance(usage, dict):
        raise HandUsageError("assistant usage counters are missing")
    counters = {field: _counter(usage.get(field)) for field in TOKEN_FIELDS}
    stop = message.get("stop_reason")
    complete = isinstance(stop, str) and bool(stop.strip())
    return (request, identity), counters, complete


def capture(paths: Iterable[str | Path]) -> dict:
    """Read selected files, returning totals only if every observed turn is complete.

    A completed maximum for each request/message pair is required. Earlier
    provisional or completed snapshots are neither separate turns nor additive
    output. Missing or incompatible evidence never yields a partial result.
    Errors deliberately contain no path, identifier or original exception data.
    """
    turns: dict[tuple[str, str], tuple[dict, bool]] = {}
    selected = False
    for path in paths:
        selected = True
        assistant_seen = False
        try:
            with Path(path).open(encoding="utf-8") as stream:
                for line in stream:
                    record = json.loads(line)
                    if not isinstance(record, dict):
                        raise HandUsageError("transcript records must be objects")
                    if record.get("type") != "assistant":
                        continue
                    assistant_seen = True
                    identity, counters, complete = _assistant(record)
                    previous = turns.get(identity)
                    if previous is not None:
                        before, was_complete = previous
                        if any(before[field] != counters[field] for field in _FIXED_FIELDS):
                            raise HandUsageError("duplicate usage has incompatible input counters")
                        if counters["output_tokens"] < before["output_tokens"]:
                            continue
                        if counters["output_tokens"] == before["output_tokens"]:
                            complete = complete or was_complete
                    turns[identity] = counters, complete
        except (OSError, UnicodeError, ValueError, TypeError):
            raise HandUsageError("selected transcript evidence could not be read") from None
        if not assistant_seen:
            raise HandUsageError("selected transcript has no assistant usage")
    if not selected or not turns:
        raise HandUsageError("no transcript usage was selected")
    if any(not complete for _, complete in turns.values()):
        raise HandUsageError("a selected turn has no completed maximum usage snapshot")
    return {
        **{field: sum(counters[field] for counters, _ in turns.values()) for field in TOKEN_FIELDS},
        "num_turns": len(turns),
        "source": SOURCE,
    }
