---
type: reference
---

# Work modes — who does which work, and who pays

**Reference, not a prompt.** The decision is
[ADR 0027](../Decisions/0027-work-modes.md). Read this before planning any unit
of work, choosing how to run it, or changing the `.ai/` system.

## Why this exists

A small backend task through the automated pipeline costs a few dollars of
metered API credit, most of it spent by the test and code agents, while a
hand-run session on the human's Claude subscription does the same work at no
marginal cost ([ADR 0027](../Decisions/0027-work-modes.md)). So the project is
**hybrid**: code is written by hand on the subscription, the API pays only for
small, cheap calls that save the human real time, and the automated pipeline
keeps working without being the default.

## The three modes

| Mode | Who runs it | Pays | Used for |
|---|---|---|---|
| **`hand`** | The human, in a Claude Code session against a task spec | Subscription, $0 marginal | **All real code**: features, refactors, anything with a test and an implementation. The default. |
| **`auto`** | The orchestrator (`agent-orchestrator.yml`), started by the human | Metered API, ~USD $2–3 per small backend task | Small, well-specified tasks the human wants done hands-off. Optional, never the default. |
| **`director`** | A Director session (`AGENTS.md` "Agent system") | Subscription | Changes to `.ai/`, `.github/`, `wiki/GeneralContext/`, `AGENTS.md` — the system itself. |

Plus **cheap automation**, which is not a mode for doing a unit but a set of
helpers around the three modes (below).

### What stays the same in every mode

- **The unit of work is a task spec plus a branch.** A spec in
  `.ai/tasks/<ID>/` (`task.json` + `brief.md`) and an `agent/<ID>` branch cut
  from `main`. `agent-guard` holds every `agent/*` PR to its spec's
  `allowed_paths`, whether a human or the orchestrator wrote it, and
  `guard-gate` is required on `main`. A hand run is therefore enforced exactly
  as an automated one; only who types differs.
- **Test-first** (`AGENTS.md` "Workflow"): the failing test is committed alone,
  then the implementation.
- **The no-test-edits rule applies only to dispatched code agents** (D5 in
  `.ai/docs/state-machine.md`). A hand-run session fixes its own broken test
  in a separate test-only commit, discloses that correction in the PR, and
  mutation-tests the affected assertions (`director-sessions.md`, "Take
  objections seriously, and confirm them").
- **The human reviews and merges every PR.** No mode merges anything.
- **The deterministic machinery is free and always on:** CI (`test-agent.yml`),
  `agent-guard`, `agentctl task validate`, the red-baseline check (D4), the
  state machine and `agentctl status`.

### Choosing a mode for a backlog item

- Code with any design judgement in it → `hand`.
- A small backend-only task with a crisp spec and a clean red test, when the
  human wants it done unattended and accepts the cost → `auto`. Record what it
  cost (handoff §10.5 is the template).
- Anything touching the agent system or `wiki/GeneralContext/` → `director`.
- Visual work no unit test pins (handoff §10.4) → `hand`, with a browser check.

## Cheap automation — what the API is still for

Model calls that cost fractions of a cent each, on **`claude-haiku-5-5`**
($0.10 / $0.50 per million input/output tokens; batch calls are half that)
or **`jev`** (typed decisions, `TYPESAFE_API_KEY`). Each answers one narrow
question that already cost the project time. None of them writes code, moves
task state, approves or merges anything.

| Automation | Runs | Answers | Why it earns its cost |
|---|---|---|---|
| **Spec drift check** | Before a unit starts, in any mode | Does the spec name things (statuses, paths, symbols, linked files) that no longer exist in the code? | `MEDIA-002`'s spec named a `Quarantined` status that did not exist and linked a deleted TODO; it was caught by hand (fanwire-archive#122). |
| **CI failure summary** | When CI fails on an `agent/*` PR | What failed, where, and the likely cause, in a few lines | Saves reading a raw Actions log, which is most of a failed run's diagnosis time. |
| **Criteria coverage check** | When an `agent/*` PR opens or updates | Which acceptance criteria does no test pin? | Hand runs have no Manager reviewing coverage; this is the cheap substitute. |
| **Wiki update proposal** | After an `agent/*` PR merges | Did this change a documented decision in `wiki/CodeContext/Modules/`? If so, a proposed edit | The context maintainer did nothing for `MEDIA-002`, and module files drifting from code is a recurring cost. |
| **Director review** | When a Director PR (not `agent/*`, not a bot's) touching `.ai/` or `.github/` opens or updates | Does this diff move a safety control to a weaker enforcement grade (`philosophy.md` §4)? | A Director PR is reviewed by the one human who directed it and merges through the admin bypass; this is the only other reader. On **`claude-sonnet-5-5`**, not Haiku ([ADR 0028](../Decisions/0028-improvement-roadmap-answers.md)): about **USD $0.05 a PR**. |

**Rough cost:** a Haiku 5.5 call reading 20K tokens and writing 1K costs
about USD $0.0025. At a few units a week, all four together come to well under
a dollar a month. The Director review is the one on Sonnet 5.5, at about
$0.05 a Director PR. Every one must record what it actually cost (D6's lesson:
read the provider's usage, including cache tokens, not an estimate).

### Constraints every automation must keep

These come from the 2026-10-08 review (handoff §10.1). They are not optional.

- **No code from a branch runs where a credential is.** The automation's own
  code runs from `main` (or the PR's base SHA), with the PR checked out as data
  only — D2b's pattern (`agent-guard.yml`, `agent-worker.yml`).
- **Model input is untrusted.** A diff, a log or a spec written on a branch can
  contain instructions. The model's answer is data: it can become a comment or
  a proposed file, never a command, a state transition or an approval. Fence
  untrusted content as `.ai/agentlib/promptbuild.py` already does.
- **No dispatch input or model output is pasted into a `run:` script**
  (D2): pass values through `env:`.
- **Least privilege per job:** a comment needs `pull-requests: write` and
  nothing else, and never `contents: write` or `actions: write`.
- **Bounded spend:** cap input size and `max_tokens`; one call per event;
  fail quiet (no comment) rather than retry in a loop.
- **Fork PRs get nothing.** The repository is public. An automation that holds
  a key must not run for a fork's PR (`head.repo` must equal this repository).
- **`.ai/` is stdlib-only** (`AGENTS.md` "Build / test / run"). An API call
  from `agentlib` uses `urllib` against the Messages API, not an SDK, unless a
  Director decides otherwise and says so.

## How work is handed on and planned

One structure for every mode, so any session can start cold:

- **One queue: `TODO/02-backlog.md`.** Every item has a **Mode** (`hand`,
  `auto` or `director`) and, once one exists, its task id. Nothing is planned
  anywhere else; a finished item is deleted there.
- **One record per unit: `.ai/tasks/<ID>/state.json`.** The orchestrator
  writes it for `auto`. `agentctl hand start|finish` records a hand run's
  start and finish, so `agentctl status` tells the truth for every mode.
- **One live prompt per active thread: `wiki/GeneralContext/Prompts/`.** A
  prompt is a self-contained brief for the next session of one thread of
  work: objective, where things stand, what to read first, the steps, the
  limits. A session that ends mid-thread updates its prompt; a finished
  thread's prompt is deleted and the index says so.
- **Decisions: `wiki/GeneralContext/Decisions/`**, one numbered ADR per file
  (**`NNNN-short-title.md`**, the next unused number on current main), for
  product, process and agent-system decisions alike. Agent-system examples:
  the D3 orchestration and human-escalation choice in
  [ADR 0001](../Decisions/0001-bounded-orchestration.md), D2b worker
  isolation in [ADR 0002](../Decisions/0002-worker-credential-isolation.md),
  D4 red-baseline classification in [ADR 0003](../Decisions/0003-red-baseline.md),
  D5 required quality checks in [ADR 0004](../Decisions/0004-required-quality-checks.md),
  and D6 provider cost in [ADR 0005](../Decisions/0005-provider-cost-telemetry.md).
  A decision lives in one place; everything else links to it.
- **History: `wiki/GeneralContext/Timeline/`**, one `changelog` volume per
  month ([2026-09](../Timeline/2026-09.md), [2026-10](../Timeline/2026-10.md),
  [2026-11](../Timeline/2026-11.md)): one line per milestone, citing its PRs
  as `fanwire-archive#N`. Reasons stay in the PRs and decisions above.
- **How a hand run works: `Architecture/director-sessions.md`.** The loop, the
  gates, the verification and the standing limits.

## The automations as built

Each runs `main`'s copy of its workflow, acts only for this repository (never a
fork), and its answer is advisory: a comment or a job summary, never a
commit, a state change or a failed check.

- **CI failure summary**: `.github/workflows/ci-summary.yml`, on
  `workflow_run` when `test-agent` fails on an `agent/*` PR. It parses the log
  with `ciresult`, asks Haiku 5.5 for one "likely cause" sentence, and keeps
  one comment on the PR up to date, with the cost in its footer. When
  `test-agent` later passes, the
  `mark-fixed` job (no key, no model) adds a "Fixed" line naming the green
  commit, so a fixed failure does not read as a live one. About $0.001 a call.
- **Criteria coverage check**: `.github/workflows/coverage-check.yml`, on
  `pull_request_target` when an `agent/*` PR opens or is pushed. The spec's
  `acceptance_criteria` (from `main`) and the test files the PR changes go to
  Haiku 5.5, which names the test that pins each one; a test it names must be
  in that file, or it does not count. The comment carries a hidden
  `fanwire-shadow` record. About $0.0035 a push.
- **Spec drift check**: `.github/workflows/spec-drift.yml`, once when an
  `agent/*` PR is opened, or dispatched by hand
  (`gh workflow run spec-drift.yml -f task_id=<ID>`); either way it checks the
  spec against `main`. Paths and links are checked without a model; Haiku 5.5
  is asked only for names in the prose, and a name it calls missing is kept
  only if Haiku marks it `assumed_to_exist` (a name the unit is to create is
  not drift) and no non-test source file has it. The code Haiku sees is whole
  files under a cap, read in this order: the spec's `allowed_paths`, the files
  the brief names, then `forbidden_paths` (code the unit may not touch, read
  last). The report goes to the job summary, and to the task's open PR as a
  comment if there is one. About $0.009 a run.
- **Wiki update proposal**: `.github/workflows/wiki-proposal.yml`, on
  `pull_request_target` when an `agent/*` PR merges. The merged diff
  (generated files left out, the module files' own diffs first, so the cap
  never cuts a unit's update to its wiki) and the module files its spec names,
  as they stand after the merge, go to Haiku 5.5, which names exact passages
  and their replacements; the patch is made from the real files, so it
  applies. One comment on the merged PR: "no documented decision changed", or
  the patch and `git apply wiki.patch`. Nothing is committed. About $0.008 a
  merge.
- **Director review**: `.github/workflows/director-review.yml`, on
  `pull_request_target` when a PR whose branch is not `agent/*` and whose
  author is not a bot touches `.ai/` or `.github/`. The PR's diff (`.ai/` and
  `.github/` first, capped) and `philosophy.md` and `threat-model.md` from
  `main` go to Sonnet 5.5, which lists each safety regression with its path and
  the grade it falls from and to; a finding on a path the diff does not show,
  or with a grade that does not drop, is dropped. It fails nothing, its own
  errors included, and is not under `gate`. About $0.05 a PR.
- **`jev`**: `.ai/bin/ask_jev.py` on the direct route and the dispatch-only
  `jev-smoke.yml`. It is wired and switched off
  (`automations.<name>.ask_jev: false` in `.ai/config.json`,
  [ADR 0025](../Decisions/0025-jev-shadow-only-switched-off.md)).
- **The handover structure**: the backlog's Mode column,
  `agentctl hand start|finish` (a hand run's `state.json`, mode `hand`, which
  the orchestrator ignores), and `Prompts/_template.md` with the
  one-live-prompt rule in `index.md` "Task prompts".
