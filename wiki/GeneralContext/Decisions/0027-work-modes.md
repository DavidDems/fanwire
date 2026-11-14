---
type: decision
---

# 0027 - Work modes: code is hand-run, the API is for cheap automation

Decision: 2026-10-07 (focus back on the agent workflow) and 2026-10-09 (work
modes), the human.

## Context

With every planned frontend unit merged, the human moved the project's focus
back to the automated agent workflow on 2026-10-07: agents dispatched through
the API once a task spec and branch exist, after a review of the workflow for
safety, performance and cost. The first real task after that review's fixes,
`MEDIA-002`, ran end to end through the pipeline and cost **USD $2.65** of
metered API credit for one backend script and its test, most of it spent by
the test agent and the code agent. A hand-run session on the human's Claude
subscription does the same work at no marginal cost.

## Choice

- **Major code changes are hand-run** by the human on the subscription: a
  session works against a task spec on `agent/<ID>`, and `agent-guard` holds
  that branch to the spec exactly as it holds an automated run.
- **The automated pipeline is kept working, but secondary.** It is for small,
  well-specified tasks the human chooses to run unattended.
- **The API pays for cheap, narrow automation**, on `claude-haiku-5-5` or
  `jev`: a spec drift check before a task, a CI failure summary on a red task
  PR, a criteria coverage check on a task PR, and a wiki update proposal after
  one merges.

## Consequences

- The modes, what each costs, the automations and the constraints every
  automation keeps are [work-modes.md](../Architecture/work-modes.md), the
  reference for planning any unit. How a hand run is done is
  [director-sessions.md](../Architecture/director-sessions.md).
- All four automations are built. `jev` is wired and switched off
  ([ADR 0025](0025-jev-shadow-only-switched-off.md)). A fifth, the review of
  Director PRs, runs on Sonnet 5.5
  ([ADR 0028](0028-improvement-roadmap-answers.md)).
- What remains to build is `TODO/02-backlog.md`, one queue with a Mode column.
