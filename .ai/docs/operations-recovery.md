---
type: runbook
---

# Operating the agent system: recovery

Part of [operations.md](operations.md). What to do when a task escalates, and
when the chain stalls.

## When a task escalates

`ESCALATED` means the machine stopped and wants you. Read the reason:

```powershell
python .ai/bin/agentctl.py state show AUTH-017 | Select-String escalation_reason
```

| Reason | What happened | Usual response |
|---|---|---|
| `guard violation: ...` | A worker wrote outside its paths, or the branch changes the CLI's project config | Read the run log. Either `allowed_paths` is too narrow for a legitimate change, or something went genuinely wrong. Work was discarded. |
| `manager could not be invoked: ...` | The manager failed, or its decision could not be applied (e.g. `MANAGER_RETRY` past the hard cap) | Read the manager's run. Decide yourself. |
| `manager invoked N times (limit 3) ...` | The manager kept being asked and the task never resolved | The spec is the problem. Re-scope or take over. |
| `N consecutive invocation failures: ...` | The provider failed repeatedly | Usually transient or a key/quota problem. `MANAGER_RETRY` once it is fixed. |
| `CI run N concluded 'cancelled', which is not a test verdict` (or `skipped`, `stale`, `neutral`, `action_required`, `startup_failure`) | CI did not produce a verdict. Nothing was spent | Look at the run. See "Recovering a CI escalation" below. |
| `orchestrator run N failed at ...` | A distil, transition, dispatch or self-wake failed; what it names was never started | Fix the cause (token, workflow file), then recover as below. |

`max_attempts_exhausted`, `red_baseline_not_red` and
`red_baseline_wrong_reason: ...` are **not** escalation reasons: they route to
`MANAGER_REVIEW`, and the manager is dispatched first. They reach you only if
the manager then escalates.

`red_baseline_wrong_reason: ...` (handoff.md §10, D4) means the baseline CI
run failed, but not only on the new tests, so no code agent was sent. The
reason names what was wrong, parts joined by `; `:

| Part | What happened | Usual response |
|---|---|---|
| `non-test job(s) failed: pip-audit, ...` | A job other than the suites, the static checks (and `gate`) failed: an audit, `openapi-drift`, `infra-synth`, `agent-infra-test` | Not the task's problem. Fix it on `main`, then re-run the baseline (below). |
| `backend-ruff failed in the test commit's own files: ...` (or `frontend-lint`) | The new tests do not lint. The code agent cannot edit them (D5) | `MANAGER_RESCOPE`: the test agent writes them again. |
| `frontend-typecheck found what only the test file can fix: ... (TS6133)` | tsc reports an unused declaration in the new tests (D5) | As above. |
| `failures outside the test commit's files: ...` | A test the test agent did not write failed: an existing test the new one broke (a tree scan), or one already broken | Re-scope if the new test caused it; otherwise fix `main` first. |
| `could not read <job>'s failures: ...`, `could not read the run's job list` | The log or job list was missing, unparseable or truncated; vitest reported unhandled errors; a static check's tally disagreed with what it named, or its log stopped before GitHub's `Process completed` line | Read the run. If it was red for the right reason after all, re-run the baseline. |
| `job(s) did not fail outright: ...`, `no test job failed` | A suite or check was cancelled or timed out, or no suite failed: only a non-test job, or only a static check while every suite passed (the tests pin nothing) | Read the run. |
| `no files recorded for the test commit` | The history has no test-agent commit to compare against | Read `history`. |

To re-run the baseline once the cause is fixed, set `state` back to
`TESTS_COMMITTED` and `escalation_reason` to `null` in `state.json` on the
branch, commit, push and nudge the orchestrator, as in "Recovering a CI
escalation" below. A human-supplied `-f event=CI_FAILED` is classified like
any other, and with no log it fails closed, so it cannot force the baseline
open. `MANAGER_RETRY` can, and skips the check.

Then drive it by hand. `MANAGER_RETRY` (→ `RETRY_READY`, one more attempt,
never past the hard cap of 8) and `MANAGER_RESCOPE` (→ `READY`, the test agent
writes the tests again) are legal from `ESCALATED`, and only a dispatch like
this one can supply them there — a manager worker's decision is applied only
from `MANAGER_REVIEW`. Either also resets the manager's invocation count.

```powershell
gh workflow run agent-orchestrator.yml -f task_id=AUTH-017 -f event=MANAGER_RESCOPE -f reason="criteria were not testable"
```

Legal events are in `agentlib/state.py`'s `EVENTS`. An illegal one is refused
with an error rather than half-applied.

**Recovering a CI escalation.** No event takes a task from `ESCALATED` back to
waiting on CI, and `MANAGER_RETRY` from a baseline escalation would skip the
red-baseline check. Instead, on the branch, set `state` in
`.ai/tasks/<ID>/state.json` back to the state before CI (`TESTS_COMMITTED` for
a baseline, `IMPL_COMMITTED` for an implementation) and `escalation_reason` to
`null`, commit and push, then nudge the orchestrator. It is an ordinary
reviewed file on an ordinary branch; `load_state` refuses an unknown state.

## If the chain stalls

Every dispatch is recorded before it is made: the state is committed and pushed
first, and `last_dispatch` in `state.json` says what was started and when (and,
for CI, the run id once its result arrives). `agentctl status` shows
`STALLED: ...` for a task whose last event is a dispatch older than that
workflow can run for — the worker's two jobs (60 min), or `test-agent`'s
longest job chain (1080 min: its suite jobs declare no timeout, so each gets
GitHub's 360), plus 15 min. A stalled task's result was lost: a cancelled
`land`, a run that never started, a dropped `workflow_run`.

```text
TASK          STATE                     CTRL   ATT    NEXT / REASON
AUTH-017      CODE_AGENT_RUNNING        RUN    2/3    STALLED: agent-worker (code_agent) dispatched 2026-10-08T10:00:00Z, 95 min ago (limit 75)
```

- **`*_RUNNING`, worker lost**: re-dispatch the same role. The state already
  says it is running, so no attempt is spent again:

  ```powershell
  gh workflow run agent-worker.yml -f task_id=<ID> -f role=<role>
  ```

- **`BASELINE_CI` / `IMPL_CI`, result lost**:

  ```powershell
  gh workflow run test-agent.yml --ref agent/<ID>
  ```

- **`MANAGER_REVIEW` / `CONTEXT_MAINTENANCE`**: nudge the orchestrator (below);
  it dispatches again, and a manager dispatch counts against its limit.

A task that sits in a state with nothing happening and is *not* STALLED was
never dispatched. Each run wakes the next one with `gh workflow run`. GitHub
fires no `workflow_run` for a run this repository's own workflow started with
the default `GITHUB_TOKEN`, so the wake after orchestrator-dispatched CI needs
`AGENT_DISPATCH_TOKEN`. A task stalled in `IMPL_COMMITTED` or `BASELINE_CI`
with no new run is that leg failing.

1. Check the Actions tab — did the next run get created at all?
2. If not, check `AGENT_DISPATCH_TOKEN` is set as a *repository* secret, with
   the scopes in
   [github-automation-setup-secrets.md](../../wiki/GeneralContext/Architecture/github-automation-setup-secrets.md).
   Every dispatch step prefers it, and falls back to `github.token` silently.

   ```powershell
   gh secret list --repo DavidDems/fanwire
   ```

3. Either way, you can always nudge it manually:

   ```powershell
   gh workflow run agent-orchestrator.yml -f task_id=<ID>
   ```

Before you debug the token:

- A **skipped** orchestrator run on `main`, or on any non-`agent/*` branch, is
  the job's `if:` doing its job, not the token failing. Most runs in the
  Actions tab are these.
- **A merged PR proves nothing about the token**, whichever branch it came
  from, and neither does a PR check run. Only a task whose CI the orchestrator
  itself dispatched exercises that leg, and a task in `COMPLETE` never will
  again: testing the token needs a new task.

A dispatch that fails outright escalates the task (`orchestrator run N failed
at ...`), so it shows up as an escalation, not a stall.

A stalled task is not a lost task. The state file is accurate; the orchestrator
picks up exactly where it stopped.
