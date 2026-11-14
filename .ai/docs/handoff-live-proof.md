---
type: reference
---

# Agent system — what has been proven live

Proven means a real run did it; implemented is not proven. Each item below
names its evidence: a run id or a pull request in the archived repository.
Open proof work is `handoff.md` §6 ([handoff.md](handoff.md)) and
`TODO/02-backlog.md` "Agent system".

## Proven

- **`workflow_dispatch` chaining under the default `GITHUB_TOKEN`:**
  orchestrator → worker → orchestrator, and the orchestrator dispatching CI on
  a task branch (`DEMO-001`).
- **`workflow_run` waking the orchestrator after CI the orchestrator
  dispatched**, which needs `AGENT_DISPATCH_TOKEN`: GitHub fires no
  `workflow_run` for a run this repository's own workflow started with the
  default token. Run 35768127169 woke 12 seconds after the baseline CI
  finished, with no human nudge.
- **The provider call:** one invocation took 75 s and cost $0.074.
- **The red baseline on real CI:** `USERS-002`'s baseline failed
  `assert 201 == 422` against the age gate, and the task advanced to
  implementation on that failure.
- **The code agent:** `DEMO-001` implemented `GET /health/version`, CI green
  on the first attempt.
- **A guard violation escalating, pushing and discarding the work:** run
  35768890588 refused the context maintainer's write, discarded it, escalated
  the task and pushed the state.
- **The workflow opening its own PR** (fanwire-archive#34, author
  `app/github-actions`) and **an agent PR merging** (fanwire-archive#38).
- **`CONTEXT_MAINTENANCE`:** `USERS-002`'s maintainer wrote one sentence into
  `0x01-users.md`, in scope, on the first try.
- **A full pass with no human step:** `USERS-002`, `DRAFT` to `COMPLETE` in 14
  minutes, eleven transitions, one attempt, $0.38 (test agent $0.151, code
  agent $0.151, maintainer $0.076).
- **The fixed workflow end to end:** `MEDIA-002` (`handoff.md` §10.5), which also
  proved the normal path of the D2b and D3 items listed there.
- **The CI half of bug 17:** a draft non-agent probe PR
  (fanwire-archive#276) changed only spacing in an existing task state file,
  and the required `guard-gate` rejected that path in its intended step
  ([run 41116275154](https://github.com/DavidDems/fanwire-archive/actions/runs/41116275154)).
- **The pinned deploy actions** under the selected-actions allowlist: deploy
  runs 39309832485 and 39317008407.
- **OpenSSF Scorecard:** run 39346927480; `threat-model.md` lists its
  results.
- **CodeQL** on PRs, on push to `main` and on its schedule: run 39585406289.
- **`director-review`:** fanwire-archive#196, one comment, Sonnet 5.5,
  $0.030492 (15201 input / 9 output tokens).
- **Renovate:** its dashboard, its first PRs, and its scheduled `claude CLI`
  and `npm non-major` PRs (fanwire-archive#245, fanwire-archive#296).
- **Bot-authored PRs arrive with `action_required` checks:** a workflow on a PR
  opened by `github-actions[bot]` waits until a human approves the run. That is
  kept on purpose
  ([ADR 0023](../../wiki/GeneralContext/Decisions/0023-human-gates-on-agent-work.md)).

## Not proven

- **The distiller, the manager decision path and any retry.** No task has
  failed into them: every task's `attempt` is at most 1, and telemetry holds no
  manager or distiller record.
- **The pinned CLI install** and its `claude --version` check on a hosted
  runner: no worker has run since the pin.
- **Whether a worker under `--permission-mode acceptEdits` can run a tool.** It
  auto-accepts edits, and the invocations so far produced files; whether one
  that has to *run* something can is untested.
- **The D2b and D3 failure paths** listed in `handoff.md` §10.1.

The backlog item that proves the first two is `TODO/02-backlog.md` "Agent
system", item 15: one task with a deliberately impossible acceptance
criterion.
