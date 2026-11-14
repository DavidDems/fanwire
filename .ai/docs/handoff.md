---
type: reference
---

# Handoff — agent system

**Read this if you are picking up the AI development pipeline.** It says what
is proven live and what is not, and keeps the 2026-10-08 review's defect
record (§10). Where things are:

| For | Read |
|---|---|
| Design | [architecture.md](architecture.md) |
| Protocol | [state-machine.md](state-machine.md) |
| Running it | [operations.md](operations.md) |
| Permissions | [permissions.md](permissions.md) |
| Threats | [threat-model.md](threat-model.md) |
| Reasoning and the review protocol | [philosophy.md](philosophy.md) |
| Choices | [`wiki/GeneralContext/Decisions/`](../../wiki/GeneralContext/Decisions/) |
| Open work | [`TODO/02-backlog.md`](../../TODO/02-backlog.md) "Agent system" |
| Project status | [`wiki/GeneralContext/index.md`](../../wiki/GeneralContext/index.md) |
| Live proof | [handoff-live-proof.md](handoff-live-proof.md) |

## 1. Where things stand

The agent system is built and on `main`. Three tasks have run through the
orchestrator end to end: `DEMO-001`, `USERS-002` and `MEDIA-002` (§10.5). Every
unit since is run by hand on the human's subscription
([ADR 0027](../../wiki/GeneralContext/Decisions/0027-work-modes.md)), and
`agentctl hand start|finish` records each one in its state file. The review's
fixes D1–D7 are merged (§10.1). `jev` is wired and switched off
([ADR 0025](../../wiki/GeneralContext/Decisions/0025-jev-shadow-only-switched-off.md)).

## 3. What has been proven live

Proven means a real run did it; implemented is not proven. The list, with its
evidence, and what is still unproven: [handoff-live-proof.md](handoff-live-proof.md).

## 4. The seventeen bugs, and what they have in common

Bugs 1–15 were in the workflow layer, invisible to the unit tests. Bug 16: a
spec with `run_context_maintainer: true` and no `wiki/CodeContext/Modules/*.md`
in `allowed_paths` is unsatisfiable; `sp.validate` rejects it. Bug 17: a human
branch cut from `agent/<ID>` carried `[agent-state]` commits and a mid-flight
`state.json` onto `main`; `guard-gate` rejects task state on non-`agent/*`
PRs. Other documents cite both shapes.

The generalisation: **the artifacts the tested core consumes are where this
breaks** — YAML it never parses, JSON specs it is handed, the git history it
runs against. `test_cli.py`, `test_workflows.py` and the dispatch-contract
tests in `test_e2e_workflow.py` close that gap: add workflow behaviour there.

Bug 5: the retry budget counted only code-agent dispatches, so a provider
failing before any work was in no budget. There are three independent bounds
(`state.py`, `orchestrator.MAX_TRANSITIONS`); for a new failure path, ask which
budget counts it. The full table:
[the seventeen bugs](https://github.com/DavidDems/fanwire-archive/blob/e162a5a1cff488e60d23addf349c8f0d710eba25/.ai/docs/handoff.md#4-the-seventeen-bugs-and-what-they-have-in-common).

## 5. CI/CD considerations — read before changing anything

### 5.4 Concurrency can drop a transition

Both orchestrator jobs share one group per task with `cancel-in-progress:
false`. GitHub keeps one pending run per group, so a third concurrent
orchestrator trigger is dropped, not queued. A lost transition shows as
`STALLED` ([state-machine.md](state-machine.md) "Bounded and detectable").

### 5.5 The orchestrator has a timeout

The orchestrate job has `timeout-minutes: 15`, so a hung run cannot hold its
task's concurrency group; `TestEveryJobIsBounded` in `test_workflows.py` fails
the build if any agent workflow drops its timeout.

### 5.6 The provider CLI is pinned

The one place is `.ai/config.json`, `providers.anthropic.cli_package` /
`cli_version`. The install step reads main's copy, refuses anything but an
exact `x.y.z`, and fails unless `claude --version` matches.
`TestTheToolchainIsPinnedInOnePlace` fails any other install in
`.github/workflows/` or `.ai/bin/`. Renovate's `claude CLI` PR moves the pin,
labelled `recheck-d2b-flags`: confirm `--setting-sources` and
`--strict-mcp-config` are still in `claude --help` (D2b) before merging. The
first worker run after a bump is the proof.
[Renovate setup](../../wiki/GeneralContext/Architecture/github-automation-setup-renovate.md);
the choice: [ADR 0026](../../wiki/GeneralContext/Decisions/0026-agent-models-cli-pin-and-spend-controls.md).

### 5.7 Nothing here deploys, and that is deliberate

No agent workflow runs `cdk deploy` or touches AWS. **Do not wire deployment
into the agent workflows**
([ADR 0033](../../wiki/GeneralContext/Decisions/0033-deployment-stays-outside-agent-workflows.md)).

`.github/workflows/deploy.yml` runs on merge to `main` and on dispatch, each
run waiting for a human's approval in the `production` environment.
`GitHubActionsDeployRole` trusts that environment and holds only
`sts:AssumeRole` on the eight CDK bootstrap roles (its policy,
`CdkBootstrapAssumeRole`, is `infra/iam/github-actions-deploy-role-policy.json`).
`test_deploy_workflow.py` fails if any other workflow requests an OIDC token,
declares an environment, or names `deploy.yml`. `cfn-exec-role` is narrowed,
and every role the stacks create carries `FanwireRoleBoundary`, so a deployed
template cannot reach IAM or STS through a role it writes. The IAM review is
recorded in the
[deployment-requirements record](https://github.com/DavidDems/fanwire-archive/blob/95339e87be1f15815d46bcd08ccc51f91ea4dd60/TODO/02-deployment-requirements.md).
Design and limits: `wiki/CodeContext/Standards/build-deployment.md` →
"Automated deploy".

## 6. Open proof work

1. The first worker run on the pinned CLI: it proves the install check and the
   D2b items only a live run proves (§10.1).
2. The D3 failure paths no run has taken (§10.1).
3. **Exercise a failure path on purpose.** The distiller, the manager decision
   and any retry are unproven. One task with a deliberately impossible
   acceptance criterion exercises all three.

`TODO/02-backlog.md` "Agent system" tracks them.

## 7. How to work on this system

- Test-first applies to `.ai/` too; the pre-commit hook is advisory on tests
  for that reason, and blocking on lint. Suites: [AGENTS.md](../../AGENTS.md)
  "Build / test / run".
- `yaml.safe_load` validates syntax, not context availability or trigger
  semantics: add workflow checks to `test_workflows.py`.
- Nothing merges itself: no workflow gets merge or approval permission, and
  the tests asserting neither exists stay.
- Record the run id when fixing what a live run exposed; fix only what you can
  evidence.
- Do not wire deployment into the agent workflows (§5.7) or widen
  `AGENT_DISPATCH_TOKEN` ([permissions.md](permissions.md) "Secrets").
- **Cut every branch from `origin/main` explicitly:**

  ```powershell
  git switch -c <name> origin/main
  ```

  The `pre-push` hook refuses bug 17's shape, but `--no-verify` skips it;
  `guard-gate` does not.
- **State on `main` is not inert:** the next run of a task reads its
  `state.json` there. A finished state with a merged agent PR is the design;
  anything mid-flight means something leaked.
- What a Director is: [AGENTS.md](../../AGENTS.md) "Agent system".

## 9. The open-items brief

### 9.2 The open items

Executed. Item 1, the CI half of bug 17, is proven
([handoff-live-proof.md](handoff-live-proof.md)); items 2–4 are closed by D3
and the CLI pin (§10.1, §5.6); item 5 is ADR 0023; item 6 is closed. The
brief:
[the archived §9](https://github.com/DavidDems/fanwire-archive/blob/e162a5a1cff488e60d23addf349c8f0d710eba25/.ai/docs/handoff.md#9-brief-close-the-open-items-starting-with-an-independent-flow-review).

## 10. The workflow review, 2026-10-08

A safety, performance and cost review of the whole flow, starting from a
read-only enumeration of every trigger, branch, state and conclusion. Its
independence was not achieved: both readers saw the sealed scoring key first
(`philosophy.md` §7).

### 10.1 Defects

Grade is the enforcement the fix reaches (philosophy.md §4).

| # | Defect | Evidence | Fix | Grade |
|---|---|---|---|---|
| D1 | The orchestrator trusted **any** `workflow_run` on a branch named `agent/*` as the task's CI verdict | It checked only the branch prefix; the repo is public and forks are allowed | Accept only `event == workflow_dispatch`, `head_repository == github.repository`, `head_sha` == branch tip (`guard tested`, `TestOnlyTheOrchestratorsOwnCiRunIsTrusted`); fork approval set to all external contributors | impossible |
| D2 | The worker's checkout handed the model a GitHub token; the orchestrator interpolated dispatch inputs into shell | `actions/checkout` persisted `GITHUB_TOKEN` in `.git/config` | `persist-credentials: false` in the worker; inputs via `env:`; the task id validated against `TASK_ID_SAFE`; see D2b | impossible |
| D2b | Worker/credential isolation | [Decision and original evidence](../../wiki/GeneralContext/Decisions/0002-worker-credential-isolation.md) | Protocol: [permissions](permissions.md) and trusted workflow definitions. Live proof and residue remain below this table. | impossible |
| D3 | Bounded orchestration and a human escalation exit | [Decision and original evidence](../../wiki/GeneralContext/Decisions/0001-bounded-orchestration.md) | Protocol: [state machine](state-machine.md); recovery: [operations](operations.md). Live proof and residue remain below this table. | detected → escalated |
| D4 | Red baseline failures must have the right reason | [Decision and original evidence](../../wiki/GeneralContext/Decisions/0003-red-baseline.md) | Protocol: [state machine](state-machine.md); recovery: [operations](operations.md). Live proof gaps and residue remain below this table. | escalated |
| D5 | Required lint and type checks before merge | [Decision and original evidence](../../wiki/GeneralContext/Decisions/0004-required-quality-checks.md) | Protocol: [test workflow](../../.github/workflows/test-agent.yml) and [state machine](state-machine.md). Live proof gaps and residue remain below this table. | detected |
| D6 | Provider cost and usage provenance | [Decision and original evidence](../../wiki/GeneralContext/Decisions/0005-provider-cost-telemetry.md) | Contract: [invocation result](../agentlib/agentresult.py) and [telemetry](../agentlib/telemetry.py); reporting: [Cost](operations.md#cost). Live proof gaps and residue remain below this table. | detected |
| D7 | Hand-run lessons never reached the workers | `frontend-unit` told a worker to run `npm`/`docker`, which it cannot | The skills carry the hand-run traps; `tests/test_skills.py` fails a skill that hands a worker a shell command. Ruff is pinned exactly (D5 residue) | prompt only |

**D6, proof gaps and residue:** Unproven until live: the envelope on CI's CLI version, multi-turn cost, a real `permission_denials` entry, cost on a non-zero CLI exit. Residue: the provider figure is read from a file the model's user could touch (not a new boundary: the tokens came from the same file); nothing reconciles it with the Console

**D5, proof gaps and residue:** Unproven until live: the cache reads, `--log-failed`'s `Process completed` line, `compose run -T --no-deps --entrypoint` on the runner. Residue: ruff/mypy were `>=`-pinned, so a cache-evicted rebuild could bring new rules and turn every PR red — **pinned 2026-10-19** at `ruff==0.17.1`, `mypy==2.4.0`, the versions CI's last green main run built (test-agent run 39295837789; §5.6, `Prompts/09` deliverable 2); test agents cannot run lint (D7); `ruff format` is not gated; `distill` does not parse vitest's per-test lines; Renovate moves both pins (`backend/pyproject.toml`)

**D4, proof gaps and residue:** Unproven until a live failure: the log fetch from a `workflow_run` job, real vitest output (fixtures are hand-written), both suites red at once. Residue: it guards against incidental red, not a hostile test agent; MANAGER_RETRY after a baseline still skips the check (D3 residue); a re-run of a baseline still means editing `state.json` (`operations.md`)

Also from the enumeration, lower severity: `MAX_CONSECUTIVE_FAILURES` is
unreachable through the workflows (it peaks at 2); `INFRA_FAILED` is emitted by
no workflow; the YAML's `HOPS > 200` guard is dead code behind
`MAX_TRANSITIONS`; `extra_attempts` is never passed, so `MANAGER_RETRY` always
grants 1.

**D2b, what only the first live run proves** — `MEDIA-002` (§10.5) proved the
normal path of every item below except the CLI version (the CLI is pinned
since, §5.6) and `land` after a failed or cancelled `run-model`, which no step of it
exercised: artifact hand-over between the jobs, and `land` running after a
failed or cancelled `run-model`; `agentrun` on a hosted runner — `useradd` and
`sudo`, `o+x` being enough to reach the checkout, the tools and its I/O
directory, the npm-global CLI on the `PATH` it is given and runnable by that
user with an empty `HOME`, `pkill`/`pgrep`; the CLI accepting
`--setting-sources user --strict-mcp-config` (checked with `claude --help` on
each pinned version — no live run on the pin yet, §5.6); `github.sha` being
`main`'s commit for both a dispatch and a `workflow_run`. `land` also applies
`AGENT_FAILED` when `run-model` died before the model ran, which is part of
D3's S5.

**D3, what only a live run proves** — `MEDIA-002` proved the pushed state
being visible to the worker and to CI before either started (D1 accepted both
verdicts on the tip); the failure paths below are still unexercised: `land` running after a cancelled
`run-model`; folded `>-` `if:` conditions; the pushed state being visible to
the worker's checkout before it starts; `Escalate an action that failed` on a
real `gh workflow run` failure.

**D3 residue, not fixed:** `test-agent.yml`'s suite jobs (`backend-test`,
`frontend-test`, …) declare no timeout, so a lost CI result shows as `STALLED`
only after 1080 + 15 minutes; an ESCALATED task has no event back to a
CI-waiting state, and `MANAGER_RETRY` after a baseline escalation skips the
red-baseline check (`operations.md` recovers by editing `state.json`); a
non-verdict CI conclusion escalates a task even when it is not waiting on CI
(only a run this repository dispatched can reach it, D1); a worker landing
after a pause or a human rescope is refused or routed to MANAGER_REVIEW; a task
escalated by a failed orchestrator action gets no review PR.

**D2b residue, not fixed:** `agentrun` could leave a cron job or timer that
outlives the kill (it can write nothing the runner user owns, but can write
`/tmp`); the model still holds `ANTHROPIC_API_KEY` and could send it anywhere,
which no design that runs a model avoids — the Console's monthly limit
(§10.3, `github-automation-setup.md`) bounds it; `agent-guard` still reads
`git diff --name-only` without `-z`, so an oddly named path fails its first
check uncleanly before the second refuses it; the `.ai` gate compares against
the merge base, so a fix `main` makes under `.ai/` after a branch was cut is
not flagged on it — harmless now that no code runs from the branch.

### 10.2 Measured, for the next person who optimises

USERS-002, 14m27s dispatch to PR: model time ~5.5 min (38%), CI ~6.8 min
(47%: baseline 2:49, implementation 4:00, `backend-test` alone 234s of the
latter), orchestrator hops ~2 min. CLI install 3–4s (§5.6). The largest
available saving is running only the suites a spec's `allowed_paths` can
affect (~6 min per frontend task), which D4's wrong-reason check makes safe.

### 10.3 Agreed by the human, 2026-10-08

The human's decisions on this review are numbered ADRs; each item names its owner.

1. **Order and the dispatch gate:** no task is dispatched without the human saying go (D1–D3 merged first): [ADR 0023](../../wiki/GeneralContext/Decisions/0023-human-gates-on-agent-work.md).
2. **`jev`:** the direct route, shadow mode only, and switched off; shadowing the Manager needed a deliberately failing task (§6, item 3): [ADR 0025](../../wiki/GeneralContext/Decisions/0025-jev-shadow-only-switched-off.md).
3. **D3's human escalation exit:** see [ADR 0001](../../wiki/GeneralContext/Decisions/0001-bounded-orchestration.md).
4. **The test-kit hole is closed:** `frontend/src/test/**` and `frontend/src/**/__tests__/**` join `code_agent.deny`: [ADR 0024](../../wiki/GeneralContext/Decisions/0024-test-kit-closed-to-code-agent.md).
5. **Also queued after D1–D6:** D7, §9.2 item 1 (the CI half of bug 17), the newer models, the provider CLI pin and the spend controls: [ADR 0026](../../wiki/GeneralContext/Decisions/0026-agent-models-cli-pin-and-spend-controls.md).
6. **§9.2 item 5: keep `action_required` on bot-authored PRs**, with fork-PR approval and the deleted gateway key: [ADR 0023](../../wiki/GeneralContext/Decisions/0023-human-gates-on-agent-work.md).
7. **D2b's worker-isolation choice:** see [ADR 0002](../../wiki/GeneralContext/Decisions/0002-worker-credential-isolation.md).
8. **Work modes (2026-10-09, after `MEDIA-002`'s USD $2.65):** code is hand-run, the API is for cheap automation: [ADR 0027](../../wiki/GeneralContext/Decisions/0027-work-modes.md).

### 10.4 The backlog as test load

Behaviour changes with a clean red test (sign-out, singular/plural, the email
toggle) fit the pipeline. Refactors (`fetchTeams`, the media-URL join) need
`require_red_baseline: false`. Visual items (Badge on the score band, scroll
padding, the 360px clip): no unit test pins them and the pipeline has no
browser check — hand-run them. DLQ alarms: unsatisfiable as one task
(`infra/iam/` is writable by no role; bug 16's shape).

### 10.5 The first real task after the fixes: `MEDIA-002`, 2026-10-09

`DRAFT` to `COMPLETE` in 25 minutes, no retry, no manager call, no human step
until the review PR; the baseline was red for the right reason. Cost, measured
by the human from the Console balance: **USD $2.65**. Telemetry then recorded
USD $1.25, because cache reads and writes were dropped; D6 fixes that
([ADR 0005](../../wiki/GeneralContext/Decisions/0005-provider-cost-telemetry.md)).
Before dispatch the spec had drifted from the code: recheck a spec against the
code, not just `task validate`, before every first dispatch (`spec-drift.yml`
does it on an `agent/*` PR).

### 10.6 Supply chain and trust

- Every action is SHA-pinned (`TestEveryActionIsPinnedToACommit`), and a
  setting refuses an unpinned one
  (`wiki/GeneralContext/Architecture/github-automation-setup-actions.md`).
- The CLI is pinned in one place (§5.6), ruff and mypy exactly; Renovate moves
  all three by PR.
- OpenSSF Scorecard ([threat-model.md](threat-model.md)) and CodeQL run on
  their own schedules.
- `director-review`: advisory Sonnet 5.5 reader of Director PRs, about $0.03 a
  PR; it skips bot-authored PRs.

Live evidence: [handoff-live-proof.md](handoff-live-proof.md).
