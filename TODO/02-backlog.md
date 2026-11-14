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

## Agent system

Findings, evidence and the agreed plan are `.ai/docs/handoff.md` §10; what is
proven live is `.ai/docs/handoff-live-proof.md`. Every `director` item is one
PR, with its structural assertion in `.ai/tests/test_workflows.py` where it
changes a workflow.

11. `director`: Models to `claude-sonnet-5-5` / `claude-opus-5-5`.
    `.ai/config.json` still has `claude-opus-5`, `claude-sonnet-5` and one
    `claude-haiku-4-5`.
14. `director`: **Cheap automations**: all four are built and live; what is
    left is proving two fixes live (the "Fixed" line, `assumed_to_exist`).
    Brief: `Prompts/04-cheap-automations.md`.
15. `auto`: **Exercise a failure path on purpose** (`handoff.md` §6, item 3):
    one cheap task with a deliberately impossible acceptance criterion. It
    proves the distiller, the manager decision and a retry, none of which has
    run, and, as the first worker run on the pinned CLI, its install check.
    Needs the human's go.
16. `director`: **`metrics-publish.yml`'s daily catchup fails** at `pr-detail`
    on `FRONTEND-016`'s PR (fanwire-archive#195): every scheduled run from
    2026-11-08 to 2026-11-13 failed (run 43424088694).
17. `director`: Decide whether `--permission-mode acceptEdits`
    (`.ai/bin/invoke_agent.sh`) is right for a non-interactive worker that has
    to run a tool. Settle it with `Prompts/13-worker-shell.md`.
18. `director`: Spec validation that rejects an acceptance criterion with no
    observable predicate (caught today only by the red-baseline gate).
19. `director`: A CI check that a PR's base is `main` (stacked PRs merged
    top-down never reached it), and correlating prompt size with attempts per
    task once `Prompts/11` records both.
20. `director`: Local guards: `agentctl selfcheck` asserting each workspace's
    `node_modules` is installed, refusing `git stash` in agent sessions (the
    stack is shared across worktrees), and a port pre-flight before
    `docker compose run`.

Decided, nothing to build: bot-opened PRs keep `action_required`.

## Context-Update-Track

Compact every context file, then move to a fresh public repository (the human, 2026-11-11).
Brief and queue (`CUT-00` to `CUT-12`, one `director` PR each): `wiki/GeneralContext/Prompts/25-context-update-track.md`.

## Improvement roadmap

From the Director's review of 2026-10-19, agreed with the human. Within the
track the order is a dependency order. Each brief is in
`wiki/GeneralContext/Prompts/`. The decisions the briefs raised were answered
by the human on 2026-10-19 (`wiki/GeneralContext/Decisions/0028-improvement-roadmap-answers.md`,
`0029-performance-test-design.md`), and each
brief records its answer.

| Order | Brief | Mode | Why it's here |
|---|---|---|---|
| System 2 | `10-docs-structure.md` | `director` | Deliverable 4 only: the WikiMaintenance skill and `wiki-health.yml`. Its corpus migration (Deliverable 3) is absorbed by `Prompts/25`. |
| System 3 | `11-metrics-every-mode.md` | `director` | The sensor. `12` needs its record format and the pipeline version. |
| System 4 | `12-agent-evals.md` | `director` | The test harness. Its first run is the baseline `13`–`15` are judged against. |
| System 5 | `13-worker-shell.md` | `director` | The biggest bottleneck (CI round trips). The first change scored by `12`. |
| System 6 | `14-learning-loop.md` | `director` | Criterion ids (deterministic coverage) and review corrections → skill proposals. Needs `11` and `12`. |
| System 7 | `15-context-graph.md` | `director` | Our own graph generator on mature parsers. It enforces the connection rule; its token savings are measured by `12`. |

## Workflow ideas, not yet designed

From the human's whiteboard (2026-10-17). Each needs a design discussion
before a brief.

| Item | Mode | Notes |
|---|---|---|
| **A weekly review of `wiki/`** | `director` | Overlaps `Prompts/10` deliverable 4 (`wiki-health.yml`, weekly, opening a "Wiki maintenance due" issue for a Director session). Settle it there rather than build a second trigger |
| **A weekly review of `.ai/`** | `director` | The same shape as the wiki one: a deterministic weekly report (stalled tasks, unproven-live items in handoff, telemetry and metrics from `Prompts/11`, Scorecard findings) in an issue, and a Director session acting on it. Design it after `11` |
| **A pipeline diagram, explained as a slide** | `director` | Once off. A slide deck artifact, not repository content. Ask a Director session for it when wanted |

## Sports data

NBA data from the Eoin Moore Kaggle dataset, 2003-04 onward (the human's
choice, 2026-10-13; `EVENTS-001`, fanwire-archive#139, loaded a first, thinner dataset).
Live brief and unit order: `Prompts/06-nba-data.md`.

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **Delete the API-SPORTS infra resources**: the idempotency and live-score tables, the API-SPORTS secret, the ingestion-retry queue and DLQ, and their exports | `hand` | — | `EVENTS-003` (fanwire-archive#142, deployed 2026-10-14) | Now unblocked; needs a spec. Two are `RETAIN`: the human deletes them by hand afterwards |
| **Scheduled refresh from Kaggle** during the season | `hand` | `EVENTS-008` | the human, 2026-10-13 | Gated: the dataset must resume updating after 2026-10-21, and a Kaggle token must be in Secrets Manager |

## Backend and infra

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **`lambda-vpc-eni` self-deny**: a `Deny` on the ENI actions conditioned on `lambda:SourceFunctionArn` (`ArnLike` `Fanwire-App-*`) in `backendFunction` | `hand` | — | `0x00b-architecture-iam-gaps.md` → the `lambda-vpc-eni` waiver | Check how `infra/test/iam-policy.test.ts` treats a `Deny`. Proven only by a deploy plus a logged-in `/api/users/me` |
| **A GuardDuty-findings alarm**: route Medium/High findings to the alarm topic (EventBridge rule → SNS) | `director` | — | `incident-runbook-inventory.md` Known gaps, after `INFRA-004` | Findings live in the delegated-admin account (`fanwire-log-archive`), not the workload account that holds the topic, so the routing crosses accounts. Needs a design first |
| **A friendlier 429 message**: the frontend shows a generic failure when `POST /posts` or a repost is rate-limited | `hand` | — | `POSTS-002` (fanwire-archive#183), "Not in this task" | `createPost` treats every non-2xx alike. A "slow down" line where the composer shows errors |
| **A missing post is a no-op for the `PostCreated` consumer**, and maybe the REPOST notification goes on un-repost | `hand` | — | `POSTS-001` (fanwire-archive#161), `0x03a-posts-post.md` Open decisions | `notifications/` treats a missing post as a malformed event (`MissingReferenceError`, retried, then the DLQ), so a repost undone before the consumer runs lands in the DLQ. The notification also outlives the undo |

## Launch adjustments (Track D sequence)

The approved foundation follows merged ADR 0009/#378. The current scope and
preserved local work are in `wiki/GeneralContext/Prompts/22-launch-adjustments.md`.
Completed launch units/research are removed; historical records remain.

| Order | Mode | Task | What |
|---|---|---|---|
| 1 | `director` | pending | Merge exact USERS-009 foundation scope before its task branch; separately review legacy adoption, cutover/activation and any demonstrated IAM prerequisite. No AWS write or production operation is authorized. |
| 2 | `hand` | `USERS-009` | Durable issuer/sub authority, deletion tombstones/operation/status/manifests and automatic bounded scheduled reconciliation. Preserve DELETE 204 completion semantics; no frontend/reset redesign. All recovery/fencing stages activate together after migration and explicit rollout gates. |
| 3 | `hand` | `AUTH-001` | Paused independently: authoritative lost/late reset completion and revocation evidence or a further reviewed architecture/scope amendment is still required. Native verified-email codes/static reminder retained; preserve the unshipped experiment. No timer-unlock/manual-only design is approved. |
| 4 | `hand` | `USERS-005` | Avatar colours replace presets. Scope amended to cover `AppLayout`; resume from the red tests in [`parked/`](../.ai/tasks/USERS-005/parked/users005-red-tests.patch). |

Outstanding Director UI documentation follow-ups remain under Frontend. Completed
IAM/scope prerequisites are not AWS writes to repeat. Foundation authorization
does not authorize deployment or production user-data operations. Reset retains
Cognito's default sender and verified-email codes: no SES, custom reset tokens,
separate post-reset mail, password history or paid-plan requirement.

## Deferred new-device security (outside Track D)

`AUTH-002` and `AUTH-003` remain deferred outside Track D and are not expanded by
the account-lifecycle research. `USERS-007` did not implement recovery;
`AUTH-001` remains in Track D behind the research gate above.

| Order | Task | What |
|---|---|---|
| 1 | `AUTH-002` | Per-user remembered-device registry; requires a separate Director policy/scope prerequisite for its migration path. Outside Track D. |
| 2 | `AUTH-003` | Dismissible verification prompt for unverified users and pre-session email step-up for verified users on new devices; depends on `AUTH-002`. Outside Track D. |

New-device email codes are lower assurance and require an architecture that
withholds usable tokens until the challenge succeeds. See those task briefs for
their separate security constraints and approval gates.

## Frontend

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **Track D components/layout documentation follow-up** | `director` | — | Users task briefs | Verify what current main already documents, then complete the remaining promised components/layout updates under `wiki/CodeContext/FrontendUI/` in a Director PR. |
| **The home rail after the feed in DOM order**: a keyboard reader reaches the rail's search box after about 150 Tabs | `hand` | — | `FRONTEND-036` (UI track) | A skip link to the rail, or the rail before the feed in DOM order. Writes `src/routes/**`. Browser check |
| **Deactivated-only follows still get the thin follows feed**, not the guest selection | `hand` | — | `FEED-001` (UI track) | Backend feed query; its own red test |
| **UI-track browser rows left NOT DONE**: axe and forced colors on the shell, rail, Recent Games, result cards, team tabs and chart; a full 82-game season chart (label density); the picker at 320/768 | `hand` | — | fanwire-archive#346, fanwire-archive#347, fanwire-archive#351, `FRONTEND-037` PR | Browser-only, on real data after the human's game-data refresh |
| **The entry chunk is ~1 kB under its 480 kB raw limit** (478.88 kB after `FRONTEND-044`) | `hand` | — | `FRONTEND-044` PR (fanwire-archive#373) | The next unit that adds to the entry (a nav item, a shell change) fails the bundle-budget test. Move something lazy first, or raise the limit by decision |
| **Frontend tidy-ups left by `FRONTEND-008`/`009`/`UI-009`**: move `features/games/format.ts` to `src/lib/`; one shared `ScrollTable` in `components/ui/` instead of the copies in `stats` and `players`; one teams fetch in `api/` instead of four; delete or reuse the caller-less `GameScore`, `ChevronDownIcon` and `UserIcon`; a scrim token for `Dialog`'s backdrop (it uses the `--neutral-950` primitive); stale `LikeButton`/"no `aria-pressed`" comments in `Button.tsx`, `search-isolation.test.ts` and `SearchPage.test.tsx` | `hand` | — | the "for the Director" lists of `FRONTEND-008`/`009`/`010` and `UI-009` | One spec, behaviour unchanged; writes `components/ui/`, `src/lib/` and several features |
| **Email toggle while email is off.** "Email me about new notifications" still renders and does nothing | `hand` | — | `0x05-notifications.md` → "Email is off in production" | Keep storing the preference; caption or disable it. Prefer the backend saying whether email is available (a field on the preference response) over a build-time flag |
| **"1 followers", "1 likes"**: singular and plural | `auto` | — | `UI-005`, `UI-008` browser passes | The counts are pinned exactly by tests, so each is a behaviour change with its own red test (`features/profile/`, `features/feed/`). **`auto` by the human's choice (2026-10-12)**, an exception to `work-modes.md`'s backend-only rule: the pipeline's first frontend task. Record its cost as handoff §10.5 does. **The feed half ("1 likes") is now `UI-009`'s**; this item is the profile's "1 followers" only |
| **The shell's `scroll-padding-bottom` is about 5 px short**: a focused control near the bottom bar is overlapped (never hidden) | `hand` | — | `FRONTEND-007` browser pass | Shell, `AppLayout.module.css`. Browser check |
| **`Field` layouts**: a checkbox layout (then delete `EmailPreference`'s `.preference > div` exception) and a row layout (so search's box and button, and its three selects, can sit in a row) | `hand` | — | `components-map-posts.md` §5, `FRONTEND-007` | `src/components/` |
| **`fetchTeams` exists in four places** (profile, `ProfileSetupPage`, compose's `attachmentReads.ts` since FRONTEND-013, stats), sharing one cache key | `hand` | — | `FRONTEND-007` | Move into `api/`; needs all four features in scope |
| **The media-URL join exists twice** (`features/feed/api.ts`, `features/compose/MediaWidget.tsx`) | `hand` | — | `FRONTEND-005` | Move into `api/` or `components/`; needs both in scope |
| **A username character rule** (look-alike usernames) | `director` | — | `typography.md` §1 | A product decision first. **Director** |

