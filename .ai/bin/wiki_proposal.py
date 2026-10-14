#!/usr/bin/env python3
"""Propose a wiki update for a merged `agent/*` PR, as a comment holding a patch.

  wiki_proposal.py --task-id X-001 --spec-root tools --repo-root merged \
                   --diff merged.diff --merge-sha SHA --run-url URL \
                   --comment-out comment.md [--summary FILE]

Run by `.github/workflows/wiki-proposal.yml` from main's copy (the PR's base
SHA, at `tools/`), with the merge commit checked out beside it at `merged/`
as data. `agentlib.wikiprop` builds the request, turns the answer into a
patch and renders the comment; this script makes the one model call between
them. The comment is the whole output (the human's option (a), 2026-10-13):
nothing is committed, pushed or branched, here or in the workflow.

work-modes.md "Constraints every automation must keep", as this script keeps
them:
  - only a task: `--task-id` must match the guard's own pattern, or nothing
    is read, called or written. The spec is read from main's copy
    (`--spec-root`).
  - model input is untrusted: only the module files the spec names are read,
    and only from inside `--repo-root` (no absolute path, no `..`, no link
    out). An edit the model proposes becomes part of the patch only if it
    quotes a passage found exactly once in a file it was shown.
  - bounded spend: a capped diff of whole files, a `max_tokens` cap, and
    exactly one request. No retry, on any status. A task whose spec names no
    module file needs no model at all.
  - fail quiet: any comment file left from before is deleted first, and on
    any error no new one is written. No comment beats a wrong or half one.
  - recorded cost: priced from the response's own `usage`, cache tokens
    included (D6), in the comment footer, the job summary and one job-log
    line. A call whose answer is unusable was billed all the same, so its
    cost and the response's shape are recorded too, though no comment is.
  - the key is never printed: it goes into one header and nowhere else, and
    is redacted from any remote text before that text is written anywhere.

Exit 0 a comment was written, or there was nothing to propose against; 1 the
call failed or gave no answer (no comment); 2 the invocation itself is wrong
(no call, no comment).

Stdlib only, no SDK: this runs in a CI step that installs nothing, and the
request is one POST with a JSON body.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request  # noqa: F401  (the tests fake `wiki_proposal.urllib.request.urlopen`)
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

# Inserted explicitly: the workflow runs this with `python -I`, which keeps
# the script's own directory (and the working directory) off sys.path.
AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from agentlib import automation, wikiprop
from agentlib.guard import TASK_ID_SAFE

OK, FAILED, USAGE = 0, 1, 2
PROVIDER = "anthropic"
USER_AGENT = "fanwire-wiki-proposal/1.0"
# The one request may take this long at most, whatever --timeout says: the
# job's own timeout is five minutes.
MAX_TIMEOUT = 60.0
# A module file longer than this is not read at all: a patch made from a cut
# file would not apply, and no module file is anywhere near it.
MAX_MODULE_CHARS = 100_000
# The job summary holds 1 MiB per step; the patch shown there stays well under.
MAX_SUMMARY_PATCH_CHARS = 500_000


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="wiki_proposal.py", description=__doc__.splitlines()[0])
    ap.add_argument("--task-id", required=True, help="the task the merged branch named")
    ap.add_argument("--spec-root", required=True, help="main's checkout, where the spec is read")
    ap.add_argument("--repo-root", required=True, help="the merge commit's checkout, as data")
    ap.add_argument("--diff", required=True, help="the merge commit's diff against main before it")
    ap.add_argument("--merge-sha", required=True, help="the merge commit, for the footer")
    ap.add_argument("--run-url", required=True, help="this run's page, for the footer")
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

    task_id = args.task_id
    if not TASK_ID_SAFE.fullmatch(task_id):
        # The workflow has already checked the branch name in bash; this is
        # the same rule, applied where the id becomes a path.
        return _give_up(summary, f"not a task id: {automation.inline(task_id)!r}", USAGE)

    spec_path = Path(args.spec_root) / ".ai" / "tasks" / task_id / "task.json"
    if not spec_path.is_file():
        # A hand-named agent/ branch, or a task whose spec never reached main:
        # there is nothing to propose against, which is not a failure.
        _summarize(summary, [f"- no spec for `{task_id}` on main; nothing to propose"])
        print(f"no spec for {task_id} on main; nothing to propose")
        return OK
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        return _give_up(summary, f"cannot read the spec: {exc}", FAILED)

    modules, refused = _read_modules(Path(args.repo_root), wikiprop.module_files(spec))
    if refused:
        print(f"::warning::{refused} module path(s) were not read: outside the merged checkout")
    if not modules:
        _summarize(summary, [f"- `{task_id}` names no readable module file: no model asked"])
        print(f"{task_id} names no readable module file; no model asked")
        return OK

    config = _config()
    provider = config.get("providers", {}).get(PROVIDER, {})
    settings = config.get("automations", {}).get("wiki_proposal", {})
    model = settings.get("model")
    endpoint = provider.get("endpoint")
    version = provider.get("api_version")
    key_var = provider.get("api_key_env")
    if not all(isinstance(v, str) and v for v in (model, endpoint, version, key_var)):
        return _give_up(summary, "config.json has no usable automations.wiki_proposal", USAGE)
    max_tokens = min(
        automation.positive(settings.get("max_tokens"), wikiprop.MAX_TOKENS), wikiprop.MAX_TOKENS
    )
    max_chars = min(
        automation.positive(settings.get("max_diff_chars"), wikiprop.MAX_DIFF_CHARS),
        wikiprop.MAX_DIFF_CHARS,
    )

    try:
        raw_diff = Path(args.diff).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return _give_up(summary, f"cannot read the diff: {exc}", USAGE)
    diff_text, omitted = wikiprop.trim_diff(raw_diff, max_chars)

    try:
        system = (AI_ROOT / "prompts" / "wiki-proposal.md").read_text(encoding="utf-8").strip()
    except OSError as exc:
        return _give_up(summary, f"cannot read the system prompt: {exc}", USAGE)

    api_key = os.environ.get(key_var, "").strip()
    if not api_key:
        return _give_up(summary, f"{key_var} is not set", FAILED)

    payload = wikiprop.request_body(
        spec, diff_text, modules, model=model, max_tokens=max_tokens, system=system
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
    proposal = wikiprop.read_answer(body, modules)
    if proposal is None:
        error = "the model gave no usable answer"
        _summarize(
            summary,
            [f"- no comment: `{error}`", f"- response: `{automation.inline(described)}`"]
            + automation.call_lines(answered_by, usage, cost),
        )
        print(f"no usable answer: {automation.log_line(described, usage, cost)}")
        print(f"::error::{error}", file=sys.stderr)
        return FAILED

    proposal["reason"] = automation.redact(proposal["reason"], api_key)
    comment = wikiprop.render(
        task_id,
        proposal,
        omitted=omitted,
        usage=usage,
        cost=cost,
        model=answered_by,
        merge_sha=args.merge_sha,
        run_url=args.run_url,
    )
    _write(comment_out, comment)

    lines = [
        (
            f"- changed: {'yes' if proposal['changed'] else 'no'}; "
            f"{proposal['applied']} edit(s) applied, {proposal['rejected']} refused"
        ),
        f"- reason: {automation.escape(proposal['reason'], wikiprop.MAX_REASON_CHARS)}",
    ]
    if omitted:
        lines.append(f"- {len(omitted)} file(s) of the diff not read, past the input cap")
    lines += automation.call_lines(answered_by, usage, cost)
    patch = proposal["patch"]
    if patch and len(patch) <= MAX_SUMMARY_PATCH_CHARS:
        lines += ["", wikiprop.patch_block(patch)]
    elif patch:
        lines.append(f"- the patch ({len(patch)} characters) is too large even for this summary")
    _summarize(summary, lines)
    print(f"answered: {automation.log_line(described, usage, cost)}")
    print(f"comment -> {comment_out}")
    return OK


def _read_modules(root: Path, paths: list[str]) -> tuple[dict[str, str], int]:
    """The module files' text, by path, and how many paths were refused.

    The paths come from the spec, which a branch once wrote. One that is
    absolute, climbs out with `..`, or resolves outside `root` (a link) is
    refused unread. A file that is missing, unreadable, or longer than
    `MAX_MODULE_CHARS` is skipped: a patch made from a cut file would not
    apply. Read with `newline=""`, so the patch is made against the file's
    real line endings.
    """
    base = root.resolve()
    files: dict[str, str] = {}
    refused = 0
    for path in paths:
        if (
            PurePosixPath(path).is_absolute()
            or PureWindowsPath(path).is_absolute()
            or PureWindowsPath(path).drive
            or ".." in PurePosixPath(path.replace("\\", "/")).parts
        ):
            refused += 1
            continue
        target = (base / path).resolve()
        if not target.is_relative_to(base):
            refused += 1
            continue
        if not target.is_file():
            continue
        try:
            with target.open(encoding="utf-8", newline="") as fh:
                text = fh.read(MAX_MODULE_CHARS + 1)
        except (OSError, UnicodeDecodeError):
            continue
        if len(text) <= MAX_MODULE_CHARS:
            files[path] = text
    return files, refused


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
            fh.write("\n".join(["### Wiki update proposal", "", *lines]) + "\n\n")
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
