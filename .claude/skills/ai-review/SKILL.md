---
name: ai-review
description: A weekly by-hand, read-only pass over the agent system - stalled or hand-running tasks, unproven items, metrics anomalies, Scorecard and Dependabot findings, doc-versus-workflow drift, and parked briefs still marked live.
---

# AiReview

A periodic pass over `.ai/` run by a Director session by hand about weekly.
It only reads: files, `agentctl status`, `agentctl metrics report`, and
`gh api` GET requests. It spends no API credit, dispatches no worker, starts
no workflow, changes no setting and merges nothing. `jev` stays off.

Background: [the agent system's state](../../../.ai/docs/handoff.md), what is
proven live in [handoff-live-proof.md](../../../.ai/docs/handoff-live-proof.md),
the numbers in [metrics.md](../../../.ai/docs/metrics.md), and the states in
[state-machine.md](../../../.ai/docs/state-machine.md).

## The pass

Start from a worktree at `origin/main`. Keep a list of findings.

1. **Task board.** `python .ai/bin/agentctl.py status`. Flag a task stuck in
   one state, and any `HAND_RUNNING` task: check `gh pr list` and
   `git log origin/main` for its PR, and say whether it has finished
   (`agentctl hand finish`) or is stalled, with the branch and the last commit
   date. Do not change state: guard-gate rejects task state on non-agent PRs.
2. **Unproven items.** The "Not proven" list in `handoff-live-proof.md`.
   For each, say whether anything since has proven or disproved it, citing the
   run or PR, and whether it still matches `handoff.md` and the backlog's
   "Agent system" rows.
3. **Metrics and telemetry.** `agentctl metrics report` (add `--ref
   origin/metrics` when that branch exists). Flag cost spikes, units with
   human interventions or red CI, a mode that has gone silent, and any record
   that shows API spend while the project runs by hand (ADR 0035).
4. **Scorecard and Dependabot.** `gh api` GET only: the repository's
   code-scanning alerts for the Scorecard tool and its Dependabot alerts
   (`repos/{owner}/{repo}/code-scanning/alerts` and
   `repos/{owner}/{repo}/dependabot/alerts`). List open items by severity. If
   the token cannot read them, say so; do not work around it.
5. **Drift between docs and workflows.** Compare `.ai/docs/` (architecture,
   operations, permissions, threat-model, state-machine) with
   `.github/workflows/*.yml` and `.ai/policy.json`: workflows named in docs
   that do not exist or the reverse, triggers, permissions, required checks,
   pinned versions. `.ai/tests/test_workflows.py` pins some workflow content;
   a doc claiming something no test or workflow shows is a finding.
6. **Parked briefs still marked live.** Each file in
   `wiki/GeneralContext/Prompts/` against the index's "Task prompts" list and
   the backlog: a brief for finished work, a brief the index calls parked but
   whose own text says live, a brief the index omits, or one that names a
   deleted file.

## Report

Findings ranked most severe first, each with the file and the proposed
change. Questions for the human last. Make no edit during the pass. A fix is
a separate Director PR; name every restricted-tree edit in it (`.ai/`,
`.github/`, `wiki/GeneralContext/`, `AGENTS.md`, `.claude/`), run the `.ai`
suite alone, and let CI's `gate` be the proof.
