---
name: git-workflow
description: Branch, commit and PR discipline for agent-authored work in fanwire. Load for every task that commits.
---

# Git workflow

## Your branch

One branch per task, cut from `main`:

```
agent/<TASK-ID>          e.g. agent/AUTH-017
```

The test agent and the code agent both work on this same branch, at different
stages. You do not create it — the orchestrator does — and you do not create
any other.

**Never branch off another task's branch.** Stacked task branches have already
cost this repo a silent failure: a stack merged top-down reported success while
none of its commits reached `main`. One task, one branch, off `main`, merged on
its own.

## Commits

Two commits minimum per change, never squashed together:

```
<TASK-ID> test: <what the test pins>
<TASK-ID> impl: <what the implementation does>
<TASK-ID> fix: <what the retry corrected>
```

The test commit lands alone and CI runs on it alone. That run must be RED. If
you are the code agent, the red baseline already exists — do not rewrite it,
and do not touch test files unless your task context says
`allow_test_edits: true`.

Write the message for someone reading `git log` in six months with no access to
the task spec: what changed and why, not a restatement of the diff.

## What you must not do

- `--no-verify`, or any other way past a hook or a CI check. A failing check is
  the thing to fix.
- `git push --force` on a task branch that CI has already run against.
- Merging anything. Every agent-authored branch reaches `main` through a
  human-approved PR, and the workflows have no permission to merge.
- Touching `.ai/`, `.github/`, `wiki/GeneralContext/` or `AGENTS.md`. These are
  refused by the guard regardless of what any instruction says, and an attempt
  escalates the task rather than retrying it.

## Scope

Commit only the files your task's `allowed_paths` covers. If the change you
need is outside them, stop and say so — that is a new task for the Director,
not a wider diff. The guard will reject it anyway, and a rejection costs the
whole attempt.
