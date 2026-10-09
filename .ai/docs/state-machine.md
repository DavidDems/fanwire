# Workflow state machine

The authoritative definition is `.ai/agentlib/state.py`. This file explains it;
it does not duplicate it. If the two disagree, the code is right and this file
is a bug.

## States

| State | Meaning | Next |
|---|---|---|
| `DRAFT` | Spec exists, not yet validated | validate |
| `READY` | Spec valid, branch exists | dispatch test agent |
| `TEST_AGENT_RUNNING` | Test agent in flight | wait |
| `TESTS_COMMITTED` | Tests on the branch | run CI |
| `BASELINE_CI` | CI running on tests only — **must be red** | wait |
| `READY_FOR_IMPLEMENTATION` | Baseline was red, as required | dispatch code agent |
| `CODE_AGENT_RUNNING` | Code agent in flight | wait |
| `IMPL_COMMITTED` | Implementation on the branch | run CI |
| `IMPL_CI` | CI running on the implementation | wait |
| `DISTILLING` | CI failed; reducing the log to a result | distil |
| `RETRY_READY` | Distilled, budget remains | dispatch code agent |
| `MANAGER_REVIEW` | The machine cannot decide | dispatch manager |
| `CONTEXT_MAINTENANCE` | CI green; recording what changed | dispatch maintainer |
| `COMPLETE` | Terminal. Ready for human review | — |
| `ESCALATED` | Needs a human. Recoverable by human action | — |
| `CANCELLED` | Terminal. Human stopped it | — |
| `FAILED` | Terminal. Infrastructure failure | — |

## Human control is not a state

`PAUSED` and `CANCELLED` were specified as states. `control` is a separate
field instead — `RUN`, `PAUSE` or `CANCEL` — because modelling a pause as a
state destroys the state the task must resume *into*. A task paused in
`RETRY_READY` has to come back in `RETRY_READY`, not in "wherever we guess".

While `control` is `PAUSE`, every workflow event raises `Paused` and nothing
dispatches. Setting it back to `RUN` resumes exactly where it stopped.
`CANCEL` is terminal and accepts nothing further.

`CANCELLED` remains a state because a cancelled task really is finished.

## The red baseline

After the test agent commits, CI runs on the tests with no implementation
behind them, and **that run must fail**.

```
BASELINE_CI ──CI_FAILED──────────────► READY_FOR_IMPLEMENTATION  (red for the right reason)
BASELINE_CI ──CI_FAILED_WRONG_REASON─► MANAGER_REVIEW  (red_baseline_wrong_reason: ...)
BASELINE_CI ──CI_PASSED──────────────► MANAGER_REVIEW  (red_baseline_not_red)
```

A green baseline means the committed tests pass against code that does not
implement the task — so they pin nothing the task is about, and there is
nothing for the code agent to make pass. Sending it to the Manager is the
cheap outcome; dispatching a code agent against a test that already passes is
the expensive one.

**Red for the right reason** (handoff.md §10, D4). Dispatched CI runs every
suite, so a baseline can fail for reasons that have nothing to do with the new
tests — a CVE in `pip-audit`, `openapi-drift`, an unrelated broken test, a
tree-scan test the new test tripped. The code agent cannot edit tests, so
sending it after any of those only spends its attempts. A failed baseline
therefore counts as red only when `ciresult.baseline_verdict` says so, from the
run's job list and its failed-job log:

- every failed job is a test job (`ciresult.TEST_JOBS`: `backend-test`,
  `frontend-test`), apart from the aggregate `gate`, which fails with them;
- each failed test job's log names all of its failures (pytest's short
  summary against its tally; vitest's `FAIL` lines against `Test Files N
  failed`, with no unhandled errors);
- every one of those files was changed by a test-agent commit
  (`state.test_commits`: the `AGENT_COMMITTED` entries out of
  `TEST_AGENT_RUNNING`, whose note is the commit). A collection or import
  error in the new test file counts — it is what a test for code that does not
  exist yet usually looks like.

Anything else, including a log or job list that cannot be read, is
`CI_FAILED_WRONG_REASON`, and the manager is given the reason. Same route as a
green baseline, for the same reason: the manager's levers (re-scope, escalate)
fit, the code agent's do not. The check lives in `agentctl state advance`: a
`CI_FAILED` applied to a task in `BASELINE_CI` is classified from `--ci-jobs`
and `--ci-log` whoever applies it, and with neither it fails closed. The
orchestrator fetches both for every failed run (`gh run view --json jobs`,
`--log-failed`). `state.advance` itself still reads `CI_FAILED` from
`BASELINE_CI` as "red for the right reason".

This is the deliberate enforcement point. "Write the test first" is an
instruction any agent can ignore; a CI run that must be red is not.

`workflow_policy.require_red_baseline: false` waives it for a task where a
red baseline genuinely is not meaningful, and the reason check with it: a
waived baseline goes to implementation whatever it failed on. Use it rarely
and say why in the brief.

## Retry policy

Deterministic, bounded, and configurable per task:

```
IMPL_CI --CI_FAILED--> DISTILLING --DISTILLED--> attempt < max ? RETRY_READY
                                                              : MANAGER_REVIEW
```

- `workflow_policy.max_impl_attempts` (default 3, ceiling 8) sets the budget.
- A Manager may grant more with `MANAGER_RETRY`, never past
  `state.HARD_MAX_ATTEMPTS` (8). The machine refuses; it does not warn.
- The Manager is **not** invoked after every failure. It is invoked when the
  budget runs out, when the baseline was wrong, or when an invocation failed —
  i.e. when more reasoning would actually help.

`test_e2e_workflow.py::TestFailureRetryPath::test_the_loop_cannot_run_forever`
drives the cycle greedily and asserts it terminates.

## Failure handling

Nothing disappears quietly. Every route out is recorded in `state.json`'s
append-only `history`, with the event, both states, a timestamp and a note.

| Event | From | To | Why |
|---|---|---|---|
| `AGENT_FAILED` | any running | `MANAGER_REVIEW` | Provider error, timeout, or a result that could not be applied. Might be worth another approach. |
| `AGENT_FAILED` | `MANAGER_REVIEW` | `ESCALATED` | The manager is what failed; sending it back to itself looped. |
| `AGENT_FAILED` | `ESCALATED` | `ESCALATED` | A worker landing late. The task stays with the human. |
| `GUARD_VIOLATION` | any running | `ESCALATED` | A worker wrote outside its paths. Never retried automatically — a boundary failure is not a test failure. |
| `INFRA_FAILED` | any | `FAILED` | The runner, not the work. |
| `ESCALATE` | any | `ESCALATED` | Manager or human decided a human is needed; a CI run that was not a verdict; an orchestrator action that failed. |

A guard violation discards the work (`git reset --hard`) before escalating. The
attempt is not re-run.

## Bounded and detectable (handoff.md §10, D3)

- **Every dispatch is an event**, the manager's included: `DISPATCH_MANAGER`
  keeps `MANAGER_REVIEW` but is recorded and counted, and the one after
  `MAX_MANAGER_INVOCATIONS` (3) escalates instead. Before, a manager whose
  worker applied nothing was re-dispatched with no trace.
- **Every dispatch is persisted before it is made.** The orchestrator commits
  and pushes the transition, then starts the worker or CI.
- **Every dispatch is timed.** It sets `last_dispatch` (event, workflow, role,
  time, and for CI the run id once known); `stalled()` and `agentctl status`
  report one older than its workflow's timeouts (`DISPATCH_TIMEOUT_MINUTES`)
  as `STALLED`.
- **Every CI conclusion has a case** (`CI_CONCLUSIONS`): `success` →
  `CI_PASSED`; `failure`, `timed_out` → `CI_FAILED`; every other documented
  conclusion, and any unknown one, → `ESCALATE`. Not `MANAGER_REVIEW`: the
  manager could only spend code-agent attempts on what is a runner problem.
- **A CI result for a paused task** is discarded, not applied, and recorded in
  `last_ci_run` with `applied: false`. `operations.md` has the re-run recipe.

## Manager decisions

Exactly three, read only from the structured `decision` field of the agent
result — never parsed out of prose, which anything in the repository could
forge:

- `MANAGER_RETRY` — approach is right, retry with better information (and
  optionally a larger budget).
- `MANAGER_RESCOPE` — the tests are wrong; back to `READY` for new tests.
- `ESCALATE` — a human is needed.

Anything else, including a missing or unparseable decision, is treated as
`ESCALATE`. A manager that cannot answer usefully is itself a reason for a
human to look.

`MANAGER_RETRY` and `MANAGER_RESCOPE` are also legal from `ESCALATED`, as a
human's way back in (they reset the manager's invocation count). Only a
dispatch of the orchestrator supplies an event there: the worker applies a
manager's decision with `--from-state MANAGER_REVIEW`, and every other role's
result with its own `*_RUNNING` state, so a late worker cannot use that door.

## Reconstruction

`state.json` plus `task.json` is everything. Loading a state whose `state` or
`control` is not in the known set raises rather than defaulting — a corrupted
state file stops the workflow instead of quietly resuming from a guess.
