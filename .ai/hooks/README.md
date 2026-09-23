# Git hooks

Git does not install hooks from a tracked file, so this is opt-in per clone:

```bash
git config core.hooksPath .ai/hooks
```

## `pre-commit`

Runs ruff (lint + format) over staged Python, the `.ai/` test suite and
`agentctl selfcheck` when `.ai/` is touched, and eslint over staged frontend
files. A missing toolchain skips its own check rather than blocking the commit.

**Why it exists in an agent system:** a lint failure that reaches CI costs a
full pipeline and, for a code agent, a whole implementation attempt out of a
budget of three. Catching it before the commit is the difference between a
retry spent on the actual problem and one spent on a line length.

## `pre-push`

Refuses to push a **non-`agent/*`** branch that carries `[agent-state]`
commits `main` does not already have.

**Why it exists (2026-09-22).** `spec-maintainer-gate` was branched while HEAD
was on `agent/USERS-002` instead of `main`. In review the PR looked like the
two-file change it claimed to be; on merge it also carried two `[agent-state]`
commits and a **mid-flight `state.json` (`TEST_AGENT_RUNNING`)** onto `main`.

That is not untidiness. A task's state file on `main` is what the *next* run of
that task reads. A fresh `agent/USERS-002` cut from `main` would have opened by
reading "a test agent is already running", and stalled — a task that looks
rebuilt and cannot move.

A merged agent PR leaving its own finished `state.json` on `main` is the design
and is fine. A human branch dragging one along is not, and after the merge the
two are indistinguishable.

`agent/*` branches are exempt: that is where those commits are legitimately
made. The range is measured against `origin/main`, not the remote branch, so a
second push of an already-poisoned branch still fails. A branch deletion (the
all-zero sha) is not inspected.

## What a hook is not

A hook is a convenience, not a control. It runs on the developer's machine, it
can be skipped with `--no-verify`, and the CI runner does not use it at all.
Nothing in the permission model depends on it — that lives in
`.github/workflows/agent-guard.yml`, which an agent cannot modify and cannot
skip.

Agent workers do not run this hook: `agent-worker.yml` does not set
`core.hooksPath`, so an agent commit is checked by CI like any other.
