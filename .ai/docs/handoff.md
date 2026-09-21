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

## 2. What exists

| Area | State |
|---|---|
| `.ai/agentlib/` — state machine, guard, spec, orchestrator, distiller, prompt builder, telemetry | Built, 172 tests, stdlib only |
| `.ai/bin/agentctl.py` — the only supported way to touch workflow state | Built, exercised live |
| `.github/workflows/` — orchestrator, worker, guard, plus the existing quality gate | Built, all four have now run |
| `.ai/prompts/`, `.ai/skills/` | Built; the test-agent prompt has been exercised once, for real |
| `.ai/tasks/DEMO-001/` | The validation task. Never completed |
| `.ai/telemetry/` | Working; one real invocation recorded |
| `.ai/docs/` | philosophy, architecture, state-machine, permissions, threat-model, operations, this file |
| `TODO/` | Human-facing setup checklist. Steps 0–5 done, step 6 outstanding |

Merged: PRs #23 (the system), #25, #26, #27 (fixes from live runs).
`main` is at `42d6be9`.

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

## 4. The thirteen bugs, and what they have in common

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

### 5.1 `workflow_run` chaining does not work

The orchestrator wakes after CI via `on: workflow_run`. GitHub restricts
workflows triggered by the default `GITHUB_TOKEN` from triggering further runs
in some circumstances. `workflow_dispatch` chaining is now proven to work; the
`workflow_run` leg is **not**.

If a task stalls in `IMPL_COMMITTED` or `BASELINE_CI` with no new run, that is
this. Fix: a fine-grained PAT as `AGENT_DISPATCH_TOKEN` (`Actions: read+write`,
`Contents: read+write`, this repo only). Every dispatch step already prefers it.

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

### 5.5 The orchestrator has no timeout

`agent-worker.yml` sets `timeout-minutes: 45`. `agent-orchestrator.yml` sets
nothing, so it inherits the 6-hour default. **This is a one-line gap worth
closing** — a hung orchestrator holds the concurrency group for its task and
blocks every subsequent transition.

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

1. **Reset the stuck task.** `agent/DEMO-001` is in `TEST_AGENT_RUNNING` with no
   path forward (bug 9 left it there before the fix existed):
   ```sh
   git push origin --delete agent/DEMO-001 && git branch -D agent/DEMO-001
   git switch main && git pull
   git switch -c agent/DEMO-001 main && git push -u origin agent/DEMO-001
   gh workflow run agent-orchestrator.yml -f task_id=DEMO-001
   ```
2. **Watch the red baseline.** The first genuinely new territory. A green
   baseline routing to `MANAGER_REVIEW` is a *success* — the gate working.
3. **Watch for the `workflow_run` stall** (§5.1). Most likely place to break.
4. **Close §5.5** (orchestrator timeout). One line.
5. Then decide whether DEMO-001's endpoint is worth keeping, and point the
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
