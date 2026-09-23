# Handoff — agent system, as of 2026-09-23

**Read this if you are picking up the AI development pipeline.** It records
what exists, what has actually been proven by running it, what has not, and
what to be careful of. It is a snapshot, not a design document — for the
design read [architecture.md](architecture.md), and for the reasoning and the
review protocol read [philosophy.md](philosophy.md).

Written at the end of the session that built the system and ran it four times.

---

## 1. Where things stand in one paragraph

The agent system is built, merged to `main`, covered by 211 tests, and **the
whole chain now runs unattended**. DEMO-001 went `DRAFT` to `COMPLETE` on
2026-09-21. USERS-002 on 2026-09-22 went further in the one way that mattered:
the orchestrator **woke itself after CI** with no human nudge, which is the leg
that had stalled every previous task twice. Seventeen bugs so far, none of them
in the tested core.

**Nothing is waiting on a human to make the pipeline work.** The dispatch token
is a repository secret and proven; Actions may open PRs and has; branch
protection, the pre-commit hook and the red-baseline gate all hold. What is left
is ordinary work, not setup.

**Where USERS-002 actually is.** Its first run reached green implementation CI
and then escalated on the bookkeeping step — bug 16, a spec I wrote that was
impossible to satisfy. #34 was closed unmerged, the branch deleted, and the task
is back at `DRAFT` awaiting a clean rebuild. The code that run produced was
correct; it was discarded on purpose, so the rerun is a genuine first pass
rather than a repair.

## 1a. The one thing that will surprise you next

**A PR opened by the workflow arrives with no checks at all.** #34 sat
`BLOCKED` reporting nothing, because workflows on a PR authored by
`github-actions[bot]` land in `action_required` and wait for a human to approve
the run before CI will execute.

This is not §5.2's `paths-ignore` trap and not a misconfiguration — it is
GitHub's default for bot-authored PRs, and no workflow had ever opened one
before, so nobody had hit it. Approve the run from the Actions tab and the
checks proceed normally.

It is worth deciding deliberately whether that is a feature. A human gate
between an agent finishing and CI spending minutes on its work is arguably the
right shape for this system.

## 2. What exists

| Area | State |
|---|---|
| `.ai/agentlib/` — state machine, guard, spec, orchestrator, distiller, prompt builder, telemetry | Built, 172 tests, stdlib only |
| `.ai/bin/agentctl.py` — the only supported way to touch workflow state | Built, exercised live |
| `.github/workflows/` — orchestrator, worker, guard, plus the existing quality gate | Built, all four have now run |
| `.ai/prompts/`, `.ai/skills/` | Built; the test-agent prompt has been exercised once, for real |
| `.ai/tasks/DEMO-001/` | The validation task. Reached `COMPLETE` 2026-09-21 |
| `.ai/telemetry/` | Working; DEMO-001 cost $0.2738, USERS-002's discarded run ~$0.25 |
| `.ai/docs/` | philosophy, architecture, state-machine, permissions, threat-model, operations, this file |
| `TODO/` | Human-facing checklist. **01 is effectively done** — every setup step closed. 02 is AWS/domain (zone live, bootstrapped, IAM attached; dev S3 buckets outstanding). 03 holds the answered product decisions |

Merged: #23 (the system), #25–#33, #35. #34 was the workflow's own first PR
and was **closed unmerged** on purpose (bug 16). No PR is open except the one
carrying this document.

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

**Proven on 2026-09-22, by USERS-002:**
- **`workflow_run` wakes the orchestrator after CI.** Run 35768127169, 12
  seconds after the baseline CI finished, no human nudge. This is the leg that
  stalled DEMO-001 twice and it is the *only* thing that ever tested
  `AGENT_DISPATCH_TOKEN`. §5.1 is now closed.
- **A guard violation escalating, being pushed, and discarding the work**
  (fixed in #27, never exercised until now). Run 35768890588: the context
  maintainer's write was refused, its work discarded, the task escalated, and
  the state committed and pushed. Exactly the designed behaviour, against a
  real violation nobody staged.
- **The workflow opened its own PR.** #34, author `app/github-actions`. The
  setting was off for every earlier run, so this had never happened.
- A red baseline red for the right reason on a *real* task: `assert 201 == 422`
  against the age gate, not a contrived assertion.

**Still not proven:**
- The distiller and the manager decision path — no failure has yet routed
  through them.
- **The context maintainer succeeding.** Its one run was refused by the guard
  (bug 16), so the wiki-update step has still never completed. USERS-002's
  rebuild is the next chance.
- Any retry at all: `attempt` has never gone past 1 on any task.
- **An agent PR merging.** #34 exists but is `BLOCKED` with **no checks
  reported** — workflows on a PR opened by `github-actions[bot]` land in
  `action_required` and need a human to approve the run before CI executes.
  That is a new operational step nobody had hit before, because no workflow had
  ever opened a PR.

## 4. The seventeen bugs, and what they have in common

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
| 15 | CI re-running on a **finished** task's branch woke the orchestrator, which tried to apply `CI_PASSED` to a COMPLETE task. The state machine correctly refused; the step's non-zero exit failed the whole run, painting a red X on a healthy pipeline every time a completed task's review PR was brought up to date | #31 |
| 16 | A spec with `run_context_maintainer: true` and no `wiki/CodeContext/Modules/*.md` in `allowed_paths` is **unsatisfiable**: the maintainer's only permitted write is refused as `outside_task_scope`, so a task whose code and tests are green escalates on the bookkeeping step. Cost a whole successful USERS-002 pass. Not a workflow bug this time — a **Director** bug, in a spec, that nothing validated | #35 |
| 17 | A human branch cut while HEAD was on `agent/USERS-002` carried two `[agent-state]` commits and a **mid-flight `state.json`** onto `main` through #35. The next run of that task would have read `TEST_AGENT_RUNNING` from `main` and stalled — a task that looks rebuilt and cannot move | #36 |

**Bugs 1–15 were in the workflow layer, and none was visible to the unit
tests. Bugs 16 and 17 were not in the workflow layer at all** — 16 was a task
spec, 17 was a branch point. The honest generalisation is not "workflow YAML is
where this breaks" but **"the artifacts the tested core consumes are where this
breaks"**: YAML it never parses, JSON specs it is handed, and the git history
it is run against. The core itself has been right every time.

Of the originals: The tested core was right each time. `next_action` was always handed a
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

Rewritten 2026-09-23. Setup is finished; everything here is ordinary work.

1. **Rebuild USERS-002.** Cut `agent/USERS-002` from a `main` that no longer
   carries the leaked `state.json` (bug 17) and dispatch. It is the first task
   expected to run `DRAFT`→`COMPLETE` *including* the context-maintainer step,
   which has still never completed.
2. **Approve the run on the PR it opens** (§1a) and merge it. That closes the
   last unproven item: an agent PR reaching `main`.
3. **Then INFRA-002**, which unblocks the first real deploy — nothing uploads
   the frontend to S3 today, so a deploy serves an empty bucket.
4. **Exercise a failure path on purpose.** The distiller, the manager decision
   and any retry at all remain unproven; `attempt` has never gone past 1 on any
   task. A task with a deliberately impossible criterion buys all three for the
   price of one cheap run.
5. The dev S3 buckets (`TODO/02` §7) and then MEDIA-002, if browser-clickable
   media matters before the frontend exists.

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
- **Cut every branch from `origin/main` explicitly**, not from whatever HEAD
  happens to be:

  ```powershell
  git switch -c <name> origin/main
  ```

  `git switch -c <name>` alone branches from the current HEAD, and in a session
  that has been inspecting a task branch that is not `main`. Bug 17 is what
  that looks like: a PR that reviewed as a two-file change and merged another
  task's mid-flight state onto `main`. The `pre-push` hook now refuses it, but
  the hook is a convenience and `--no-verify` skips it.
- **State on `main` is not inert.** `.ai/tasks/<ID>/state.json` is what the next
  run of that task reads. A finished state arriving with a merged agent PR is
  the design; anything mid-flight on `main` means something leaked, and the
  task it names will stall rather than start.

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
