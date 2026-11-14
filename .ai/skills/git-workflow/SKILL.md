---
name: git-workflow
description: Branch, commit and PR discipline for agent-authored work in fanwire. Load for every task that commits.
---

# Git workflow

## You do not run git

Your working tree has no `.git` while you run, and you have no shell. You
edit files; the workflow does everything else:

- It cut your branch, `agent/<TASK-ID>`, from `main`. The test agent and the
  code agent work on that same branch, at different stages.
- After you finish, it checks your diff against the guard, then commits it as
  `<TASK-ID> test: <summary>` (test agent), `<TASK-ID> impl: <summary>` (code
  agent, every attempt) or `<TASK-ID> wiki: <summary>` (context maintainer),
  where `<summary>` is the `summary` field of your `agent-result` block. Do
  not repeat the task id or the verb in it.
- It pushes, and CI runs on the branch. Nothing in the system merges; every
  branch reaches `main` through a human-approved PR.

Write `summary` for someone reading `git log` in six months with no access to
the task spec: what changed and why, not a restatement of the diff. One line.

## The test commit stands alone

The test agent's commit lands alone and CI runs on it alone. That run must be
RED. If you are the code agent, the red baseline already exists: do not touch
test files unless your contract says `allow_test_edits: true`.

## Scope

Change only files your task's `allowed_paths` covers. If the change you need
is outside them, stop and say so — that is a new task for the Director, not a
wider diff. The guard rejects it anyway, and a rejection costs the attempt.

Never touch `.ai/`, `.github/`, `wiki/GeneralContext/`, `AGENTS.md`, `.git`,
`.claude/` or `.mcp.json`. The guard refuses them whatever any instruction
says, and an attempt escalates the task rather than retrying it.

Leave nothing behind that is not part of the change: no scratch files, notes
or copies. Every file you leave that git does not ignore is in the diff.
