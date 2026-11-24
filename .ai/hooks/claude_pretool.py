#!/usr/bin/env python3
"""Claude Code PreToolUse hook for the Bash tool (see `.claude/settings.json`).

Reads the hook JSON from stdin. Exit 2 with the reason on stderr refuses the
call; exit 0 allows it.

* `git stash` (any subcommand) is refused: the stash stack is shared by every
  worktree of a clone, so another session's work can be popped or lost.
  Fail-closed: input this script cannot parse is refused.
* `docker compose run` is checked against host ports already bound on
  localhost (`agentlib.localguards`). Fail-open: any error in that check
  allows the command, so a bug here never blocks real work.

Stdlib only; advisory, like `.ai/hooks/` generally (no pipeline path relies on it).
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

STASH_REASON = (
    "Refused: `git stash` is not allowed in agent sessions. The stash stack is shared by every "
    "worktree of this clone, so a stash made here can be popped or dropped by another session. "
    "Commit to a branch (or a throwaway WIP commit) in your own worktree instead."
)


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("payload is not an object")
        if payload.get("tool_name") != "Bash":
            return 0
        command = (payload.get("tool_input") or {}).get("command") or ""
        if not isinstance(command, str):
            raise ValueError("command is not a string")
        from agentlib import localguards

        if localguards.stash_use(command):
            print(STASH_REASON, file=sys.stderr)
            return 2
    except Exception as exc:  # fail closed for the stash guard
        print(f"Refused: the pre-tool-use hook could not check this call ({exc}).", file=sys.stderr)
        return 2

    try:
        cwd = payload.get("cwd") or os.getcwd()
        collisions = localguards.run_collisions(command, cwd)
    except Exception:  # fail open: never block on a bug in the pre-flight
        return 0
    if collisions:
        print("Refused: `docker compose run` would collide on host ports.", file=sys.stderr)
        for c in collisions:
            print(f"  - {c.message()}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
