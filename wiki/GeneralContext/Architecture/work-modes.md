# Work modes — who does which work, and who pays

**Reference, not a prompt.** Decided by the human on 2026-10-09
(`.ai/docs/handoff.md` §10.3 item 8), after the first real task through the
fixed pipeline. Read this before planning any unit of work, choosing how to run
it, or changing the `.ai/` system.

## Why this exists

`MEDIA-002` ran through the automated pipeline end to end on 2026-10-09: 25
minutes, no retry, no manager call, merged and deployed (handoff §10.5). It
cost **USD $2.65** of metered API credit for one backend script and its test,
and most of that went to the test agent and the code agent. Meanwhile the human's Claude
subscription can do the same work in a hand-run session at no marginal cost,
which is how every unit from 2026-09-23 to 2026-10-07 was built
(`director-sessions.md`).

So the project is now **hybrid**. Writing code is done by hand on the
subscription. The API pays only for small, cheap calls that save the human real
time. The automated pipeline keeps working, but it is no longer the default.

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
| **Spec drift check** | Before a unit starts, in any mode | Does the spec name things (statuses, paths, symbols, linked files) that no longer exist in the code? | `MEDIA-002`'s spec named a `Quarantined` status that did not exist and linked a deleted TODO; it was caught by hand (#122). |
| **CI failure summary** | When CI fails on an `agent/*` PR | What failed, where, and the likely cause, in a few lines | Saves reading a raw Actions log, which is most of a failed run's diagnosis time. |
| **Criteria coverage check** | When an `agent/*` PR opens or updates | Which acceptance criteria does no test pin? | Hand runs have no Manager reviewing coverage; this is the cheap substitute. |
| **Wiki update proposal** | After an `agent/*` PR merges | Did this change a documented decision in `wiki/CodeContext/Modules/`? If so, a proposed edit | The context maintainer did nothing for `MEDIA-002`, and module files drifting from code is a recurring cost. |

**Rough cost:** a Haiku 5.5 call reading 20K tokens and writing 1K costs
about USD $0.0025. At a few units a week, all four together come to well under
a dollar a month. Every one must record what it actually cost (D6's lesson:
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
  writes it for `auto`. A hand run records its start and finish too, so
  `agentctl status` tells the truth (today every hand-run task shows `DRAFT`).
- **One live prompt per active thread: `wiki/GeneralContext/Prompts/`.** A
  prompt is a self-contained brief for the next session of one thread of
  work: objective, where things stand, what to read first, the steps, the
  limits. A session that ends mid-thread updates its prompt; a finished
  thread's prompt is deleted and the index says so.
- **Decisions: `Architecture/human-decisions.md`** (product and process) and
  **`.ai/docs/handoff.md` §10.3** (the agent system). A decision lives in one
  place; everything else links to it.
- **How a hand run works: `Architecture/director-sessions.md`.** The loop, the
  gates, the verification and the standing limits.

## Status (2026-10-09)

- Decided: everything above.
- Built: the three modes exist (hand-run units have been done since
  2026-09-23; the pipeline ran `MEDIA-002`).
- **Not built yet**, and briefed:
  - the Mode column, recording hand runs, and a prompt template →
    `Prompts/03-work-modes-structure.md` (`TODO/02` item 13);
  - the four automations → `Prompts/04-cheap-automations.md` (`TODO/02`
    item 14).
- The order the human chose: D4–D7 (the remaining review fixes) first, then
  03, then 04. A session may start 03 while a D-item is in review, because they
  touch different files. 04 changes workflows, so start it only once no D-item
  PR touching `.github/workflows/` is open.
