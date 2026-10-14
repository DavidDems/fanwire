#!/usr/bin/env python3
"""Check whether a task spec names things the code on main no longer has.

  spec_drift.py ask    --task-id X-001 --repo-root DIR --work DIR [--summary FILE]
  spec_drift.py render --work DIR --run-url URL --comment-out comment.md \
                       [--pr-number N] [--summary FILE]

Run by `.github/workflows/spec-drift.yml`, which a person dispatches before a
unit, from main's checkout (`--repo-root`). `agentlib.drift` checks the paths
and links, builds the request, checks the answer and renders the report; this
script makes the one model call between them.

Two subcommands, because `jev` is asked in between, in its own step that
holds only its own key: `ask` checks the paths, makes the Haiku call and
writes `DIR/drift.json` and the state `jev` is asked about
(`DIR/jev-state.txt`); `ask_jev.py` writes `DIR/jev.json`; `render` reads both
and writes the report, with the two answers side by side in its hidden shadow
record.

work-modes.md "Constraints every automation must keep", as this script keeps
them:
  - only a task: `--task-id` must match the guard's own pattern, or nothing
    is read, called or written, and a task with no spec under `--repo-root`
    is refused: a person typed the id, and a wrong one should say so.
  - model input is untrusted: the spec, the brief and the code are fenced as
    data, and a name the model says is missing is kept only if no source
    file outside the tests has it.
  - bounded spend: a capped input of whole files, a `max_tokens` cap, and
    exactly one request. No retry, on any status: the person dispatching is
    the retry.
  - fail quiet, but keep what was free: any result or state file left from
    before is deleted first. The path and link findings are made before the
    call, so a failed or unusable call still writes them, marked as having
    no model answer, and `jev` is not asked. Nothing is ever guessed.
  - recorded cost: priced from the response's own `usage`, cache tokens
    included (D6), in the report footer, the job summary and one job-log
    line. A call whose answer is unusable was billed all the same, so its
    cost and the response's shape are recorded too.
  - the key is never printed: it goes into one header and nowhere else, and
    is redacted from any remote text before that text is written anywhere.

Exit 0 a result (or report) was written; 1 the call failed or gave no answer
(the free findings are still written); 2 the invocation itself is wrong.

Stdlib only, no SDK: this runs in a CI step that installs nothing, and the
request is one POST with a JSON body.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request  # noqa: F401  (the tests fake `spec_drift.urllib.request.urlopen`)
from pathlib import Path
from typing import Any

# Inserted explicitly: the workflow runs this with `python -I`, which keeps
# the script's own directory (and the working directory) off sys.path.
AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from agentlib import automation, decision, drift
from agentlib.guard import TASK_ID_SAFE

OK, FAILED, USAGE = 0, 1, 2
PROVIDER = "anthropic"
USER_AGENT = "fanwire-spec-drift/1.0"
# The one request may take this long at most, whatever --timeout says: the
# job's own timeout is five minutes.
MAX_TIMEOUT = 60.0

# The files `ask` writes and `render` reads, under --work. `jev.json` is
# ask_jev.py's --out.
RESULT = "drift.json"
JEV_STATE = "jev-state.txt"
JEV_ANSWERS = "jev.json"
JEV_OPTIONS = ("yes", "no")
# Remote-chosen strings in the shadow record are cut to this, so its one line
# stays short.
_MAX_RECORD_CHARS = 120


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="spec_drift.py", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="command", required=True)

    a = sub.add_parser("ask", help="check the paths, then ask the model about the names")
    a.add_argument("--task-id", required=True, help="the task whose spec is checked")
    a.add_argument("--repo-root", required=True, help="main's checkout: the spec and the code")
    a.add_argument("--work", required=True, help="where the result and jev's state go")
    a.add_argument("--summary", help="a markdown file to append a readable account to")
    a.add_argument("--timeout", type=float, default=30.0, help="seconds for the one request")

    r = sub.add_parser("render", help="write the report from the result and jev's answer")
    r.add_argument("--work", required=True, help="where `ask` and ask_jev.py wrote")
    r.add_argument("--run-url", required=True, help="this run's page, for the footer")
    r.add_argument("--comment-out", required=True, help="where to write the report")
    r.add_argument("--pr-number", help="the task's open PR, for the shadow record")
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
        # The workflow has already checked the input in bash; this is the
        # same rule, applied where the id becomes a path.
        return _give_up(summary, f"not a task id: {automation.inline(task_id)!r}", USAGE)

    root = Path(args.repo_root).resolve()
    task_dir = root / ".ai" / "tasks" / task_id
    if not (task_dir / "task.json").is_file():
        # Dispatched by a person, so a missing spec is a mistyped id, not a
        # task branch with nothing to check: say so.
        return _give_up(summary, f"no spec for {task_id} on main", USAGE)
    try:
        spec = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        return _give_up(summary, f"cannot read the spec: {exc}", FAILED)
    if not isinstance(spec, dict):
        return _give_up(summary, "the spec is not a JSON object", FAILED)
    try:
        brief = (task_dir / "brief.md").read_text(encoding="utf-8")
    except FileNotFoundError:
        brief = ""
    except (OSError, UnicodeDecodeError) as exc:
        return _give_up(summary, f"cannot read the brief: {exc}", FAILED)

    # The free half. From here on every way out writes these findings.
    findings = drift.check_paths(task_id, spec, brief, root)

    def no_answer(error: str, status: int, usage: Any = None, cost: Any = None) -> int:
        _write_json(work / RESULT, _result(task_id, findings, [], 0, [], None, usage, cost, error))
        return status

    config = _config()
    provider = config.get("providers", {}).get(PROVIDER, {})
    settings = config.get("automations", {}).get("spec_drift", {})
    model = settings.get("model")
    endpoint = provider.get("endpoint")
    version = provider.get("api_version")
    key_var = provider.get("api_key_env")
    if not all(isinstance(v, str) and v for v in (model, endpoint, version, key_var)):
        error = "config.json has no usable automations.spec_drift"
        _give_up(summary, error, USAGE)
        return no_answer(error, USAGE)
    max_tokens = min(
        automation.positive(settings.get("max_tokens"), drift.MAX_TOKENS), drift.MAX_TOKENS
    )
    max_chars = min(
        automation.positive(settings.get("max_context_chars"), drift.MAX_CONTEXT_CHARS),
        drift.MAX_CONTEXT_CHARS,
    )

    try:
        system = (AI_ROOT / "prompts" / "spec-drift.md").read_text(encoding="utf-8").strip()
    except OSError as exc:
        error = f"cannot read the system prompt: {exc}"
        _give_up(summary, error, USAGE)
        return no_answer(error, USAGE)

    api_key = os.environ.get(key_var, "").strip()
    if not api_key:
        error = f"{key_var} is not set"
        _give_up(summary, error, FAILED)
        return no_answer(error, FAILED)

    context, omitted = drift.context_files(spec, brief, root, max_chars)
    payload = drift.request_body(
        spec, brief, context, findings, model=model, max_tokens=max_tokens, system=system
    )
    timeout = min(max(args.timeout, 1.0), MAX_TIMEOUT)
    body, error = automation.post(
        endpoint, version, api_key, payload, timeout, user_agent=USER_AGENT
    )
    if error is not None:
        error = automation.redact(error, api_key)
        _give_up(summary, error, FAILED, "model call failed")
        return no_answer(error, FAILED)

    # Billed whether or not the answer is usable, so priced before it is read.
    usage, answered_by, cost = automation.priced(body, model, config, PROVIDER)
    described = automation.redact(automation.describe_response(body), api_key)
    answer = drift.read_answer(body, root)
    if answer is None:
        error = "the model gave no usable answer"
        _summarize(
            summary,
            [f"- no answer: `{error}`", f"- response: `{automation.inline(described)}`"]
            + automation.call_lines(answered_by, usage, cost),
        )
        print(f"no usable answer: {automation.log_line(described, usage, cost)}")
        print(f"::error::{error}", file=sys.stderr)
        return no_answer(error, FAILED, usage, cost)

    names, dropped = answer
    _write_json(
        work / RESULT,
        _result(task_id, findings, names, dropped, omitted, answered_by, usage, cost, None),
    )
    _write(work / JEV_STATE, drift.jev_state(spec, brief, context, findings))
    _summarize(
        summary,
        [
            (
                f"- {len(findings)} path or link problem(s), {len(names)} missing name(s), "
                f"{dropped} claimed name(s) dropped"
            )
        ]
        + automation.call_lines(answered_by, usage, cost),
    )
    print(f"answered: {automation.log_line(described, usage, cost)}")
    print(f"result -> {work / RESULT}")
    return OK


def _result(
    task_id: str,
    findings: list[dict[str, str]],
    names: list[dict[str, str]],
    dropped: int,
    omitted: list[str],
    model: str | None,
    usage: dict[str, Any] | None,
    cost: float | None,
    error: str | None,
) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "findings": findings,
        "names": names,
        "dropped": dropped,
        "omitted": omitted,
        "model": model,
        "usage": usage,
        "cost_usd": cost,
        "error": error,
    }


# --------------------------------------------------------------------------- render


def render(args: argparse.Namespace) -> int:
    work = Path(args.work)
    comment_out = Path(args.comment_out)
    summary = Path(args.summary) if args.summary else None

    # First, before anything can fail: a report file from an earlier step or
    # run must never be posted as this run's.
    try:
        comment_out.unlink(missing_ok=True)
    except OSError as exc:
        return _give_up(summary, f"cannot clear {comment_out.name}: {exc}", USAGE)

    pr_number = args.pr_number
    if pr_number is not None and not pr_number.isdigit():
        return _give_up(summary, f"not a PR number: {automation.inline(pr_number)!r}", USAGE)

    if not (work / RESULT).is_file():
        print("no result to render; no report")
        return OK
    try:
        result = json.loads((work / RESULT).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        return _give_up(summary, f"cannot read {RESULT}: {exc}", FAILED)
    findings = result.get("findings") if isinstance(result, dict) else None
    names = result.get("names") if isinstance(result, dict) else None
    if not (
        isinstance(findings, list)
        and isinstance(names, list)
        and all(isinstance(f, dict) for f in findings)
        and all(isinstance(n, dict) for n in names)
    ):
        return _give_up(summary, f"{RESULT} is not a drift result", FAILED)

    task_id = result.get("task_id") if isinstance(result.get("task_id"), str) else "?"
    model = result.get("model") if isinstance(result.get("model"), str) else None
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else None
    cost = result.get("cost_usd") if isinstance(result.get("cost_usd"), float) else None
    dropped = automation.count(result.get("dropped"))
    omitted = [str(p) for p in result.get("omitted") or [] if isinstance(p, str)]
    # Haiku's yes/no, as its list and the path check together say it. None
    # when the model gave no answer: the free half alone is not its verdict.
    matches = None if model is None else not findings and not names

    jev = _jev(work / JEV_ANSWERS)
    choice = jev["choice"]
    record = {
        "automation": "spec_drift",
        "task": _cut(task_id),
        "pr": int(pr_number) if pr_number is not None else None,
        "run_url": _cut(args.run_url, 300),
        "haiku": {
            "model": _cut(model),
            "matches": matches,
            "findings": len(findings),
            "names": [_cut(n.get("name")) for n in names],
            "dropped": dropped,
            "cost_usd": cost,
        },
        "jev": {
            "model": _cut(jev["model"]),
            "choice": choice,
            "confidence": jev["confidence"] if choice is not None else None,
            "cost_usd": jev["cost_usd"],
        },
        # Only when both answered: jev's yes/no against what Haiku's says.
        "agree": None if choice is None or matches is None else (choice == "yes") == matches,
    }

    report = drift.render(
        task_id,
        findings,
        names,
        dropped=dropped,
        omitted=omitted,
        usage=usage,
        cost=cost,
        model=model,
        jev=jev if choice is not None else None,
        record=record,
        run_url=args.run_url,
    )
    _write(comment_out, report)
    # The same report, so a run with no open PR still shows it; it carries
    # its own heading.
    _append(summary, report + "\n")
    print(f"report -> {comment_out}")
    return OK


def _jev(path: Path) -> dict[str, Any]:
    """jev's answer from ask_jev.py's `--out`, re-checked against the two
    options asked. A missing, failed or unreadable file is no answer: jev is
    in shadow, and its silence must never stop the report."""
    doc: Any = {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        pass
    doc = doc if isinstance(doc, dict) else {}
    answers = doc.get("answers") if isinstance(doc.get("answers"), dict) else {}
    choice, confidence = decision.choice(answers, drift.JEV_QUESTION, JEV_OPTIONS)
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
    """Say why there is no answer, and return `status`."""
    _summarize(summary, [f"- no answer: `{automation.inline(error)}`"])
    print(f"::error::{what + ': ' if what else ''}{automation.inline(error)}", file=sys.stderr)
    return status


def _summarize(path: Path | None, lines: list[str]) -> None:
    """Append a readable account of the run to `path` (the job's step summary)."""
    _append(path, "\n".join(["### Spec drift", "", *lines]) + "\n\n")


def _append(path: Path | None, text: str) -> None:
    if path is None:
        return
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(text)
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
