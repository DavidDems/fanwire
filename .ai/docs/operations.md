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
| `max_attempts_exhausted` | The code agent used its whole budget | Read the diff. Usually the spec was under-specified, or the tests pin the wrong thing. |
| `red_baseline_not_red` | The tests passed without an implementation | Re-scope: the criteria were not testable as written. |
| `guard violation: ...` | A worker wrote outside its paths | Read the run log. Either `allowed_paths` is too narrow for a legitimate change, or something went genuinely wrong. Work was discarded. |
| `provider invocation failed` | The model call errored | Usually transient. `MANAGER_RETRY` or re-dispatch. |

Then drive it by hand:

```bash
gh workflow run agent-orchestrator.yml -f task_id=AUTH-017 \
  -f event=MANAGER_RESCOPE -f reason="criteria were not testable"
```

Legal events are in `agentlib/state.py`'s `EVENTS`. An illegal one is refused
with an error rather than half-applied.

## Taking over by hand

The task branch is an ordinary branch. Check it out, fix it, push, open the PR
yourself. Then either let the task sit in whatever state it is in, or cancel
it. Nothing about the agent system needs to be unwound first — no lock, no
lease, no daemon.

## If the chain stalls

Each run wakes the next one with `gh workflow run`. GitHub restricts workflows
triggered by the default `GITHUB_TOKEN` from triggering further runs in some
situations, so if a task sits in a state with nothing happening:

1. Check the Actions tab — did the next run get created at all?
2. If not, add a fine-grained PAT with `actions: write` as
   `AGENT_DISPATCH_TOKEN`. Every dispatch step prefers it and falls back to
   `github.token`.
3. Either way, you can always nudge it manually:
   `gh workflow run agent-orchestrator.yml -f task_id=<ID>`

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

Per task, per role, per model: invocations, tokens, estimated cost, attempts,
escalations. The numbers that matter over time are cost per *successful* task
and the Manager escalation rate — if the second is climbing, task specs are
under-specified, and that is a Director problem, not a model problem.
