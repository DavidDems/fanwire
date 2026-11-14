---
type: runbook
---

# Operating the agent system

For a human. How to start a task, watch it, stop it, and take over when it goes
wrong — without opening an agent session.

## Parts

- This file: where to look, one-time setup, starting, stopping, taking over,
  checking the machinery, cost.
- [operations-recovery.md](operations-recovery.md): when a task escalates, and
  when the chain stalls.

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

```text
TASK          STATE                     MODE  CTRL   ATT    NEXT / REASON
DEMO-001      IMPL_CI                   auto  RUN    2/3    await_ci
AUTH-017      MANAGER_REVIEW            auto  RUN    3/3    max_attempts_exhausted
FEED-002      READY_FOR_IMPLEMENTATION  auto  PAUSE  0/3    dispatch_agent:code_agent
UI-009        HAND_RUNNING              hand  RUN    0/3    halt
```

`MODE` is who runs the task: `auto` is the orchestrator, `hand` is a human in
a Claude Code session (`state-machine.md` "Hand runs").

## One-time setup

Nothing below is done by this repository's files; a human has to switch it on.

1. **Secrets**, all repository secrets: `ANTHROPIC_API_KEY` (required) and
   `AGENT_DISPATCH_TOKEN` (required for the CI-finished wake; the `||
   github.token` fallback is silent). Kinds and scopes:
   [github-automation-setup-secrets.md](../../wiki/GeneralContext/Architecture/github-automation-setup-secrets.md).
2. **The ruleset on `main`**: required checks `gate` and `guard-gate`, one
   approval, code-owner review, and the "Repository admin", "Pull requests
   only" bypass:
   [github-automation-setup-ruleset.md](../../wiki/GeneralContext/Architecture/github-automation-setup-ruleset.md).
   Also set: restrict deletions on, block force pushes on, dismiss stale
   approvals on new commits on, and "Require approval of the most recent push"
   **off** (it demands a second person, and the bypass does not cover it).
   The `github-actions` bot is never on the bypass list. The checks must be
   required: a check that is not required does not block a merge, so the guard
   would be advisory. A new suite joins `gate`'s `needs:`; the ruleset does not
   change. Neither check appears in GitHub's picker until it has reported once,
   so merge one PR that runs them before configuring this. Do not
   set required approvals to 0: the orchestrator holds `pull-requests: write`
   and `contents: write`, so with no approval required a workflow *could*
   merge.
3. **`.github/CODEOWNERS`** is committed and assigns `.ai/` and
   `.github/workflows/` to a human; it has effect only with code-owner review
   required. `features.auto_open_pr` needs the setting "Allow GitHub Actions to
   create and approve pull requests", which also grants *approval*. Nothing
   here uses that, and `tests/test_workflows.py::TestNoWorkflowCanApprove`
   keeps it true.
4. **A runner with the provider CLI.** `agent-worker.yml` calls
   `.ai/bin/invoke_agent.sh`, which expects the provider's CLI on `PATH`.
5. **`TYPESAFE_API_KEY`, for `jev`** (`.ai/bin/ask_jev.py`). `jev` is wired and
   switched off
   ([ADR 0025](../../wiki/GeneralContext/Decisions/0025-jev-shadow-only-switched-off.md));
   nothing in the pipeline needs it. The smoke job still works when
   dispatched, and bills one tiny call; its job summary shows the answers and
   their cost:

   ```powershell
   gh workflow run jev-smoke.yml --ref main
   ```

6. **`ANTHROPIC_API_KEY` also serves `ci-summary.yml`**, which comments on a
   red `agent/*` PR (one Haiku 5.5 call per failed run). It cannot be
   dispatched: it runs when `test-agent` fails on such a PR. Its job summary
   and the comment's footer carry what the call cost.

## Starting a task

Create the spec:

```powershell
python .ai/bin/agentctl.py task new AUTH-017
```

Edit `.ai/tasks/AUTH-017/task.json` and `brief.md`, then validate:

```powershell
python .ai/bin/agentctl.py task validate AUTH-017
```

Commit the spec through an ordinary reviewed PR to `main`. Once it has merged,
create the branch from `main` and kick it off:

```powershell
git fetch origin
```

```powershell
git switch -c agent/AUTH-017 origin/main
```

```powershell
git push -u origin agent/AUTH-017
```

```powershell
gh workflow run agent-orchestrator.yml -f task_id=AUTH-017
```

From there it runs itself until it reaches `COMPLETE`, `ESCALATED`, or a state
that needs you.

## Stopping it

Stop now and keep the position; resuming continues from the same state:

```powershell
python .ai/bin/agentctl.py state control AUTH-017 --set PAUSE
```

```powershell
python .ai/bin/agentctl.py state control AUTH-017 --set RUN
```

Stop for good:

```powershell
python .ai/bin/agentctl.py state control AUTH-017 --set CANCEL
```

```powershell
gh workflow run agent-orchestrator.yml -f task_id=AUTH-017 -f event=CANCEL
```

While paused, every workflow event is refused and nothing dispatches. The
branch and its commits are untouched.

Anything already in flight still finishes, and what it reports is not applied:

- **A CI result** is discarded on purpose. The orchestrator run stays green,
  logs a notice naming the run, and records it in `state.json` as `last_ci_run`
  with `"applied": false`. To get a verdict after resuming, re-run CI on the
  branch — that run is the task's verdict like any the orchestrator started.
  On `agent/AUTH-017`, set `RUN`, commit, push, then start CI:

  ```powershell
  python .ai/bin/agentctl.py state control AUTH-017 --set RUN
  ```

  ```powershell
  git commit -am "[agent-state] AUTH-017: resume"
  ```

  ```powershell
  git push
  ```

  ```powershell
  gh workflow run test-agent.yml --ref agent/AUTH-017
  ```

- **A worker's result** is refused: its work commit is pushed, but the run is
  red and the task stays `*_RUNNING`. After resuming, apply the event the
  worker would have (`-f event=AGENT_COMMITTED` if its commit is on the branch),
  or re-dispatch the worker (`operations-recovery.md` "If the chain stalls").

You can also disable the workflows in the Actions tab. The state file is still
correct when you turn them back on — that is the point of keeping state in git
rather than in a session.

## Taking over by hand

The task branch is an ordinary branch. Check it out, fix it, push, open the PR
yourself. Then either let the task sit in whatever state it is in, or cancel
it. Nothing about the agent system needs to be unwound first — no lock, no
lease, no daemon.

## Validating the machinery without spending tokens

The deterministic core:

```powershell
Push-Location .ai; python -m pytest -q; Pop-Location
```

States, guard, policy and every task spec:

```powershell
python .ai/bin/agentctl.py selfcheck
```

`selfcheck` drives a synthetic task through the green path, the green-baseline
rejection, and the retry-to-exhaustion path, and asserts the guard still
refuses a worker reaching for `.ai/` or `.github/`. It runs in CI on every PR
as part of `test-agent`'s `agent-infra-test` job.

## Cost

```powershell
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
it feeds only the fallback estimate, but an estimate on stale prices hides a
gap like the one above.

The repository is public so that Actions minutes are unmetered. Making it
private re-meters them, and a runaway loop then burns the allowance.
