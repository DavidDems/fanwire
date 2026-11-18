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

11. `director`: Models to `claude-sonnet-5-5` / `claude-opus-5-5`.
    `.ai/config.json` still has `claude-opus-5`, `claude-sonnet-5` and one
    `claude-haiku-4-5`. Track 2.
14. **Parked for API cost** ([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)):
    proving the cheap automations' two fixes live (`Prompts/04`), exercising a
    failure path on purpose (`handoff.md` §6, item 3), and whether
    `--permission-mode acceptEdits` suits a worker that runs a tool
    (`Prompts/13`). Each needs metered runs; the human revisits only by
    choosing to spend.
18. `director`: Spec validation that rejects an acceptance criterion with no
    observable predicate (caught today only by the red-baseline gate). Track 7.
19. `director`: A CI check that a PR's base is `main` (stacked PRs merged
    top-down never reached it). Track 7.
20. `director`: Local guards: `agentctl selfcheck` asserting each workspace's
    `node_modules` is installed, refusing `git stash` in agent sessions (the
    stack is shared across worktrees), and a port pre-flight before
    `docker compose run`. Track 7.

Decided, nothing to build: bot-opened PRs keep `action_required`.

## Improvement roadmap

From the Director's review of 2026-10-19, narrowed on 2026-11-17: development is
hand-run, so the briefs that need metered API runs are parked
([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)).
Each brief is in `wiki/GeneralContext/Prompts/`.

| Brief | Mode | Now |
|---|---|---|
| `10-docs-structure.md` | `director` | Deliverable 4 is replaced by the `wiki-review` skill, track 8 |
| `11-metrics-every-mode.md` | `director` | Deliverables 4 and 5 (VERSION/changelog, reporting), track 7 |
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
| **Delete the API-SPORTS infra resources**: the idempotency and live-score tables, the API-SPORTS secret, the ingestion-retry queue and DLQ, and their exports | `hand` | — | `EVENTS-003` (fanwire-archive#142, deployed 2026-10-14) | Track 3. Needs a spec. The two `RETAIN` resources (`IdempotencyTable`, `ApiSportsKey`) are deleted by hand afterwards: decided, nothing else uses them (ADR 0035) |

## Backend and infra

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **`lambda-vpc-eni` self-deny**: a `Deny` on the ENI actions conditioned on `lambda:SourceFunctionArn` (`ArnLike` `Fanwire-App-*`) in `backendFunction` | `hand` | — | `0x00b-architecture-iam-gaps.md` → the `lambda-vpc-eni` waiver | Check how `infra/test/iam-policy.test.ts` treats a `Deny`. Proven only by a deploy plus a logged-in `/api/users/me` |
| **A GuardDuty-findings alarm**: route Medium/High findings to the alarm topic (EventBridge rule → SNS) | `director` | — | `incident-runbook-inventory.md` Known gaps, after `INFRA-004` | Findings live in the delegated-admin account (`fanwire-log-archive`), not the workload account that holds the topic, so the routing crosses accounts. Needs a design first |
| **A friendlier 429 message**: the frontend shows a generic failure when `POST /posts` or a repost is rate-limited | `hand` | — | `POSTS-002` (fanwire-archive#183), "Not in this task" | `createPost` treats every non-2xx alike. A "slow down" line where the composer shows errors |
| **A missing post is a no-op for the `PostCreated` consumer**, and maybe the REPOST notification goes on un-repost | `hand` | — | `POSTS-001` (fanwire-archive#161), `0x03a-posts-post.md` Open decisions | `notifications/` treats a missing post as a malformed event (`MissingReferenceError`, retried, then the DLQ), so a repost undone before the consumer runs lands in the DLQ. The notification also outlives the undo |
| **`0x00a` "Alarms" says 21; `infra/test/alarms.test.ts` pins 23** | `hand` | — | CUT-11, fanwire-archive#398 "Carried over" | Make the doc match the test |
| **Small open decisions from the compaction**: migrations stay manual (revisit with the permissions boundary); per-user rate limits (`0x00b`); the incident inventory may be missing the sports-data bucket; `dev-auth-setup` "mirrors" vs prod's pre-sign-up auto-confirm | `director` | — | CUT-11, fanwire-archive#398 "Carried over" | Check each against the code before acting |

## Launch adjustments (Track D sequence)

The approved foundation follows merged ADR 0009/#378. The current scope and
preserved local work are in `wiki/GeneralContext/Prompts/22-launch-adjustments.md`.
Completed launch units/research are removed; historical records remain.

| Order | Mode | Task | What |
|---|---|---|---|
| 1 | `hand` | `USERS-005` | Avatar colours replace presets. Scope amended to cover `AppLayout`; resume from the red tests in [`parked/`](../.ai/tasks/USERS-005/parked/users005-red-tests.patch). Track 6 |
| 2 | `director` | pending | `USERS-009` is merged but dormant (`ACCOUNT_LIFECYCLE_ENABLED=false` in `infra/lib/app-stack.ts`). Review legacy adoption and the cutover/activation procedure, then activate with the human's approval at each gate. Track 6 |
| 3 | `hand` | `AUTH-001` | Re-scoped to Cognito's native forgot-password flow with its verified-email code and a static verify reminder; the lost/late-reset revocation machinery is dropped ([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)). A Director rewrites the spec first. Track 6 |

Outstanding Director UI documentation follow-ups remain under Frontend. Completed
IAM/scope prerequisites are not AWS writes to repeat. Foundation authorization
does not authorize deployment or production user-data operations. Reset retains
Cognito's default sender and verified-email codes: no SES, custom reset tokens,
separate post-reset mail, password history or paid-plan requirement.

## Dropped: new-device security

`AUTH-002` and `AUTH-003` are dropped ([ADR 0035](../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md)): a challenge that withholds tokens needs an email path (SES, email MFA, a paid plan) the project rules out. Their task directories stay until a task branch removes them.

## Frontend

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **Track D components/layout documentation follow-up** | `director` | — | Users task briefs | Verify what current main already documents, then complete the remaining promised components/layout updates under `wiki/CodeContext/FrontendUI/` in a Director PR. |
| **The home rail after the feed in DOM order**: a keyboard reader reaches the rail's search box after about 150 Tabs | `hand` | — | `FRONTEND-036` (UI track) | A skip link to the rail, or the rail before the feed in DOM order. Writes `src/routes/**`. Browser check |
| **Deactivated-only follows still get the thin follows feed**, not the guest selection | `hand` | — | `FEED-001` (UI track) | Backend feed query; its own red test |
| **UI-track browser rows left NOT DONE**: axe and forced colors on the shell, rail, Recent Games, result cards, team tabs and chart; a full 82-game season chart (label density); the picker at 320/768 | `hand` | — | fanwire-archive#346, fanwire-archive#347, fanwire-archive#351, `FRONTEND-037` PR | Browser-only, on real data after the human's game-data refresh |
| **The entry chunk is ~1 kB under its 480 kB raw limit** (478.88 kB after `FRONTEND-044`) | `hand` | — | `FRONTEND-044` PR (fanwire-archive#373) | The next unit that adds to the entry (a nav item, a shell change) fails the bundle-budget test. Move something lazy first, or raise the limit by decision |
| **Frontend tidy-ups left by `FRONTEND-008`/`009`/`UI-009`**: move `features/games/format.ts` to `src/lib/`; one shared `ScrollTable` in `components/ui/` instead of the copies in `stats` and `players`; one teams fetch in `api/` instead of four; delete or reuse the caller-less `GameScore`, `ChevronDownIcon` and `UserIcon`; a scrim token for `Dialog`'s backdrop (it uses the `--neutral-950` primitive); stale `LikeButton`/"no `aria-pressed`" comments in `Button.tsx`, `search-isolation.test.ts` and `SearchPage.test.tsx` | `hand` | — | the "for the Director" lists of `FRONTEND-008`/`009`/`010` and `UI-009` | One spec, behaviour unchanged; writes `components/ui/`, `src/lib/` and several features |
| **Email toggle while email is off.** "Email me about new notifications" still renders and does nothing | `hand` | — | `0x05-notifications.md` → "Email is off in production" | Decided (ADR 0035): the preference response gains a field saying whether email is available; the frontend captions or disables the toggle from it. Keep storing the preference. Track 4 |
| **"1 followers", "1 likes"**: singular and plural | `hand` | — | `UI-005`, `UI-008` browser passes | The counts are pinned exactly by tests, so each is a behaviour change with its own red test (`features/profile/`, `features/feed/`). Was `auto` by the human's 2026-10-12 choice; now `hand`, since API spend is out (ADR 0035). Track 5. **The feed half ("1 likes") is now `UI-009`'s**; this item is the profile's "1 followers" only |
| **The shell's `scroll-padding-bottom` is about 5 px short**: a focused control near the bottom bar is overlapped (never hidden) | `hand` | — | `FRONTEND-007` browser pass | Shell, `AppLayout.module.css`. Browser check |
| **`Field` layouts**: a checkbox layout (then delete `EmailPreference`'s `.preference > div` exception) and a row layout (so search's box and button, and its three selects, can sit in a row) | `hand` | — | `components-map-posts.md` §5, `FRONTEND-007` | `src/components/` |
| **`fetchTeams` exists in four places** (profile, `ProfileSetupPage`, compose's `attachmentReads.ts` since FRONTEND-013, stats), sharing one cache key | `hand` | — | `FRONTEND-007` | Move into `api/`; needs all four features in scope |
| **The media-URL join exists twice** (`features/feed/api.ts`, `features/compose/MediaWidget.tsx`) | `hand` | — | `FRONTEND-005` | Move into `api/` or `components/`; needs both in scope |
| **A username character rule** (look-alike usernames) | `hand` | — | `typography.md` §1 | Decided (ADR 0035): Instagram's rule, `^(?!.*\.\.)(?!.*\.$)\w[\w.]{0,29}$`, ASCII-only, whole-string. Backend schema, then the form. Decide what happens to existing names that break it. Track 4 |

