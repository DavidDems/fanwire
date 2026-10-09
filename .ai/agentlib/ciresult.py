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
    # `gh run view --log-failed` prefixes every line with its job, step and a
    # timestamp, which the line-anchored patterns below never matched: every
    # real failure distilled to `ambiguous` (handoff.md §10, D4). A log
    # without the prefix is read as it is.
    log = "\n".join(content for _, content in _gh_lines(raw_log or "")) or (raw_log or "")
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


# --------------------------------------------------------------------------- the red baseline
#
# handoff.md §10, D4. A baseline run that failed is only "red, as required"
# when the new tests are what failed. Dispatched CI runs every suite, so it
# also fails on an audit CVE, openapi drift, an unrelated broken test, or a
# tree-scan test the new test tripped -- none of which a code agent, which
# cannot edit tests, can fix. Decided here, deterministically, from the run's
# job list and its failed-job log; anything this cannot read is not the right
# reason (fail closed: the manager looks, no code-agent attempt is spent).

# The jobs in .github/workflows/test-agent.yml whose failure can be the new
# tests' doing, and the directory each one's suite runs from (pytest and
# vitest name files relative to it). Pinned to the YAML and the Dockerfiles by
# tests/test_workflows.py::TestTheTestJobsAreTestAgentsOwn. A job not listed is
# a non-test job, so a suite added to test-agent.yml and not here fails closed.
TEST_JOBS: dict[str, str] = {"backend-test": "backend/", "frontend-test": "frontend/"}

# test-agent.yml's always-running aggregate. It fails whenever any job does,
# so on its own it says nothing; it is excused only alongside a failed test job.
AGGREGATE_JOB = "gate"

# A wrong-reason verdict becomes the task's escalation_reason, which the
# manager is shown and `agentctl status` prints. Bounded like everything else
# that reaches a prompt.
MAX_REASON_CHARS = 400
_MAX_NAMED = 5

# `<job>\t<step>\t<timestamp> <line>`: how `gh run view --log-failed` prints.
_GH_LINE = re.compile(r"^([^\t\n]+)\t([^\t\n]*)\t(.*)$")
_GH_STAMP = re.compile(r"^\ufeff?(?:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?)?")
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

# pytest's short test summary (`-r fE`, its default) names every failure and
# every error on a line of its own; its last line tallies them.
_PYTEST_ENTRY = re.compile(r"^(?:FAILED|ERROR) (\S+)")
_PYTEST_TALLY = re.compile(r"^=+ (.*\bin [\d.]+s\b.*?) =+$")
_PYTEST_TALLY_COUNTS = re.compile(r"(\d+) (failed|errors?)\b")
# vitest prints `FAIL  <file> > <test>` for a failed test and
# `FAIL  <file> [ <file> ]` for a file it could not even collect (_JEST_FILE
# reads both), then tallies failed files.
_VITEST_FILES = re.compile(r"^\s*Test Files\s+(\d+) failed")
_VITEST_ERRORS = re.compile(r"^\s*Errors\s+(\d+) errors?")


def _gh_lines(raw: str) -> list[tuple[str, str]]:
    """(job, content) for each line of `--log-failed` output.

    A line without the prefix continues the previous line's job. Nothing
    before the first prefixed line can be attributed to a job, so it is
    dropped: an unprefixed log yields nothing, and the baseline check then
    calls it unreadable rather than guessing whose it is.
    """
    out: list[tuple[str, str]] = []
    job = ""
    for line in raw.splitlines():
        m = _GH_LINE.match(line)
        if m:
            job, line = m.group(1), m.group(3)
        elif not job:
            continue
        out.append((job, _ANSI.sub("", _GH_STAMP.sub("", line, count=1)).rstrip("\r")))
    return out


def _job_conclusions(ran: Any) -> dict[str, str] | None:
    """name -> conclusion from `gh run view --json jobs`, or None if unreadable."""
    listed = ran.get("jobs") if isinstance(ran, dict) else None
    if not isinstance(listed, list) or not listed:
        return None
    out: dict[str, str] = {}
    for job in listed:
        if not isinstance(job, dict) or not isinstance(job.get("name"), str):
            return None
        out[job["name"]] = str(job.get("conclusion") or "")
    return out


def _pytest_failed_files(lines: list[str]) -> tuple[list[str], str | None]:
    """Files named in pytest's short summary, or why they cannot be trusted."""
    entries = list(dict.fromkeys(m.group(0) for ln in lines if (m := _PYTEST_ENTRY.match(ln))))
    tallies = [m.group(1) for ln in lines if (m := _PYTEST_TALLY.match(ln.strip()))]
    if not tallies:
        return [], "no pytest summary in its log"
    counted = sum(int(n) for n, _ in _PYTEST_TALLY_COUNTS.findall(tallies[-1]))
    if not entries or counted == 0:
        return [], "no failing test named in its log"
    if len(entries) < counted:
        return [], f"its log counts {counted} failures but names {len(entries)}"
    return [e.split(" ", 1)[1].split("::", 1)[0] for e in entries], None


def _vitest_failed_files(lines: list[str]) -> tuple[list[str], str | None]:
    """Files vitest names as failed, or why they cannot be trusted."""
    if any(_VITEST_ERRORS.match(ln) for ln in lines):
        return [], "vitest reported unhandled errors, which name no test file"
    counted = [int(m.group(1)) for ln in lines if (m := _VITEST_FILES.match(ln))]
    if not counted:
        return [], "no vitest summary in its log"
    files = list(dict.fromkeys(m.group(1) for ln in lines if (m := _JEST_FILE.match(ln))))
    if not files:
        return [], "no failing test file named in its log"
    if len(files) < counted[-1]:
        return [], f"its log counts {counted[-1]} failed files but names {len(files)}"
    return files, None


# How each test job's log is read. Every TEST_JOBS entry has one.
_FAILED_FILES = {"backend-test": _pytest_failed_files, "frontend-test": _vitest_failed_files}


def _repo_path(directory: str, reported: str) -> str:
    path = reported.replace("\\", "/").removeprefix("./")
    for root in ("/var/task/", "/app/"):  # the two test images' working directories
        path = path.removeprefix(root)
    return directory + path


def _named(items: list[str]) -> str:
    shown = ", ".join(items[:_MAX_NAMED])
    return shown + (f" and {len(items) - _MAX_NAMED} more" if len(items) > _MAX_NAMED else "")


def baseline_verdict(raw_log: str, ran: Any, test_files: set[str] | frozenset[str]) -> dict:
    """Is a failed baseline run red for the right reason?

    `raw_log` is `gh run view --log-failed`, `ran` is `gh run view --json
    jobs`, `test_files` the repository paths the test commit changed. Right
    only if every failed job is a test job (or the aggregate, alongside one),
    each failed test job's log names all of its failures, and every one is in
    `test_files`. Never raises: anything unreadable is a wrong-reason verdict
    whose `reason` says what could not be read.
    """
    failures: list[dict[str, str]] = []
    problems: list[str] = []
    conclusions = _job_conclusions(ran)
    if conclusions is None:
        problems.append("could not read the run's job list")
        conclusions = {}
    bad = {n: c for n, c in conclusions.items() if c not in ("success", "skipped")}
    other = sorted(n for n in bad if n not in TEST_JOBS and n != AGGREGATE_JOB)
    if other:
        problems.append(f"non-test job(s) failed: {_named(other)}")
    unfinished = sorted(n for n in bad if n in TEST_JOBS and bad[n] != "failure")
    if unfinished:
        problems.append(
            "test job(s) did not fail outright: " + _named([f"{n} ({bad[n]})" for n in unfinished])
        )
    red = sorted(n for n in bad if n in TEST_JOBS and bad[n] == "failure")
    if conclusions and not red:
        problems.append("no test job failed")
    lines = _gh_lines(raw_log or "")
    for job in red:
        files, why = _FAILED_FILES[job]([content for name, content in lines if name == job])
        if why:
            problems.append(f"could not read {job}'s failures: {why}")
        for f in files:
            entry = {"job": job, "file": _repo_path(TEST_JOBS[job], f)}
            if entry not in failures:
                failures.append(entry)
    if not test_files:
        problems.append("no files recorded for the test commit")
    else:
        outside = [f["file"] for f in failures if f["file"] not in test_files]
        if outside:
            problems.append(f"failures outside the test commit's files: {_named(outside)}")
    reason = "; ".join(problems)
    if len(reason) > MAX_REASON_CHARS:
        reason = reason[: MAX_REASON_CHARS - 3] + "..."
    return {"right_reason": not problems, "reason": reason, "failures": failures}
