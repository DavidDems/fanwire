---
type: reference
---

# 02 — What is left to build

Open build work only, in one list. Nothing is planned outside this file.

**Mode:** every item has one, chosen by
`wiki/GeneralContext/Architecture/work-modes.md` "Choosing a mode for a
backlog item":

- **`hand`**: code, run by the human on the subscription against a spec on `agent/<ID>`.
- **`auto`**: the orchestrator on metered API credit, only when the human says so.
- **`director`**: `.ai/`, `.github/`, `wiki/GeneralContext/` or `AGENTS.md`, or a human decision first.

**Task** is the task id once a spec exists (`.ai/tasks/<ID>/`), and `—` until
then. Writing a spec is Director work. When an item is done, delete it here
and record the result as current-state fact in the module file it changed.

**Order of work:** the Outstanding-work tracks, `wiki/GeneralContext/Prompts/30-*`
to `37-*`, run in numeric order ([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)).
Each row below names its track.

## Agent system

Findings, evidence and the agreed plan are `.ai/docs/handoff.md` §10; what is
proven live is `.ai/docs/handoff-live-proof.md`. Every `director` item is one
PR, with its structural assertion in `.ai/tests/test_workflows.py` where it
changes a workflow.

14. **Parked for API cost** ([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)):
    proving the cheap automations' two fixes live (`Prompts/04`), exercising a
    failure path on purpose (`handoff.md` §6, item 3), and whether
    `--permission-mode acceptEdits` suits a worker that runs a tool
    (`Prompts/13`). Each needs metered runs; the human revisits only by
    choosing to spend.

Decided, nothing to build: bot-opened PRs keep `action_required`.

## Improvement roadmap

From the Director's review of 2026-10-19, narrowed on 2026-11-17: development is
hand-run, so the briefs that need metered API runs are parked
([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)).
Each brief is in `wiki/GeneralContext/Prompts/`.

| Brief | Mode | Now |
|---|---|---|
| `10-docs-structure.md` | `director` | Deliverable 4 is replaced by the `wiki-review` skill, track 8 |
| `12`–`15` (evals, worker shell, learning loop, context graph) | `director` | Parked: each needs metered API runs to build or score |

## Workflow ideas, not yet designed

From the human's whiteboard (2026-10-17). Each needs a design discussion
before a brief.

| Item | Mode | Notes |
|---|---|---|
| **A review of `wiki/` and of `.ai/`** | `director` | Decided: two skills (`wiki-review`, `ai-review`) and two copy-pastable prompts the human runs by hand about weekly. No scheduled run, no `wiki-health.yml`. Track 8, the last |
| **A pipeline diagram, explained as a slide** | `director` | Once off. A slide deck artifact, not repository content. Ask a Director session for it when wanted |

## Sports data

NBA data from the Eoin Moore Kaggle dataset, 2003-04 onward (the human's
choice, 2026-10-13; `EVENTS-001`, fanwire-archive#139, loaded a first, thinner dataset).
Live brief and unit order: `Prompts/06-nba-data.md`.

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|

## Predictions

Users pick NBA winners, earn non-monetary points and are ranked; every game
shows "Our prediction" ([ADR 0037](../wiki/GeneralContext/Decisions/0037-predictions-module-and-batch-lambda.md)–[0040](../wiki/GeneralContext/Decisions/0040-predictions-track-answers.md); 0040 holds the human's answers).
Runs after the Outstanding-work tracks and the results scraper (`Prompts/38`),
in this order. One row per track; its brief lists the units.

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **Predictions track 39**: the `predictions` module, picks and the tip-off lock, settlement and the points ledger, boards, the API contract, behind `PREDICTIONS_ENABLED=false` | `hand` | — | ADR 0037, 0038 | `Prompts/39-predictions-1-backend-core.md`. Needs `38` live |
| **Predictions track 40**: `SportsDataLoaded` on `PostEventBus`, the `PredictionsBatch` Lambda and daily run, the `picks_settled` notification, the `pick` post attachment | `hand` | — | ADR 0037 | `Prompts/40-predictions-2-batch-integrations.md`. After 39 |
| **Predictions track 41**: the `elo-mov-1` model, its out-of-sample backtest, live forecasts and the model record | `hand` | — | ADR 0039 | `Prompts/41-predictions-3-elo-model.md`. After 40; first check the margin formula against 538's published ratings |
| **Predictions track 42**: "Our prediction", its record page and the pick control in the frontend | `hand` | — | ADR 0038, 0039 | `Prompts/42-predictions-4-pick-ui.md`. After 41 |
| **Predictions track 43**: leaderboards, Beat the model, my picks, sharing, the settled notification's UI, and the launch | `hand` | — | ADR 0038 | `Prompts/43-predictions-5-boards-launch.md`. After 42; navigation decided in ADR 0040 (a Rankings item) |
| **Predictions track 44**: a machine-learning model compared with Elo (TabPFN, LightGBM, a Bayesian/Kalman rating model) | `hand` | — | ADR 0039 item 6 | **Parked** until 41 is live. `Prompts/44-predictions-6-ai-model.md` |

## Backend and infra

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|

## Launch adjustments (Track D sequence)

The approved foundation follows merged ADR 0009/#378. The current scope and
preserved local work are in `wiki/GeneralContext/Prompts/22-launch-adjustments.md`.
Completed launch units/research are removed; historical records remain.

| Order | Mode | Task | What |
|---|---|---|---|
| 1 | `hand` | `USERS-005` | Avatar colours replace presets. Scope amended to cover `AppLayout`; resume from the red tests in [`parked/`](../.ai/tasks/USERS-005/parked/users005-red-tests.patch). Track 6 |
| 2 | `director` | pending | `USERS-009` is merged but dormant (`ACCOUNT_LIFECYCLE_ENABLED=false` in `infra/lib/app-stack.ts`). Review legacy adoption and the cutover/activation procedure, then activate with the human's approval at each gate. Track 6 |
| 3 | `hand` | `AUTH-001` | Re-scoped to Cognito's native forgot-password flow with its verified-email code and a static verify reminder; the lost/late-reset revocation machinery is dropped ([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)). A Director rewrites the spec first. Track 6 |

Completed IAM/scope prerequisites are not AWS writes to repeat. Foundation authorization
does not authorize deployment or production user-data operations. Reset retains
Cognito's default sender and verified-email codes: no SES, custom reset tokens,
separate post-reset mail, password history or paid-plan requirement.

## Dropped: new-device security

`AUTH-002` and `AUTH-003` are dropped ([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)): a challenge that withholds tokens needs an email path (SES, email MFA, a paid plan) the project rules out. Their task directories stay until a task branch removes them.

## Frontend

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **UI-track browser rows left NOT DONE**: axe on the shell, rail, Recent Games, result cards, team tabs and chart (the human, with the axe extension); forced colours on Recent Games with data, the result cards, team tabs and chart; a full 82-game season chart (label density); the picker at 320/768; the notifications preference checkbox layout, signed in | `hand` | — | fanwire-archive#346, fanwire-archive#347, fanwire-archive#351, `FRONTEND-037` PR, track 5 | Browser-only, on real data. Track 5 could not start `backend-dev` (no `backend/.env` for dev Cognito on its machine); the shell and rail in forced colours are done |
| **Track 5 tidy-ups that change tests**: move `features/games/format.ts` to `src/lib/`; delete the caller-less `GameScore` and `UserIcon` (`ChevronDownIcon` has a caller, `Dialog`); rename the stale test "TEAMS_KEY is the one features/profile and search spell" in `api/stats.test.ts` | `hand` | — | track 5 | Each needs a test changed (tests pin `GameScore` and `UserIcon`), which track 5's no-test-changes rule ruled out. Needs the human's OK to change those tests |
| **Three UI strings with a straight apostrophe** (`typography.md` §2): `AccountSettings.tsx` "this account's verification status"; `features/compose/attachmentReads.ts` "Player's game" and "The player's line" | `hand` | — | track 5 | Typographic apostrophe (’) instead; check the tests that pin each string |
| **Italic `.unavailable` lines against "No italics in the UI"** (`typography.md` §2): `PostNode.module.css`, `previews/Previews.module.css` | `director` | — | track 5 | The human decides: a documented exception, or drop the italic |
| **Profile counts are bare, the feed's are localised**: the profile prints "1200 followers", the feed "1,200 likes" | `hand` | — | track 5 | Format the profile's counts by locale, like the feed |
| **The floating + can cover a control Tab scrolls to**: it covers 80–136 px from the bottom on phones, so a control at the right of a card can sit partly under it (never fully hidden) | `hand` | — | track 5 | Clearing it fully would take about 140 px of scroll padding. Decide whether to act. Browser check |
| **`FrontendUI/tokens.md` is at its word budget** (2,499 of 2,500) | `director` | — | track 5 | Split it by responsibility before the next addition |

