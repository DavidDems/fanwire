#!/usr/bin/env python3
"""Write the CI failure summary comment for a failed `agent/*` PR run.

  ci_summary.py --log failed.log --jobs jobs.json --head-branch agent/X-001 \
                --run-url URL --comment-out comment.md --summary FILE

Run by `.github/workflows/ci-summary.yml` from main's copy, after `gh run
view --log-failed` and `--json jobs` have fetched the failed run's evidence.
`agentlib.cisummary` does the parsing and the rendering; this script makes the
one model call in between and writes the comment file the workflow posts.

work-modes.md "Constraints every automation must keep", as this script keeps
them:
  - only a task branch: `--head-branch` must be `agent/<task id>` in the
    guard's own pattern, or nothing is called and nothing is written.
  - bounded spend: a capped log tail, a `max_tokens` cap, and exactly one
    request. No retry, on any status: the next CI run is the retry. A runner
    failure (ciresult's `infrastructure`) needs no model at all.
  - fail quiet: any comment file left from before is deleted first, and on
    any error no new one is written. No comment beats a wrong or half one.
  - recorded cost: priced from the response's own `usage`, cache tokens
    included (D6), in the comment footer, the job summary and one job-log
    line. A call whose answer is unusable was billed all the same, so its
    cost and the response's shape are recorded too, though no comment is.
  - the key is never printed: it goes into one header and nowhere else, and
    is redacted from any remote text before that text is written anywhere.

Exit 0 a comment was written; 1 the call failed or gave no answer (no
comment); 2 the invocation itself is wrong (no call, no comment).

Stdlib only, no SDK: this runs in a CI step that installs nothing, and the
request is one POST with a JSON body.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request  # noqa: F401  (the tests fake `ci_summary.urllib.request.urlopen`)
from pathlib import Path
from typing import Any

# Inserted explicitly: the workflow runs this with `python -I`, which keeps
# the script's own directory (and the working directory) off sys.path.
AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from agentlib import automation, ciresult, cisummary
from agentlib.guard import TASK_ID_SAFE

OK, FAILED, USAGE = 0, 1, 2
PROVIDER = "anthropic"
BRANCH_PREFIX = "agent/"
USER_AGENT = "fanwire-ci-summary/1.0"
# The one request may take this long at most, whatever --timeout says: the
# job's own timeout is five minutes.
MAX_TIMEOUT = 60.0

INFRA_CAUSE = (
    "The runner itself failed (a Docker, disk or network error in the log), "
    "not the code under test; re-running the checks is likely all it needs."
)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ci_summary.py", description=__doc__.splitlines()[0])
    ap.add_argument("--log", required=True, help="`gh run view --log-failed` output")
    ap.add_argument("--jobs", required=True, help="`gh run view --json jobs` output")
    ap.add_argument("--head-branch", required=True, help="the failed run's branch")
    ap.add_argument("--run-url", required=True, help="the failed run's page, for the footer")
    ap.add_argument("--comment-out", required=True, help="where to write the comment body")
    ap.add_argument("--summary", help="a markdown file to append a readable account to")
    ap.add_argument("--timeout", type=float, default=30.0, help="seconds for the one request")
    args = ap.parse_args(argv)

    comment_out = Path(args.comment_out)
    summary = Path(args.summary) if args.summary else None

    # First, before anything can fail: a comment file from an earlier step or
    # run must never be posted as this run's.
    try:
        comment_out.unlink(missing_ok=True)
    except OSError as exc:
        return _give_up(summary, f"cannot clear {comment_out.name}: {exc}", USAGE)

    branch = args.head_branch
    task_id = branch[len(BRANCH_PREFIX) :] if branch.startswith(BRANCH_PREFIX) else ""
    if not TASK_ID_SAFE.fullmatch(task_id):
        # The workflow's `if:` already admits only `agent/*`; this is the
        # check that the rest is a task id, in the guard's own pattern.
        return _give_up(summary, f"not a task branch: {automation.inline(branch)!r}", USAGE)

    try:
        raw_log = Path(args.log).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return _give_up(summary, f"cannot read the log: {exc}", FAILED)
    try:
        ran = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        ran = None  # the comment names no jobs; it still says what failed

    jobs = cisummary.failed_jobs(ran)
    distilled = ciresult.distill(raw_log, "failure", task_id, 1)

    if distilled.get("origin") == "infrastructure":
        # ciresult already knows; a model would add only cost.
        comment = cisummary.render(
            distilled, jobs, INFRA_CAUSE, usage=None, cost=None, model=None, run_url=args.run_url
        )
        _write(comment_out, comment)
        _summarize(summary, ["- infrastructure failure: no model was asked"])
        print(f"comment -> {comment_out}")
        return OK

    config = _config()
    provider = config.get("providers", {}).get(PROVIDER, {})
    settings = config.get("automations", {}).get("ci_summary", {})
    model = settings.get("model")
    endpoint = provider.get("endpoint")
    version = provider.get("api_version")
    key_var = provider.get("api_key_env")
    if not all(isinstance(v, str) and v for v in (model, endpoint, version, key_var)):
        return _give_up(summary, "config.json has no usable automations.ci_summary", USAGE)
    max_tokens = min(
        automation.positive(settings.get("max_tokens"), cisummary.MAX_TOKENS), cisummary.MAX_TOKENS
    )
    max_chars = min(
        automation.positive(settings.get("max_log_chars"), cisummary.MAX_LOG_CHARS),
        cisummary.MAX_LOG_CHARS,
    )

    try:
        system = (AI_ROOT / "prompts" / "ci-summary.md").read_text(encoding="utf-8").strip()
    except OSError as exc:
        return _give_up(summary, f"cannot read the system prompt: {exc}", USAGE)

    api_key = os.environ.get(key_var, "").strip()
    if not api_key:
        return _give_up(summary, f"{key_var} is not set", FAILED)

    payload = cisummary.request_body(
        distilled,
        jobs,
        cisummary.log_tail(raw_log, max_chars),
        model=model,
        max_tokens=max_tokens,
        system=system,
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
    cause = cisummary.read_cause(body)
    if cause is None:
        error = "the model gave no usable answer"
        _summarize(
            summary,
            [f"- no comment: `{error}`", f"- response: `{automation.inline(described)}`"]
            + automation.call_lines(answered_by, usage, cost),
        )
        print(f"no usable answer: {automation.log_line(described, usage, cost)}")
        print(f"::error::{error}", file=sys.stderr)
        return FAILED

    comment = cisummary.render(
        distilled,
        jobs,
        automation.redact(cause, api_key),
        usage=usage,
        cost=cost,
        model=answered_by,
        run_url=args.run_url,
    )
    _write(comment_out, comment)
    _summarize(summary, automation.call_lines(answered_by, usage, cost))
    print(f"answered: {automation.log_line(described, usage, cost)}")
    print(f"comment -> {comment_out}")
    return OK


# --------------------------------------------------------------------------- reporting


def _give_up(summary: Path | None, error: str, status: int, what: str = "") -> int:
    """Say why no comment was written, and return `status`."""
    _summarize(summary, [f"- no comment: `{automation.inline(error)}`"])
    print(f"::error::{what + ': ' if what else ''}{automation.inline(error)}", file=sys.stderr)
    return status


def _summarize(path: Path | None, lines: list[str]) -> None:
    """Append a readable account of the run to `path` (the job's step summary)."""
    if path is None:
        return
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(["### CI failure summary", "", *lines]) + "\n\n")
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


if __name__ == "__main__":
    sys.exit(main())
