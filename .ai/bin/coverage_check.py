#!/usr/bin/env python3
"""Check which acceptance criteria the tests of an `agent/*` PR pin.

  coverage_check.py ask    --task-id X-001 --spec-root tools --pr-root pr \
                           --changed changed.txt --work DIR [--summary FILE]
  coverage_check.py render --work DIR --pr-number N --head-sha SHA \
                           --run-url URL --comment-out comment.md [--summary FILE]

Run by `.github/workflows/coverage-check.yml` from main's copy (the PR's base
SHA, at `tools/`), with the PR checked out beside it at `pr/` as data.
`agentlib.coverage` builds the request, checks the answer and renders the
comment; this script makes the one model call between them.

Two subcommands, because `jev` is asked in between, in its own step that
holds only its own key: `ask` makes the Haiku call and writes
`DIR/coverage.json` and the state `jev` is asked about (`DIR/jev-state.txt`);
`ask_jev.py` writes `DIR/jev.json`; `render` reads both and writes the
comment, with the two answers side by side in its hidden shadow record.

work-modes.md "Constraints every automation must keep", as this script keeps
them:
  - only a task: `--task-id` must match the guard's own pattern, or nothing
    is read, called or written. The spec is read from main's copy
    (`--spec-root`), never the branch's.
  - model input is untrusted: only the PR's test files are read, never its
    implementation, and only from inside `--pr-root` (no absolute path, no
    `..`, no link out). A test id the model names is kept only if it is
    really in the file it names.
  - bounded spend: a capped input of whole files, a `max_tokens` cap, and
    exactly one request. No retry, on any status: the next push is the
    retry. A PR that changes no test needs no model at all.
  - fail quiet: any result or comment file left from before is deleted
    first, and on any error no new one is written. No comment beats a wrong
    or half one.
  - recorded cost: priced from the response's own `usage`, cache tokens
    included (D6), in the comment footer, the job summary and one job-log
    line. A call whose answer is unusable was billed all the same, so its
    cost and the response's shape are recorded too, though no result is.
  - the key is never printed: it goes into one header and nowhere else, and
    is redacted from any remote text before that text is written anywhere.

Exit 0 a result (or comment) was written, or there was nothing to check; 1
the call failed or gave no answer (no result); 2 the invocation itself is
wrong (no call, no result).

Stdlib only, no SDK: this runs in a CI step that installs nothing, and the
request is one POST with a JSON body.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request  # noqa: F401  (the tests fake `coverage_check.urllib.request.urlopen`)
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

# Inserted explicitly: the workflow runs this with `python -I`, which keeps
# the script's own directory (and the working directory) off sys.path.
AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from agentlib import automation, coverage, decision
from agentlib.guard import TASK_ID_SAFE

OK, FAILED, USAGE = 0, 1, 2
PROVIDER = "anthropic"
USER_AGENT = "fanwire-coverage-check/1.0"
# The one request may take this long at most, whatever --timeout says: the
# job's own timeout is five minutes.
MAX_TIMEOUT = 60.0

# The files `ask` writes and `render` reads, under --work. `jev.json` is
# ask_jev.py's --out.
RESULT = "coverage.json"
JEV_STATE = "jev-state.txt"
JEV_ANSWERS = "jev.json"
JEV_OPTIONS = ("yes", "no")
# Branch- or remote-chosen strings in the shadow record are cut to this, so
# its one line stays short.
_MAX_RECORD_CHARS = 120


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="coverage_check.py", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="command", required=True)

    a = sub.add_parser("ask", help="ask the model which tests pin each criterion")
    a.add_argument("--task-id", required=True, help="the task the PR's branch names")
    a.add_argument("--spec-root", required=True, help="main's checkout, where the spec is read")
    a.add_argument("--pr-root", required=True, help="the PR's checkout, read as data")
    a.add_argument("--changed", required=True, help="the PR's changed paths, one per line")
    a.add_argument("--work", required=True, help="where the result and jev's state go")
    a.add_argument("--summary", help="a markdown file to append a readable account to")
    a.add_argument("--timeout", type=float, default=30.0, help="seconds for the one request")

    r = sub.add_parser("render", help="write the comment from the result and jev's answer")
    r.add_argument("--work", required=True, help="where `ask` and ask_jev.py wrote")
    r.add_argument("--pr-number", required=True, help="the PR, for the shadow record")
    r.add_argument("--head-sha", required=True, help="the commit that was checked")
    r.add_argument("--run-url", required=True, help="this run's page, for the footer")
    r.add_argument("--comment-out", required=True, help="where to write the comment body")
    r.add_argument("--summary", help="a markdown file to append a readable account to")

    args = ap.parse_args(argv)
    return ask(args) if args.command == "ask" else render(args)


# --------------------------------------------------------------------------- ask


def ask(args: argparse.Namespace) -> int:
    work = Path(args.work)
    summary = Path(args.summary) if args.summary else None

    # First, before anything can fail: a result from an earlier step or run
    # must never be rendered as this run's, nor jev asked about old state.
    for name in (RESULT, JEV_STATE):
        try:
            (work / name).unlink(missing_ok=True)
        except OSError as exc:
            return _give_up(summary, f"cannot clear {name}: {exc}", USAGE)

    task_id = args.task_id
    if not TASK_ID_SAFE.fullmatch(task_id):
        # The workflow has already checked the branch name in bash; this is
        # the same rule, applied where the id becomes a path.
        return _give_up(summary, f"not a task id: {automation.inline(task_id)!r}", USAGE)

    spec_path = Path(args.spec_root) / ".ai" / "tasks" / task_id / "task.json"
    if not spec_path.is_file():
        # A hand-named agent/ branch, or a task whose spec is not on main yet:
        # there is nothing to check against, which is not a failure.
        _summarize(summary, [f"- no spec for `{task_id}` on main; nothing to check"])
        print(f"no spec for {task_id} on main; nothing to check")
        return OK
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        return _give_up(summary, f"cannot read the spec: {exc}", FAILED)
    criteria = coverage.criteria(spec)
    if not criteria:
        _summarize(summary, [f"- `{task_id}` lists no acceptance criteria; nothing to check"])
        print(f"{task_id} lists no acceptance criteria; nothing to check")
        return OK

    config = _config()
    provider = config.get("providers", {}).get(PROVIDER, {})
    settings = config.get("automations", {}).get("coverage", {})
    model = settings.get("model")
    endpoint = provider.get("endpoint")
    version = provider.get("api_version")
    key_var = provider.get("api_key_env")
    if not all(isinstance(v, str) and v for v in (model, endpoint, version, key_var)):
        return _give_up(summary, "config.json has no usable automations.coverage", USAGE)
    max_tokens = min(
        automation.positive(settings.get("max_tokens"), coverage.MAX_TOKENS), coverage.MAX_TOKENS
    )
    max_chars = min(
        automation.positive(settings.get("max_test_chars"), coverage.MAX_TEST_CHARS),
        coverage.MAX_TEST_CHARS,
    )

    try:
        changed = Path(args.changed).read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        return _give_up(summary, f"cannot read the changed paths: {exc}", USAGE)
    files, refused = _read_tests(Path(args.pr_root), changed, max_chars)
    tests, omitted = coverage.bundle(files, max_chars)
    if refused:
        print(f"::warning::{refused} changed path(s) were not read: outside the PR checkout")

    if not tests:
        # No test changed (or none fits): every criterion is unpinned by this
        # PR, and saying so needs no model. jev is not asked either.
        _write_json(
            work / RESULT,
            _result(task_id, criteria, [[] for _ in criteria], 0, tests, omitted, None, None, None),
        )
        _summarize(summary, ["- the PR changes no test file that could be read: no model asked"])
        print("no test file to read; no model asked")
        return OK

    try:
        system = (AI_ROOT / "prompts" / "coverage-check.md").read_text(encoding="utf-8").strip()
    except OSError as exc:
        return _give_up(summary, f"cannot read the system prompt: {exc}", USAGE)

    api_key = os.environ.get(key_var, "").strip()
    if not api_key:
        return _give_up(summary, f"{key_var} is not set", FAILED)

    payload = coverage.request_body(
        criteria, tests, model=model, max_tokens=max_tokens, system=system
    )
    timeout = min(max(args.timeout, 1.0), MAX_TIMEOUT)
    body, error = automation.post(
        endpoint, version, api_key, payload, timeout, user_agent=USER_AGENT
    )
    if error is not None:
        return _give_up(summary, automation.redact(error, api_key), FAILED, "model call failed")

    # Billed whether or not the answer is usable, so priced before it is read.
    usage, answered_by, cost = automation.priced(body, model, config, PROVIDER)
    described = automation.redact(automation.describe_response(body), api_key)
    answer = coverage.read_answer(body, len(criteria), tests)
    if answer is None:
        error = "the model gave no usable answer"
        _summarize(
            summary,
            [f"- no result: `{error}`", f"- response: `{automation.inline(described)}`"]
            + automation.call_lines(answered_by, usage, cost),
        )
        print(f"no usable answer: {automation.log_line(described, usage, cost)}")
        print(f"::error::{error}", file=sys.stderr)
        return FAILED

    pinned, unverified = answer
    _write_json(
        work / RESULT,
        _result(task_id, criteria, pinned, unverified, tests, omitted, answered_by, usage, cost),
    )
    _write(work / JEV_STATE, coverage.jev_state(criteria, tests))
    covered = sum(1 for p in pinned if p)
    _summarize(
        summary,
        [f"- {covered} of {len(criteria)} criteria pinned, {unverified} claimed test(s) dropped"]
        + automation.call_lines(answered_by, usage, cost),
    )
    print(f"answered: {automation.log_line(described, usage, cost)}")
    print(f"result -> {work / RESULT}")
    return OK


def _read_tests(pr_root: Path, changed: list[str], max_chars: int) -> tuple[dict[str, str], int]:
    """The changed test files' text, by path, and how many paths were refused.

    The list comes from `git diff` over the PR, so every path in it is the
    branch's to choose. One that is absolute, climbs out with `..`, or
    resolves outside `pr_root` (a link) is refused unread. A file is read
    only up to one character past the cap: past that it is omitted whole
    anyway, and reading all of it would be the branch choosing our memory.
    """
    root = pr_root.resolve()
    files: dict[str, str] = {}
    refused = 0
    for raw in changed:
        path = raw.strip()
        if not path or not coverage.is_test_path(path) or path in files:
            continue
        if (
            PurePosixPath(path).is_absolute()
            or PureWindowsPath(path).is_absolute()
            or PureWindowsPath(path).drive
            or ".." in PurePosixPath(path.replace("\\", "/")).parts
        ):
            refused += 1
            continue
        target = (root / path).resolve()
        if not target.is_relative_to(root):
            refused += 1
            continue
        if not target.is_file():
            continue  # not a file in this checkout: nothing to read
        try:
            with target.open(encoding="utf-8", errors="replace") as fh:
                files[path] = fh.read(max_chars + 1)
        except OSError:
            continue
    return files, refused


def _result(
    task_id: str,
    criteria: list[str],
    pinned: list[list[str]],
    unverified: int,
    tests: dict[str, str],
    omitted: list[str],
    model: str | None,
    usage: dict[str, Any] | None,
    cost: float | None,
) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "criteria": criteria,
        "pinned": pinned,
        "unverified": unverified,
        "tests": list(tests),
        "omitted": omitted,
        "model": model,
        "usage": usage,
        "cost_usd": cost,
    }


# --------------------------------------------------------------------------- render


def render(args: argparse.Namespace) -> int:
    work = Path(args.work)
    comment_out = Path(args.comment_out)
    summary = Path(args.summary) if args.summary else None

    # First, before anything can fail: a comment file from an earlier step or
    # run must never be posted as this run's.
    try:
        comment_out.unlink(missing_ok=True)
    except OSError as exc:
        return _give_up(summary, f"cannot clear {comment_out.name}: {exc}", USAGE)

    if not (work / RESULT).is_file():
        print("no result to render; no comment")
        return OK
    try:
        result = json.loads((work / RESULT).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        return _give_up(summary, f"cannot read {RESULT}: {exc}", FAILED)
    criteria = result.get("criteria") if isinstance(result, dict) else None
    pinned = result.get("pinned") if isinstance(result, dict) else None
    if not (
        isinstance(criteria, list)
        and isinstance(pinned, list)
        and len(pinned) == len(criteria)
        and all(isinstance(p, list) for p in pinned)
    ):
        return _give_up(summary, f"{RESULT} is not a coverage result", FAILED)
    if not args.pr_number.isdigit():
        return _give_up(summary, f"not a PR number: {automation.inline(args.pr_number)!r}", USAGE)

    model = result.get("model") if isinstance(result.get("model"), str) else None
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else None
    cost = result.get("cost_usd") if isinstance(result.get("cost_usd"), float) else None
    unverified = automation.count(result.get("unverified"))
    omitted = [str(p) for p in result.get("omitted") or [] if isinstance(p, str)]
    unpinned = [n for n, tests in enumerate(pinned, 1) if not tests]
    all_pinned = bool(criteria) and not unpinned

    jev = _jev(work / JEV_ANSWERS)
    choice = jev["choice"]
    record = {
        "automation": "coverage",
        "task": _cut(result.get("task_id")),
        "pr": int(args.pr_number),
        "head_sha": _cut(args.head_sha),
        "run_url": _cut(args.run_url, 300),
        "haiku": {
            "model": _cut(model),
            "all_pinned": all_pinned,
            "unpinned": unpinned,
            "unverified": unverified,
            "cost_usd": cost,
        },
        "jev": {
            "model": _cut(jev["model"]),
            "choice": choice,
            "confidence": jev["confidence"] if choice is not None else None,
            "cost_usd": jev["cost_usd"],
        },
        # Only when both answered: jev's yes/no against what Haiku's list says.
        "agree": None if choice is None or model is None else (choice == "yes") == all_pinned,
    }

    comment = coverage.render(
        criteria,
        pinned,
        usage=usage,
        cost=cost,
        model=model,
        unverified=unverified,
        omitted=omitted,
        jev=jev if choice is not None else None,
        record=record,
        head_sha=args.head_sha,
        run_url=args.run_url,
    )
    _write(comment_out, comment)

    covered = len(criteria) - len(unpinned)
    lines = [f"- {covered} of {len(criteria)} criteria pinned (Haiku)"]
    for n, tests in enumerate(pinned, 1):
        named = ", ".join(f"`{automation.inline(t)}`" for t in tests[:3]) or "not pinned"
        lines.append(f"- criterion {n}: {named}")
    lines.append(f"- Haiku, all pinned: {'yes' if all_pinned else 'no'}")
    if choice is None:
        lines.append("- jev, all pinned: no answer")
    else:
        lines.append(
            f"- jev, all pinned: {choice} (confidence {jev['confidence']:.2f}, "
            f"{automation.cost_text(jev['cost_usd'], 7)})"
        )
    lines.append(f"- agree: {record['agree']}")
    _summarize(summary, lines)
    print(f"comment -> {comment_out}")
    return OK


def _jev(path: Path) -> dict[str, Any]:
    """jev's answer from ask_jev.py's `--out`, re-checked against the two
    options asked. A missing, failed or unreadable file is no answer: jev is
    in shadow, and its silence must never stop the comment."""
    doc: Any = {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        pass
    doc = doc if isinstance(doc, dict) else {}
    answers = doc.get("answers") if isinstance(doc.get("answers"), dict) else {}
    choice, confidence = decision.choice(answers, coverage.JEV_QUESTION, JEV_OPTIONS)
    cost = doc.get("cost_usd")
    return {
        "model": doc.get("model") if isinstance(doc.get("model"), str) else None,
        "choice": choice,
        "confidence": confidence,
        "cost_usd": cost if isinstance(cost, int | float) and not isinstance(cost, bool) else None,
    }


def _cut(value: object, limit: int = _MAX_RECORD_CHARS) -> str | None:
    return value[:limit] if isinstance(value, str) else None


# --------------------------------------------------------------------------- reporting


def _give_up(summary: Path | None, error: str, status: int, what: str = "") -> int:
    """Say why no result was written, and return `status`."""
    _summarize(summary, [f"- no result: `{automation.inline(error)}`"])
    print(f"::error::{what + ': ' if what else ''}{automation.inline(error)}", file=sys.stderr)
    return status


def _summarize(path: Path | None, lines: list[str]) -> None:
    """Append a readable account of the run to `path` (the job's step summary)."""
    if path is None:
        return
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(["### Criteria coverage", "", *lines]) + "\n\n")
    except OSError as exc:
        print(f"::warning::cannot write the summary: {exc}", file=sys.stderr)


# --------------------------------------------------------------------------- plumbing


def _config() -> dict[str, Any]:
    try:
        loaded = json.loads((AI_ROOT / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json(path: Path, doc: dict[str, Any]) -> None:
    _write(path, json.dumps(doc, indent=2) + "\n")


if __name__ == "__main__":
    sys.exit(main())
