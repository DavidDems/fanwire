# Operating the agent system

For a human. How to start a task, watch it, stop it, and take over when it goes
wrong — without opening an agent session.

## Where everything is

| I want to know | Look at |
|---|---|
| What is every task doing right now | `python .ai/bin/agentctl.py status` |
| Why a task is where it is | `agentctl state show <ID>` → `history` |
| What an agent was told | `agentctl prompt <ID> --role code_agent` |
| What failed, and how it was read | `state show <ID>` → `distilled` |
| What it cost | `agentctl telemetry report` |
| What the rules are | `.ai/policy.json`, `.ai/docs/permissions.md` |
| What the machine will do next | `agentctl next <ID>` |
| The raw CI result | The `test-agent` run linked from `last_ci.run_id` |

`agentctl status` is the board:

```
TASK          STATE                     CTRL   ATT    NEXT / REASON
DEMO-001      IMPL_CI                   RUN    2/3    await_ci
AUTH-017      MANAGER_REVIEW            RUN    3/3    max_attempts_exhausted
FEED-002      READY_FOR_IMPLEMENTATION  PAUSE  0/3    dispatch_agent:code_agent
```

## One-time setup

Nothing below is done by this repository's files; a human has to switch it on.

1. **Secrets** — repository settings → Secrets → Actions:
   - `ANTHROPIC_API_KEY` (required)
   - `AGENT_DISPATCH_TOKEN` (optional, see "If the chain stalls")
2. **Branch protection on `main`** — require a pull request, require approval,
   and do not allow the `github-actions` bot to bypass it. The agent system
   deliberately has no way to merge; this is what makes that true rather than
   polite.

   **Require exactly two status checks, `gate` and `guard-gate`.** Not
   `test-agent`, not `agent-guard`, and not the individual test jobs — that is
   what an earlier version of this page said, and following it would stop every
   PR merging.

   A required status check names a *job*. Both workflows deliberately skip
   jobs: `test-agent` skips suites a change cannot affect, and `agent-guard`'s
   `guard` job runs only on `agent/` branches. **A skipped job never reports at
   all, and a protected branch reads that as "still waiting", not "not
   needed".** Requiring `backend-test` would hang every wiki-only PR; requiring
   `guard` would hang every human PR, permanently.

   `gate` and `guard-gate` exist for this. Each always runs, aggregates its
   workflow's real result, and treats a legitimate skip as a pass and a failure
   as a failure. Requiring them is also what makes the guard *enforcing* rather
   than advisory: a check that is not required does not block a merge when it
   fails, so without this the guard would be a red X a human could click past.

   Neither check appears in GitHub's picker until it has reported once, so
   merge a PR that runs them before configuring this.

   **On a solo repository, add "Repository admin" to the bypass list with mode
   "Pull requests only".** GitHub does not let a PR author approve their own PR,
   so without this a sole maintainer's own PRs can never satisfy the rule. That
   mode still forbids direct pushes to `main` — it only allows merging a PR
   without a second approver.

   This does not weaken the agent gate. Agent PRs are opened with
   `github.token`, so their author is `github-actions[bot]`, which a human can
   approve normally. The bypass requires a human's own credentials, which no
   agent has. Do not instead set required approvals to 0: the orchestrator holds
   `pull-requests: write` and `contents: write`, so with no approval required a
   workflow *could* merge. It does not, but "cannot" is the stronger property.
   The whole ruleset, as a checklist:

   | Setting | Value |
   |---|---|
   | Restrict deletions | on |
   | Block force pushes | on |
   | Require a pull request | on, 1 approval |
   | Dismiss stale approvals on new commits | on |
   | Require review from Code Owners | on |
   | Require approval of the most recent push | **off** — demands a second person, unsatisfiable solo, and the bypass does not cover it |
   | Require status checks | `gate`, `guard-gate` |
   | Bypass list | Repository admin, "Pull requests only" |

3. **`.github/CODEOWNERS`** is committed and assigns `.ai/` and
   `.github/workflows/` to a human. It only has effect once "require review
   from Code Owners" is enabled.

   Related, and worth knowing rather than fixing: `features.auto_open_pr`
   means the orchestrator runs `gh pr create`, which needs the repository
   setting "Allow GitHub Actions to create and approve pull requests". That
   setting also grants *approval*, which would satisfy the 1-approval rule on
   an agent's own PR. Nothing here uses it, and
   `tests/test_workflows.py::TestNoWorkflowCanApprove` is what keeps that
   true — so that test is load-bearing, not tidiness.
4. **A runner with the provider CLI.** `agent-worker.yml` calls
   `.ai/bin/invoke_agent.sh`, which expects the provider's CLI on `PATH`.

## Starting a task

```bash
python .ai/bin/agentctl.py task new AUTH-017
# edit .ai/tasks/AUTH-017/task.json and brief.md
python .ai/bin/agentctl.py task validate AUTH-017
```

Commit the spec through an ordinary reviewed PR to `main`. Then create the
branch and kick it off:

```bash
git switch -c agent/AUTH-017 main && git push -u origin agent/AUTH-017
gh workflow run agent-orchestrator.yml -f task_id=AUTH-017
```

From there it runs itself until it reaches `COMPLETE`, `ESCALATED`, or a state
that needs you.

## Stopping it

```bash
# Stop now, keep the position. Resuming continues from the same state.
python .ai/bin/agentctl.py state control AUTH-017 --set PAUSE
python .ai/bin/agentctl.py state control AUTH-017 --set RUN

# Stop for good.
python .ai/bin/agentctl.py state control AUTH-017 --set CANCEL
gh workflow run agent-orchestrator.yml -f task_id=AUTH-017 -f event=CANCEL
```

While paused, every workflow event is refused and nothing dispatches. The
branch and its commits are untouched.

Anything already in flight still finishes, and what it reports is not applied:

- **A CI result** is discarded on purpose. The orchestrator run stays green,
  logs a notice naming the run, and records it in `state.json` as `last_ci_run`
  with `"applied": false`. To get a verdict after resuming, re-run CI on the
  branch — that run is the task's verdict like any the orchestrator started:

  ```bash
  # on agent/AUTH-017: set RUN, commit, push
  python .ai/bin/agentctl.py state control AUTH-017 --set RUN
  git commit -am "[agent-state] AUTH-017: resume" && git push
  gh workflow run test-agent.yml --ref agent/AUTH-017
  ```

- **A worker's result** is refused: its work commit is pushed, but the run is
  red and the task stays `*_RUNNING`. After resuming, apply the event the
  worker would have (`-f event=AGENT_COMMITTED` if its commit is on the branch),
  or re-dispatch the worker (see "If the chain stalls").

You can also just disable the workflows in the Actions tab. The state file is
still correct when you turn them back on — that is the point of keeping state
in git rather than in a session.

## When a task escalates

`ESCALATED` means the machine stopped and wants you. Read the reason:

```bash
python .ai/bin/agentctl.py state show AUTH-017 | grep escalation_reason
```

| Reason | What happened | Usual response |
|---|---|---|
| `guard violation: ...` | A worker wrote outside its paths, or the branch changes the CLI's project config | Read the run log. Either `allowed_paths` is too narrow for a legitimate change, or something went genuinely wrong. Work was discarded. |
| `manager could not be invoked: ...` | The manager failed, or its decision could not be applied (e.g. `MANAGER_RETRY` past the hard cap) | Read the manager's run. Decide yourself. |
| `manager invoked N times (limit 3) ...` | The manager kept being asked and the task never resolved | The spec is the problem. Re-scope or take over. |
| `N consecutive invocation failures: ...` | The provider failed repeatedly | Usually transient or a key/quota problem. `MANAGER_RETRY` once it is fixed. |
| `CI run N concluded 'cancelled', which is not a test verdict` (or `skipped`, `stale`, `neutral`, `action_required`, `startup_failure`) | CI did not produce a verdict. Nothing was spent | Look at the run. See "Recovering a CI escalation" below. |
| `orchestrator run N failed at ...` | A distil, transition, dispatch or self-wake failed; what it names was never started | Fix the cause (token, workflow file), then recover as below. |

`max_attempts_exhausted` and `red_baseline_not_red` are **not** escalation
reasons: they route to `MANAGER_REVIEW`, and the manager is dispatched first.
They reach you only if the manager then escalates.

Then drive it by hand. `MANAGER_RETRY` (→ `RETRY_READY`, one more attempt,
never past the hard cap of 8) and `MANAGER_RESCOPE` (→ `READY`, the test agent
writes the tests again) are legal from `ESCALATED`, and only a dispatch like
this one can supply them there — a manager worker's decision is applied only
from `MANAGER_REVIEW`. Either also resets the manager's invocation count.

```bash
gh workflow run agent-orchestrator.yml -f task_id=AUTH-017 \
  -f event=MANAGER_RESCOPE -f reason="criteria were not testable"
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

## Taking over by hand

The task branch is an ordinary branch. Check it out, fix it, push, open the PR
yourself. Then either let the task sit in whatever state it is in, or cancel
it. Nothing about the agent system needs to be unwound first — no lock, no
lease, no daemon.

## If the chain stalls

Every dispatch is recorded before it is made: the state is committed and pushed
first, and `last_dispatch` in `state.json` says what was started and when (and,
for CI, the run id once its result arrives). `agentctl status` shows
`STALLED: ...` for a task whose last event is a dispatch older than that
workflow can run for — the worker's two jobs (60 min), or `test-agent`'s
longest job chain (1080 min: none of its jobs declares a timeout, so each gets
GitHub's 360), plus 15 min. A stalled task's result was lost: a cancelled
`land`, a run that never started, a dropped `workflow_run`.

```
TASK          STATE                     CTRL   ATT    NEXT / REASON
AUTH-017      CODE_AGENT_RUNNING        RUN    2/3    STALLED: agent-worker (code_agent) dispatched 2026-10-08T10:00:00Z, 95 min ago (limit 75)
```

- **`*_RUNNING`, worker lost**: re-dispatch the same role. The state already
  says it is running, so no attempt is spent again:
  `gh workflow run agent-worker.yml -f task_id=<ID> -f role=<role>`
- **`BASELINE_CI` / `IMPL_CI`, result lost**:
  `gh workflow run test-agent.yml --ref agent/<ID>`
- **`MANAGER_REVIEW` / `CONTEXT_MAINTENANCE`**: nudge the orchestrator (below);
  it dispatches again, and a manager dispatch counts against its limit.

A task that sits in a state with nothing happening and is *not* STALLED was
never dispatched. Each run wakes the next one with `gh workflow run`. GitHub
restricts workflows triggered by the default `GITHUB_TOKEN` from triggering
further runs in some situations, so:

1. Check the Actions tab — did the next run get created at all?
2. If not, add a fine-grained PAT with `actions: write` as
   `AGENT_DISPATCH_TOKEN`. Every dispatch step prefers it and falls back to
   `github.token`.
3. Either way, you can always nudge it manually:
   `gh workflow run agent-orchestrator.yml -f task_id=<ID>`

A dispatch that fails outright escalates the task (`orchestrator run N failed
at ...`), so it shows up as an escalation, not a stall.

A stalled task is not a lost task. The state file is accurate; the orchestrator
picks up exactly where it stopped.

## Validating the machinery without spending tokens

```bash
cd .ai && python -m pytest -q          # the deterministic core
python .ai/bin/agentctl.py selfcheck   # states, guard, policy, every task spec
```

`selfcheck` drives a synthetic task through the green path, the green-baseline
rejection, and the retry-to-exhaustion path, and asserts the guard still
refuses a worker reaching for `.ai/` or `.github/`. It runs in CI on every PR
as part of `test-agent`'s `agent-infra-test` job.

`DEMO-001` is the first *live* run: see `.ai/tasks/DEMO-001/brief.md`. Use it
before pointing the system at a real feature.

## Cost

```bash
python .ai/bin/agentctl.py telemetry report
```

Per task, per role, per model: invocations, tokens (cache reads and writes
included), cost, permission denials, attempts, escalations. The numbers that
matter over time are cost per *successful* task and the Manager escalation
rate — if the second is climbing, task specs are under-specified, and that is
a Director problem, not a model problem.

Cost is the provider's own figure for each call (the CLI envelope's
`total_cost_usd`) wherever a record has one. A record without it falls back to
an estimate from `.ai/config.json`'s price table; the report counts those
("N estimated") and lists each by path. Every record before D6 is such an
estimate and **leaves out cache tokens** — MEDIA-002's records claim $1.25
against a real $2.65 — so for those runs read the Console, not the report.
The Console stays the ground truth: the report is never checked against it.

`permission denials` above 0 means a worker asked for a tool the CLI refused
it; the report lists which record and the tool names (never what was asked).
That is the evidence for whether a worker tries a shell (handoff.md §10, D2).

When provider prices change, update `telemetry.prices` in `.ai/config.json`:
it now only feeds the fallback estimate, but an estimate on stale prices is
how the gap above went unnoticed.
