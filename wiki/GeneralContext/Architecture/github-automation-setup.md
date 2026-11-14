---
type: runbook
---

# GitHub automation setup: the repository settings the agent pipeline needs

**Human-facing.** The repository settings the `.ai/` agent pipeline depends
on. They live in GitHub's UI and API, not in files, so these pages record what
is configured, why, and the command that reads each one back.

## Why these settings are worth writing down

They are the one part of the agent system that is **not** in version control.
`policy.json`, the guard and the state machine are code and reviewed as code.
A repository setting is a checkbox in someone's browser: nothing diffs it,
nothing tests it, and a wrong one fails in ways that look like a code bug. Two
of the pipeline's seventeen recorded bugs were settings, not code.

## Parts

- [Actions](github-automation-setup-actions.md): sections 1, 4, 5 and 6. Which
  workflows run and what each spends, which actions may run and how they are
  pinned, fork-PR approval, Actions opening pull requests and
  `action_required`, head branches deleted on merge, the pre-commit hook.
- [Secrets](github-automation-setup-secrets.md): section 2. The repository
  secrets, the environment-secret trap, and why the dispatch token exists.
- [Ruleset](github-automation-setup-ruleset.md): section 3. The `main`
  ruleset, its aggregate required checks and the solo-repo bypass.
- [Renovate](github-automation-setup-renovate.md): section 7. What it opens,
  its safety properties, and installing or removing it.
- [Tasks](github-automation-setup-tasks.md): running and stopping a task, and
  what a task costs.

The decisions behind these settings are ADRs
[0023](../Decisions/0023-human-gates-on-agent-work.md) (human gates),
[0025](../Decisions/0025-jev-shadow-only-switched-off.md) (`jev`) and
[0026](../Decisions/0026-agent-models-cli-pin-and-spend-controls.md) (models,
CLI pin, spend controls). Full operational detail is `.ai/docs/operations.md`.
