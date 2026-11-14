#!/usr/bin/env python3
"""Mark the CI failure summary comment fixed, after a green run.

  ci_summary_fixed.py --body-in old.md --head-sha SHA --run-url URL \
                      --comment-out new.md

Run by the `mark-fixed` job of `.github/workflows/ci-summary.yml` from main's
copy, when `test-agent` passes on an `agent/*` PR. The job has fetched the
bot's existing summary comment into `--body-in`; `agentlib.cisummary` puts a
`**Fixed:**` line under its marker, and this script writes the result to
`--comment-out` for the workflow to PATCH back. No model, no key, no network.

Fail quiet, as `ci_summary.py` does: any `--comment-out` file left from before
is deleted first, and when there is nothing to mark none is written.

Exit 0 a new body was written; 1 nothing to mark (the body is not the
summary, or the sha or URL is unusable); 2 the invocation itself is wrong.

Stdlib only: this runs in a CI step that installs nothing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Inserted explicitly: the workflow runs this with `python -I`, which keeps
# the script's own directory (and the working directory) off sys.path.
AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from agentlib import cisummary

OK, NOTHING, USAGE = 0, 1, 2


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ci_summary_fixed.py", description=__doc__.splitlines()[0])
    ap.add_argument("--body-in", required=True, help="the existing summary comment's body")
    ap.add_argument("--head-sha", required=True, help="the green run's commit")
    ap.add_argument("--run-url", required=True, help="the green run's page")
    ap.add_argument("--comment-out", required=True, help="where to write the new body")
    args = ap.parse_args(argv)

    comment_out = Path(args.comment_out)
    # First, before anything can fail: a file from an earlier step or run
    # must never be posted as this run's.
    try:
        comment_out.unlink(missing_ok=True)
    except OSError as exc:
        print(f"::error::cannot clear {comment_out.name}: {exc}", file=sys.stderr)
        return USAGE

    try:
        body = Path(args.body_in).read_text(encoding="utf-8")
    except OSError as exc:
        print(f"::error::cannot read the comment body: {exc}", file=sys.stderr)
        return USAGE

    marked = cisummary.mark_fixed(body, args.head_sha, args.run_url)
    if marked is None:
        print("::notice::nothing to mark: not the summary, or an unusable sha or run url")
        return NOTHING

    comment_out.parent.mkdir(parents=True, exist_ok=True)
    comment_out.write_text(marked, encoding="utf-8")
    print(f"comment -> {comment_out}")
    return OK


if __name__ == "__main__":
    sys.exit(main())
