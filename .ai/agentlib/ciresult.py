"""Distil a CI log into a small, bounded, machine-readable result.

Deliberately script-first. Working out *which* tests failed and *what kind* of
failure each was is parsing, and a parser does it for free, deterministically,
every time. A model is only ever asked to add prose interpretation on top of
this structure (see `.ai/prompts/distiller.md`), and if that call fails the
workflow still has everything it needs to retry.

The output is what gets injected into a retry prompt. Raw logs never are.
"""

from __future__ import annotations

import re
from typing import Any

SCHEMA_VERSION = 1

# Hard cap on how much failure detail can reach a prompt. A 500-failure run is
# one problem, not 500, and an unbounded list is a token-burn and a
# prompt-injection surface at the same time.
MAX_FAILURES = 12
MAX_SUMMARY_CHARS = 200

_PYTEST_SUMMARY = re.compile(r"^(FAILED|ERROR)\s+(\S+?)(?:\s+-\s+(.*))?$", re.MULTILINE)
_PYTEST_COUNTS = re.compile(r"(\d+)\s+(failed|error|errors)\b")
_JEST_CASE = re.compile(r"^\s*●\s+(.+?)\s*$", re.MULTILINE)
_JEST_FILE = re.compile(r"^\s*FAIL\s+(\S+)", re.MULTILINE)
_SOURCE_REF = re.compile(r"([\w./\\-]+\.(?:py|ts|tsx|js|jsx)):\d+")

# Ordered: the first pattern that matches a failure's text wins.
_CATEGORIES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "collection_error",
        re.compile(
            r"ModuleNotFoundError|ImportError|error collecting|Cannot find module", re.IGNORECASE
        ),
    ),
    ("timeout", re.compile(r"\bTimeout\b|timed out", re.IGNORECASE)),
    (
        "assertion_failure",
        re.compile(r"\bAssertionError\b|^assert |\bexpect\(", re.IGNORECASE | re.MULTILINE),
    ),
    # Static type-checking output only. A runtime `TypeError` is an ordinary
    # exception and must not be mistaken for a mypy/tsc finding.
    ("type_error", re.compile(r"\bmypy\b|error TS\d+|error:.*\[[a-z-]+\]$", re.MULTILINE)),
    ("exception", re.compile(r"\b[A-Z]\w*(?:Error|Exception)\b")),
)

# Failures of the runner itself, not of the code under test.
_INFRA = re.compile(
    r"docker: Error|Cannot connect to the Docker daemon|pull access denied|"
    r"No space left on device|The runner has received a shutdown signal|"
    r"connection refused|could not connect to server",
    re.IGNORECASE,
)


def distill(raw_log: str, ci_status: str, task_id: str, attempt: int) -> dict[str, Any]:
    """Turn a CI log into the retry contract. Never raises on malformed input."""
    log = raw_log or ""
    passed = ci_status == "success"

    if passed:
        return _result(task_id, attempt, "passed", [], None, 0, False, [])

    if _INFRA.search(log):
        return _result(task_id, attempt, "failed", [], "infrastructure", 0, False, [])

    failures = _parse_pytest(log) or _parse_jest(log)
    total = _count(log, failures)
    truncated = len(failures) > MAX_FAILURES
    shown = failures[:MAX_FAILURES]

    relevant = _relevant_files(log, shown)
    origin = _origin(shown)

    return _result(task_id, attempt, "failed", shown, origin, total, truncated, relevant)


def _result(task_id, attempt, status, failures, origin, total, truncated, relevant):
    return {
        "schema": SCHEMA_VERSION,
        "task_id": task_id,
        "attempt": attempt,
        "status": status,
        "origin": origin,
        "failed_count": total,
        "truncated": truncated,
        "failures": failures,
        "relevant_files": relevant,
    }


def _parse_pytest(log: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for kind, test_id, tail in _PYTEST_SUMMARY.findall(log):
        if test_id in seen:
            continue
        seen.add(test_id)
        detail = tail or _detail_near(log, test_id)
        category = "collection_error" if kind == "ERROR" else _categorise(detail or log)
        out.append(
            {
                "test": test_id,
                "category": category,
                "summary": _clip(detail or kind.lower()),
                "file": test_id.split("::", 1)[0],
            }
        )
    return out


def _parse_jest(log: str) -> list[dict[str, str]]:
    files = _JEST_FILE.findall(log)
    default_file = files[0] if files else ""
    out = []
    for name in _JEST_CASE.findall(log):
        out.append(
            {
                "test": name,
                "category": _categorise(log),
                "summary": _clip(name),
                "file": default_file,
            }
        )
    return out


def _detail_near(log: str, test_id: str) -> str:
    """The short name of a pytest test also heads its traceback block; use that
    block when the summary line carried no reason."""
    short = test_id.split("::")[-1]
    block = re.search(
        rf"_{{3,}}[^\n]*{re.escape(short)}[^\n]*_{{3,}}\n(.{{0,600}})", log, re.DOTALL
    )
    return block.group(1) if block else ""


def _categorise(text: str) -> str:
    for name, pattern in _CATEGORIES:
        if pattern.search(text):
            return name
    return "unknown"


def _count(log: str, failures: list[dict[str, str]]) -> int:
    """Prefer the runner's own tally — it survives truncation of the log body."""
    totals = [int(n) for n, _ in _PYTEST_COUNTS.findall(log)]
    if totals:
        return max(sum(totals), len(failures))
    jest = re.search(r"Tests:\s+(\d+)\s+failed", log)
    if jest:
        return max(int(jest.group(1)), len(failures))
    return len(failures)


def _relevant_files(log: str, failures: list[dict[str, str]]) -> list[str]:
    files = {f["file"] for f in failures if f.get("file")}
    files.update(m.replace("\\", "/") for m in _SOURCE_REF.findall(log))
    return sorted(f for f in files if f)


def _origin(failures: list[dict[str, str]]) -> str | None:
    """Where the problem most likely lives. `ambiguous` when nothing parsed —
    the Manager decides those, the retry loop does not guess."""
    if not failures:
        return "ambiguous"
    categories = {f["category"] for f in failures}
    if categories <= {"collection_error"}:
        # The tests cannot even be imported: that is the test commit's problem,
        # not the implementation's.
        return "test"
    if categories & {"assertion_failure", "exception", "type_error", "timeout"}:
        return "implementation"
    return "ambiguous"


def _clip(text: str) -> str:
    flat = " ".join(text.split())
    return flat[:MAX_SUMMARY_CHARS]
