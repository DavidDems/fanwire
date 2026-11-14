#!/usr/bin/env python3
"""Read a Director PR's diff for safety regressions, as one advisory comment.

  director_review.py --diff pr.diff --head-sha SHA --run-url URL \
                     --comment-out comment.md [--summary FILE]

Run by `.github/workflows/director-review.yml` from main's copy (`github.sha`,
at `tools/`), with the PR's diff taken beforehand, by a step that holds no
credential, from the PR checked out beside it as data. `agentlib.directorreview`
builds the request, checks the answer and renders the comment; this script
makes the one model call between them. The references (`philosophy.md`,
`threat-model.md`) are read from the copy this script runs from, never the PR.

work-modes.md "Constraints every automation must keep", as this script keeps
them:
  - model input is untrusted: the diff is fenced and capped, and a finding
    is shown only if it names a path the diff showed and a grade that drops.
  - bounded spend: a capped diff of whole files, a `max_tokens` cap, and
    exactly one request. No retry, on any status. An empty diff needs no
    model at all.
  - fail quiet: any comment file left from before is deleted first, and on
    any error no new one is written. The workflow step that runs this may
    fail without failing the job: the review fails nothing, its own errors
    included.
  - recorded cost: priced from the response's own `usage`, cache tokens
    included (D6), in the comment footer, the job summary and one job-log
    line. A call whose answer is unusable was billed all the same, so its
    cost and the response's shape are recorded too, though no comment is.
  - the key is never printed: it goes into one header and nowhere else, and
    is redacted from any remote text before that text is written anywhere.

Exit 0 a comment was written, or there was nothing to read; 1 the call
failed or gave no answer (no comment); 2 the invocation itself is wrong (no
call, no comment).

Stdlib only, no SDK: this runs in a CI step that installs nothing, and the
request is one POST with a JSON body.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request  # noqa: F401  (the tests fake `director_review.urllib.request.urlopen`)
from pathlib import Path
from typing import Any

# Inserted explicitly: the workflow runs this with `python -I`, which keeps
# the script's own directory (and the working directory) off sys.path.
AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from agentlib import automation, directorreview

OK, FAILED, USAGE = 0, 1, 2
PROVIDER = "anthropic"
USER_AGENT = "fanwire-director-review/1.0"
# The one request may take this long at most, whatever --timeout says: the
# job's own timeout is five minutes, and Sonnet reading 40K tokens is slower
# than Haiku.
MAX_TIMEOUT = 120.0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="director_review.py", description=__doc__.splitlines()[0])
    ap.add_argument("--diff", required=True, help="the PR's diff against its base, as data")
    ap.add_argument("--head-sha", required=True, help="the PR's head commit, for the footer")
    ap.add_argument("--run-url", required=True, help="this run's page, for the footer")
    ap.add_argument("--comment-out", required=True, help="where to write the comment body")
    ap.add_argument("--summary", help="a markdown file to append a readable account to")
    ap.add_argument("--timeout", type=float, default=90.0, help="seconds for the one request")
    args = ap.parse_args(argv)

    comment_out = Path(args.comment_out)
    summary = Path(args.summary) if args.summary else None

    # First, before anything can fail: a comment file from an earlier step or
    # run must never be posted as this run's.
    try:
        comment_out.unlink(missing_ok=True)
    except OSError as exc:
        return _give_up(summary, f"cannot clear {comment_out.name}: {exc}", USAGE)

    try:
        raw_diff = Path(args.diff).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return _give_up(summary, f"cannot read the diff: {exc}", USAGE)
    if not raw_diff.strip():
        _summarize(summary, ["- the diff is empty: no model asked"])
        print("the diff is empty; no model asked")
        return OK

    config = _config()
    provider = config.get("providers", {}).get(PROVIDER, {})
    settings = config.get("automations", {}).get("director_review", {})
    model = settings.get("model")
    endpoint = provider.get("endpoint")
    version = provider.get("api_version")
    key_var = provider.get("api_key_env")
    if not all(isinstance(v, str) and v for v in (model, endpoint, version, key_var)):
        return _give_up(summary, "config.json has no usable automations.director_review", USAGE)
    max_tokens = min(
        automation.positive(settings.get("max_tokens"), directorreview.MAX_TOKENS),
        directorreview.MAX_TOKENS,
    )
    max_chars = min(
        automation.positive(settings.get("max_diff_chars"), directorreview.MAX_DIFF_CHARS),
        directorreview.MAX_DIFF_CHARS,
    )
    diff_text, omitted = directorreview.trim_diff(raw_diff, max_chars)

    try:
        system = (AI_ROOT / "prompts" / "director-review.md").read_text(encoding="utf-8").strip()
        references = {
            name: (AI_ROOT.parent / name).read_text(encoding="utf-8")
            for name in directorreview.REFERENCES
        }
    except OSError as exc:
        return _give_up(summary, f"cannot read main's prompt or references: {exc}", USAGE)

    api_key = os.environ.get(key_var, "").strip()
    if not api_key:
        return _give_up(summary, f"{key_var} is not set", FAILED)

    payload = directorreview.request_body(
        diff_text, omitted, references, model=model, max_tokens=max_tokens, system=system
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
    review = directorreview.read_answer(body, directorreview.paths_in(diff_text))
    if review is None:
        error = "the model gave no usable answer"
        _summarize(
            summary,
            [f"- no comment: `{error}`", f"- response: `{automation.inline(described)}`"]
            + automation.call_lines(answered_by, usage, cost),
        )
        print(f"no usable answer: {automation.log_line(described, usage, cost)}")
        print(f"::error::{error}", file=sys.stderr)
        return FAILED

    for finding in review["findings"]:
        finding["property"] = automation.redact(finding["property"], api_key)
        finding["reason"] = automation.redact(finding["reason"], api_key)
    comment = directorreview.render(
        review,
        omitted=omitted,
        usage=usage,
        cost=cost,
        model=answered_by,
        head_sha=args.head_sha,
        run_url=args.run_url,
    )
    _write(comment_out, comment)

    lines = [f"- {len(review['findings'])} finding(s) kept, {review['dropped']} dropped"]
    for finding in review["findings"]:
        lines.append(
            f"  - `{automation.inline(finding['path'])}`: {finding['before']} → {finding['after']}"
        )
    if omitted:
        lines.append(f"- {len(omitted)} file(s) of the diff not read, past the input cap")
    lines += automation.call_lines(answered_by, usage, cost)
    _summarize(summary, lines)
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
            fh.write("\n".join(["### Director review", "", *lines]) + "\n\n")
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
