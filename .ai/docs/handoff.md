# Handoff — agent system, as of 2026-09-21

**Read this if you are picking up the AI development pipeline.** It records
what exists, what has actually been proven by running it, what has not, and
what to be careful of. It is a snapshot, not a design document — for the
design read [architecture.md](architecture.md), and for the reasoning and the
review protocol read [philosophy.md](philosophy.md).

Written at the end of the session that built the system and ran it four times.

---

## 1. Where things stand in one paragraph

The agent system is built, merged to `main`, covered by 182 tests, and **it
works**. DEMO-001 ran end to end on 2026-09-21 — `DRAFT` to `COMPLETE`, one
attempt, no retries, no escalation, $0.2738. Getting there took five live runs
and thirteen bugs, every one in the workflow layer rather than the tested core.

Two things still need a human: a dispatch PAT (the `workflow_run` leg of the
chain does not fire under `GITHUB_TOKEN` — confirmed, not theoretical), and the
repository setting that lets Actions open a PR. Both are in
[`../../TODO/01-ai-workflow-setup.md`](../../TODO/01-ai-workflow-setup.md).

**Update 2026-09-21, later the same day.** The repository setting is **done**
(`can_approve_pull_request_reviews: true`, with `default_workflow_permissions`
left at `read`), and so is `delete_branch_on_merge`. The PAT exists with the
right scopes but **is not yet reaching the workflows**: it was created as an
*environment* secret, which no job can read because none declares
`environment:`. `${{ secrets.AGENT_DISPATCH_TOKEN || github.token }}` then
falls back silently, so the stall looks identical to having no token at all.
It has to be a **repository** secret — TODO/01 §7 has the command and, more
importantly, how to confirm it took.

## 2. What exists

| Area | State |
|---|---|
| `.ai/agentlib/` — state machine, guard, spec, orchestrator, distiller, prompt builder, telemetry | Built, 172 tests, stdlib only |
| `.ai/bin/agentctl.py` — the only supported way to touch workflow state | Built, exercised live |
| `.github/workflows/` — orchestrator, worker, guard, plus the existing quality gate | Built, all four have now run |
| `.ai/prompts/`, `.ai/skills/` | Built; the test-agent prompt has been exercised once, for real |
| `.ai/tasks/DEMO-001/` | The validation task. Reached `COMPLETE` 2026-09-21 |
| `.ai/telemetry/` | Working; two invocations, $0.2738 for the full task |
| `.ai/docs/` | philosophy, architecture, state-machine, permissions, threat-model, operations, this file |
| `TODO/` | Human-facing setup checklist. Steps 0–6 and 10–11 done; 7, 7b, 8, 9 outstanding |

Merged: PRs #23 (the system), #25, #26, #27, #28 (fixes from live runs).
`main` is at `60f14bd`. **Open:** #29 (guard fix, all checks green, waiting on
your approval) and #30 (the DEMO-001 work, blocked on #29).

Note `agentctl status` reports `DEMO-001` as `DRAFT` when run from any branch
other than `agent/DEMO-001` — state lives on the task branch by design (§8), so
what you see depends on where you are standing. Same for `telemetry report`.

## 3. What has actually been proven live

Distinguish this carefully from "is implemented".

**Proven:**
- Actions runs the orchestrator and worker; `workflow_dispatch` chaining works
  (orchestrator → worker → orchestrator all fired under the default
  `GITHUB_TOKEN`).
- `validate` → `state init` → state committed to the task branch → orchestrator
  re-dispatches itself. Two runs before the test agent starts, by design.
- The provider call works. One real invocation: 75s, 4,958 tokens, **$0.074**.
- The test agent wrote exactly the right file, in scope, from the assembled
  prompt.
- The guard rejects an out-of-scope diff and the work is discarded.
- The retry bounds hold: a failing task now stops in four runs instead of
  ping-ponging forever.
- Telemetry records and aggregates real cost.

- **The red-baseline gate**, against real CI: 2 failed / 474 passed,
  `assert 404 == 200`, and the task advanced to implementation on the strength
  of the failure.
- CI triggered by the orchestrator via `workflow_dispatch` on a task branch.
- The code agent: implemented `GET /health/version`, CI green first attempt.
- A task reaching `COMPLETE`.

**Disproven:**
- **`workflow_run` does not wake the orchestrator.** GitHub does not fire it for
  a run the default `GITHUB_TOKEN` started, so the CI-finished leg never fires.
  DEMO-001 stalled at `BASELINE_CI` and again at `IMPL_CI`. See §5.1 — the PAT
  is now required, not conditional.
- **`gh pr create` is refused** by default: "GitHub Actions is not permitted to
  create or approve pull requests". A repository setting; the task still
  completes, only the PR is missing.

**Still not proven:**
- The distiller, the context maintainer, the manager decision path — DEMO-001
  passed first time, so no failure path ran.
- A guard violation escalating and being pushed (fixed in #27, never exercised).
- Any retry at all: `attempt` never went past 1.
- **An agent PR merging.** `agent-guard` ran on one for the first time and
  failed it (bug 14). Fixed in #29, and the fix is verified against the real
  branch diff — but no agent PR has actually merged yet.

## 4. The fourteen bugs, and what they have in common

Recorded because the pattern matters more than the list.

| # | Bug | Fixed in |
|---|---|---|
| 1 | `agentctl next` refused to run without a state file — but the action it returns is what creates that file | #25 |
| 2 | Dispatching a worker never emitted `DISPATCH_*`, so `AGENT_COMMITTED` was illegal **and the attempt counter never incremented** | #25 |
| 3 | The two orchestrator triggers used different concurrency keys for one task | #25 |
| 4 | `agentctl status` keyed on state files, so an unstarted task was invisible | #25 |
| 5 | `AGENT_FAILED` routed to `MANAGER_REVIEW` from `MANAGER_REVIEW` — unbounded loop | #26 |
| 6 | `invoke_agent.sh` redirected the CLI's stdout, where `--print` mode reports errors, so eight failures said only "exit code 1" | #26 |
| 7 | The pre-commit hook gated on the test suite, making the repo's own mandated "commit the failing test alone" impossible | #26 |
| 8 | Workflow scratch files written into the checkout, staged by `git add -A`, correctly rejected by the guard | #27 |
| 9 | A guard failure failed the job, so the escalate step never ran and the task stalled in `*_RUNNING` forever | #27 |
| 10 | `${{ runner.temp }}` in job-level `env` — GitHub rejects the whole workflow file | #27 |
| 11 | Commit subject doubled its own `<TASK-ID> <verb>:` prefix, truncating real content | #29 |
| 12 | `gh pr create`'s blanket `\|\|` reported every failure as "already exists", hiding a repository setting | #29 |
| 13 | Nothing stopped a workflow from *approving* a PR once PR-creation is enabled | #29 |
| 14 | `agent-guard` flagged the orchestrator's own state commits as an agent breaching `.ai/` — a required check that **no agent PR could ever pass** | #29 |
| 15 | CI re-running on a **finished** task's branch woke the orchestrator, which tried to apply `CI_PASSED` to a COMPLETE task. The state machine correctly refused; the step's non-zero exit failed the whole run, painting a red X on a healthy pipeline every time a completed task's review PR was brought up to date | pending |

**Every single one was in the workflow layer, and none was visible to the unit
tests.** The tested core was right each time. `next_action` was always handed a
state dict, so the CLI wrapper was never exercised (#1). The role→event mapping
lived in YAML, where no test could reach it (#2). `yaml.safe_load` validates
syntax, not context availability (#10).

Three test files now close that gap: `test_cli.py` (the real entry point as a
subprocess), `test_workflows.py` (structural invariants of the YAML, plain text
so `.ai/` stays stdlib-only), and the dispatch-contract tests in
`test_e2e_workflow.py`. **When you add behaviour to a workflow, add it to the
structural tests too** — that is where the bugs have all been.

Bug 5 deserves separate attention: "retry loops have hard limits" was the
design's most important promise, and the budget only ever counted code-agent
dispatches. A provider failing *before doing any work* was in no budget at all.
There are now three independent bounds (see `state.py` and
`orchestrator.MAX_TRANSITIONS`). When you add a new failure path, ask which
budget counts it.

## 5. CI/CD considerations — read before changing anything

### 5.1 `workflow_run` chaining does not work — narrowed, 2026-09-22

The orchestrator wakes after CI via `on: workflow_run`. GitHub restricts
workflows triggered by the default `GITHUB_TOKEN` from triggering further runs
in some circumstances. `workflow_dispatch` chaining is now proven to work; the
`workflow_run` leg is **not**.

⚠️ **The original wording was too broad, and believing it costs you a
debugging session.** `workflow_run` fires perfectly well for a `test-agent` run
triggered by a `pull_request` or a `push` — run 35670385955 is the proof: the
orchestrator woke on an `agent/DEMO-001` PR check and executed (it then failed
on bug 15, which is a different bug). What GitHub suppresses is narrower:

> a `workflow_run` event for a run that **this repository's own workflow
> started using the default `GITHUB_TOKEN`**.

That is exactly the CI-finished leg — the orchestrator dispatching
`test-agent.yml` via `gh workflow run` and expecting to be woken when it ends.
Hence the stalls at `BASELINE_CI` and `IMPL_CI`, and hence the PAT.

**Consequences worth knowing before you debug this:**

- A **skipped** orchestrator run on `main`, or on any non-`agent/*` branch, is
  the job's `if:` doing its job. It is not the token failing. Most runs in the
  Actions tab are these.
- **A merged PR proves nothing about the token**, whichever branch it came
  from. Neither does a PR check run. Only a task whose CI the *orchestrator
  itself* dispatched exercises the fixed leg.
- A task that has reached `COMPLETE` will never exercise it again. Testing the
  token needs a **new task**.

If a task stalls in `IMPL_COMMITTED` or `BASELINE_CI` with no new run, that is
this. Fix: a fine-grained PAT as `AGENT_DISPATCH_TOKEN` (`Actions: read+write`,
`Contents: read+write`, this repo only). Every dispatch step already prefers it.

**It must be a repository secret.** An environment secret with the same name is
invisible to these workflows — a job only receives environment secrets when it
declares `environment: <name>`, and none of them do. The `||` fallback then
hides the miss: the run succeeds, uses `github.token`, and stalls exactly as it
did before. If you think the token is set and the stall persists, check
`gh secret list` (repository scope) before looking anywhere else.

⚠️ **Security interaction.** A fine-grained PAT is owned by a person, so
workflows using it act *as that person* — and would inherit that person's
ruleset bypass. The PR-creation step is deliberately pinned to `github.token`
so agent PRs stay bot-authored; keep it that way, and do not widen the PAT.

### 5.2 `paths-ignore` can strand a PR

`test-agent.yml`'s `pull_request` trigger ignores `.ai/tasks/**` and
`.ai/telemetry/**`, so state commits do not re-run CI. Consequence: **a PR whose
diff is *only* those paths never runs CI, so required checks never report and
the PR cannot merge.** Agent PRs normally contain code too, so this is latent
rather than active — but if you ever see a PR blocked with no checks at all,
this is why.

### 5.3 A skipped required check

`agent-guard` is a required check and skips itself on non-`agent/*` branches.
GitHub has treated the skip as satisfying the requirement on every PR so far
(#25, #26, #27 all merged). It works; know that it is load-bearing before you
change the `if:` condition.

### 5.4 Concurrency can drop a transition

Both orchestrator jobs share a group with `cancel-in-progress: false`. GitHub
keeps only **one** pending run per group — a third concurrent trigger is
dropped, not queued. A dropped orchestrator run means a missed transition and a
stalled task. It has not happened, but the design assumes queuing that GitHub
does not actually provide. A `workflow_dispatch` nudge always recovers it.

### 5.5 The orchestrator has no timeout — closed

`agent-worker.yml` sets `timeout-minutes: 45`. `agent-orchestrator.yml` set
nothing, so it inherited the 6-hour default — and a hung orchestrator holds the
concurrency group for its task, blocking every subsequent transition (§5.4).

**Closed 2026-09-21:** `timeout-minutes: 15` on the orchestrate job, generous by
an order of magnitude for a job that performs one transition and exits.
`TestEveryJobIsBounded` in `test_workflows.py` now fails the build if either
workflow drops its timeout — per §4's rule, the fix and its structural test
landed together.

### 5.6 The provider CLI is installed unpinned

`agent-worker.yml` runs `npm install -g @anthropic-ai/claude-code` on every run.
The CLI can change under you and break the workflow with no change on your side.
Pin a version, or move to a self-hosted runner with it preinstalled. Also costs
~20–30s per invocation.

### 5.7 Nothing here deploys, and that is deliberate

The agent system touches no AWS. `cdk deploy` remains out of scope repo-wide,
`GitHubActionsDeployRole` still has no permissions policy, and the IAM review in
`TODO/02-deployment-requirements.md` §3 is the gate. **Do not wire deployment
into the agent workflows** — a pipeline that can deploy is a different risk
class, and the permission model here was not designed for it.

### 5.8 Repository visibility and cost

The repo was made public to get unmetered Actions minutes. Making it private
again re-meters them, and a runaway loop then burns the allowance — as one
nearly did. Model cost is separate and tracked:
`python .ai/bin/agentctl.py telemetry report`.

Current spend: **$0.074** of a $15 credit. A full DEMO-001 pass should be
$0.15–0.25. The manager is configured to `claude-opus-5` (5× sonnet's rate);
changing that is a one-line edit in `.ai/config.json` and needs no workflow
change — that is what the file is for.

## 6. Immediate next steps

Rewritten 2026-09-21 after DEMO-001 completed; the earlier list (reset the stuck
task, watch the red baseline) is done and gone.

1. **Make the dispatch token reachable.** Repository secret, not an environment
   secret — §5.1 and TODO/01 §7. Nothing else on this list is worth doing first,
   because every task still needs two manual nudges until it is fixed.
2. **Revoke the old `fanwire token` PAT.** It holds `administration`, `secrets`
   and `workflows` write on this repo and its value is unaccounted for. A token
   with `workflows: write` can rewrite the permission model this system is built
   on. TODO/01 §7b.
3. **Merge #29, then update-branch and merge #30.** #30's `agent-guard` failure
   is bug 14 and only clears once #29's fix is in its merge base — a bare re-run
   fails again.
4. **Then watch for the two still-unproven things**, in this order: an agent PR
   that `agent-guard` passes (§3), and a PR **opened by the workflow** rather
   than by hand — the setting that blocked it is now on, so the next completed
   task is the test.
5. **Exercise a failure path on purpose.** Everything in §3's "still not proven"
   list is a success path that happened to work first time. A task with a
   deliberately impossible acceptance criterion would exercise the distiller,
   the manager decision and a real retry for the cost of one cheap run.
6. Then decide whether DEMO-001's endpoint is worth keeping, and point the
   system at a real task.

## 7. How to work on this system

- The repo's own workflow applies to `.ai/` too: failing test committed alone,
  then the implementation. The pre-commit hook is advisory on tests for exactly
  this reason, and blocking on lint.
- Run `cd .ai && python -m pytest -q` and `python .ai/bin/agentctl.py selfcheck`
  before pushing. Both are fast and free.
- `yaml.safe_load` is not enough for workflow changes. It validates syntax, not
  context availability or trigger semantics. Add to `test_workflows.py`.
- Never let an agent-authored branch merge itself. Nothing in the system has
  merge permission; keep it that way.
- When you fix something a live run exposed, record the run id in the commit
  message. Every bug above is traceable to one, and that is what made the
  pattern in §4 visible.

## 8. Open questions worth a reasoning pass

Not bugs — judgement calls the next person should make deliberately:

- **Is `--permission-mode acceptEdits` right for a non-interactive worker?** It
  auto-accepts edits but may auto-deny other tools with no TTY. The one
  successful invocation produced a file, so edits work; whether an agent that
  needs to *run* something can is untested.
- **Should the manager be opus?** It is the most expensive role and the least
  frequently invoked. Cheap while rare; the escalation rate decides.
- **Should state live on the task branch at all?** It makes the PR
  self-documenting, which is why it was chosen — but it also produced 11 junk
  `[agent-state]` commits during the loop incident and forces `paths-ignore`
  (§5.2). An `agent-state` branch was the alternative.
- **What is the next thing to automate?** `philosophy.md` §6 holds the standing
  backlog and the rule that proposals must cite a trace.
