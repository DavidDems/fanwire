---
type: decision
---

# 0023 - Human gates on agent work

Decision: 2026-10-08, the human, after the agent workflow review.

## Context

The 2026-10-08 review of the agent workflow (`.ai/docs/handoff.md` §10) found
defects D1–D7. One of them, D1, let the orchestrator apply any `test-agent`
run on a branch named `agent/*` as a task's verdict, a fork's included; the
human had the D1–D3 fixes merged before any task ran. The repository is public
and forks are allowed. Agent pull requests are opened by `github-actions[bot]`,
so a workflow on one waits in `action_required` until a human approves the run.
The repository also held a Vercel AI Gateway key, `AI_GATEWAY_API_KEY`.

## Choice

- **No task is dispatched without the human saying go.**
- **Bot-opened pull requests keep `action_required`.** A human approves the run
  before CI spends anything on agent work, and the PR needs that human's review
  to merge anyway. It is deliberate, not a defect.
- **Fork pull requests need workflow approval from every outside
  contributor** (`approval_policy: all_external_contributors`), so a fork's
  workflows do not run at all until a human looks.
- **`AI_GATEWAY_API_KEY` is deleted.** Nothing read it, and a gateway key
  reaches every model in its catalogue.

## Consequences

- Every task carries the approval in its end-to-end latency, on purpose.
  Approving the run and approving the PR are separate actions, and both are
  needed: `github-automation-setup-actions.md` §4
  ([actions settings](../Architecture/github-automation-setup-actions.md)). The
  fork setting and its read-back command are `github-automation-setup-actions.md` §1.
- The repository secrets and what reads each one are
  [github-automation-setup-secrets.md](../Architecture/github-automation-setup-secrets.md).
- Starting the orchestrator stays the human's call; a hand-run session never
  starts it ([director-sessions.md](../Architecture/director-sessions.md)
  "Standing limits").
