# 02 — What is left to build

**The remaining work, as of 2026-10-07.** The backend, the CDK app and every
planned frontend unit are built and live; the last unit, `FRONTEND-007`
(search), merged as #114. What follows is small follow-up work, collected from
the prompts and plan sections that found it (now deleted or trimmed), so it
lives in one list.

**How each item is run: the Mode column.** Every item has a **Mode**, chosen
by `wiki/GeneralContext/Architecture/work-modes.md` "Choosing a mode for a
backlog item":

- **`hand`**: the default for code. The human runs it in a Claude Code
  session on the subscription, against a task spec on `agent/<ID>`
  (`wiki/GeneralContext/Architecture/director-sessions.md`).
- **`auto`**: the orchestrator runs it unattended on metered API credit
  (about USD $2–3 a small task). Only when the human says so; record what it
  cost (`.ai/docs/handoff.md` §10.5 is the template).
- **`director`**: touches `.ai/`, `.github/`, `wiki/GeneralContext/` or
  `AGENTS.md`, or needs a human decision first.

**Task** is the task id once a spec exists (`.ai/tasks/<ID>/`), and `—` until
then. Writing a spec is Director work. In every mode the unit is a spec plus an
`agent/<ID>` branch held by `agent-guard`. Nothing is planned outside this
file.

When an item is done, delete it here and record the result as current-state
fact in the module file it changed.

## Agent system

The workflow review reported 2026-10-08. Findings, evidence and the agreed
plan are `.ai/docs/handoff.md` §10; this is the queue, in order. Every item is
`director` work (`.ai/`, `.github/`), one PR each, with its structural
assertion in `.ai/tests/test_workflows.py` where it changes a workflow. D1–D7 have
merged (#117–#130) and `MEDIA-002` ran end to end (handoff §10.5).

9. `director`: **`jev`, shadow mode**: rebuild `jev-decision-layer` onto
   `main`, direct route (`TYPESAFE_API_KEY`, `TODO/01-for-you.md` §1), merge
   gate one 200 with `confidence`. **Folded into `Prompts/04` as its
   Deliverable 0 (2026-10-13)**, with its first use: shadow answers beside
   Haiku in the coverage and spec-drift checks. Shadow beside the Manager
   stays in `Prompts/02` and still needs a deliberately failing task
   (handoff §6.3). **Seam on `main` (#138, 2026-10-13)**, and its smoke
   returned a 200 with `confidence` the same day (run 38422783284,
   $0.0000184), so automations 2 and 3 may ask it in shadow.

11. `director`: Models to `claude-sonnet-5-5` / `claude-opus-5-5`.
12. `director`: The CI half of bug 17.
14. `director`: **Cheap automations** on `claude-haiku-5-5` or `jev`: spec drift check;
    CI failure summary on a red task PR; criteria coverage check on a task
    PR; wiki update proposal after merge. Brief: `Prompts/04-cheap-automations.md`; after D4–D7.
    **CI failure summary built** (`ci-summary.yml`, 2026-10-13, #141, #143) and
    proven live on #144 (2026-10-14, $0.001141). **Criteria coverage check
    built** (`coverage-check.yml`, 2026-10-14, `jev` in shadow); proven by the
    next `agent/*` PR push (#151). **Spec drift check built** (`spec-drift.yml`,
    2026-10-14, dispatch-only, `jev` in shadow) and **wiki update proposal
    built** (`wiki-proposal.yml`, 2026-10-14, a patch in a comment on the
    merged PR). All four built; what is left is proving 2-4 live and
    `agentctl shadow report`.

Decided, nothing to build: bot-opened PRs keep `action_required`.

## Improvement roadmap

From the Director's review of 2026-10-19, agreed with the human. There are
two tracks, and they run in parallel because they share no files except
`deploy.yml` (`08` deliverable 4). Within a track the order is a dependency
order. Each brief is in `wiki/GeneralContext/Prompts/`.
The decisions the briefs raised were answered by the human on
2026-10-19 (`Architecture/human-decisions.md` §8), and each brief records
its answer.

| Order | Brief | Mode | Why it's here |
|---|---|---|---|
| App 1 | ~~`17-production-hardening-finish.md`~~ (was `08`) | `hand` + `director` | **Done 2026-10-20** (brief deleted): the per-user rate limit (#183), 21 alarms with email (#182), the self-checking deploy and the rollback and restore runbooks (#172), the spam score `POSTS-003` (#188), and the first restore drill, 20 min 42 s (`Architecture/incident-runbook.md`). |
| App 2 | ~~`16-performance-tests.md`~~ | `hand` + `director` | **Done 2026-10-21** (brief deleted): `PERF-001` #200, one line, `powershell -File perf/run.ps1 -Profile load`, compared with the previous `load` run on the same machine (`perf/README.md`); the PR-template line and the advisory `perf-advisory` CI job. |
| System 1 | ~~`09-supply-chain-and-trust.md`~~ | `director` | **Done 2026-10-19** (#174–#178, brief deleted; `.ai/docs/handoff.md` §10.6). Every workflow added later is born SHA-pinned. |
| System 2 | `10-docs-structure.md` | `director` | Every later brief writes docs. Typed docs and a ratcheted linter stop that work from adding drift. |
| System 3 | `11-metrics-every-mode.md` | `director` | The sensor. `12` needs its record format and the pipeline version. |
| System 4 | `12-agent-evals.md` | `director` | The test harness. Its first run is the baseline `13`–`15` are judged against. |
| System 5 | `13-worker-shell.md` | `director` | The biggest bottleneck (CI round trips). The first change scored by `12`. |
| System 6 | `14-learning-loop.md` | `director` | Criterion ids (deterministic coverage) and review corrections → skill proposals. Needs `11` and `12`. |
| System 7 | `15-context-graph.md` | `director` | Our own graph generator on mature parsers. It enforces the connection rule; its token savings are measured by `12`. |

## Posts: deletion, deactivation and sports-data attachments

The human's feature set of 2026-10-17, agreed (`Architecture/human-decisions.md`
§9). Ten `hand` units in six stages: USERS-003, EVENTS-009, FRONTEND-011 →
POSTS-004 → FRONTEND-012, POSTS-005 → POSTS-006 → FRONTEND-013, FRONTEND-014 →
FRONTEND-015. Brief, design and order: `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`.
It absorbs the compose game picker row below and both items under
"Features in `business-rules.md` that are not built".

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
choice, 2026-10-13; `EVENTS-001`, #139, loaded a first, thinner dataset).
Live brief and unit order: `Prompts/06-nba-data.md`.

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **Delete the API-SPORTS infra resources**: the idempotency and live-score tables, the API-SPORTS secret, the ingestion-retry queue and DLQ, and their exports | `hand` | — | `EVENTS-003` (#142, deployed 2026-10-14) | Now unblocked; needs a spec. Two are `RETAIN`: the human deletes them by hand afterwards |
| **Scheduled refresh from Kaggle** during the season | `hand` | `EVENTS-008` | the human, 2026-10-13 | Gated: the dataset must resume updating after 2026-10-21, and a Kaggle token must be in Secrets Manager |

## Backend and infra

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **`lambda-vpc-eni` self-deny**: a `Deny` on the ENI actions conditioned on `lambda:SourceFunctionArn` (`ArnLike` `Fanwire-App-*`) in `backendFunction` | `hand` | — | `0x00-architecture.md` → the `lambda-vpc-eni` waiver | Check how `infra/test/iam-policy.test.ts` treats a `Deny`. Proven only by a deploy plus a logged-in `/api/users/me` |
| **A GuardDuty-findings alarm**: route Medium/High findings to the alarm topic (EventBridge rule → SNS) | `director` | — | `incident-runbook.md` Known gaps, after `INFRA-004` | Findings live in the delegated-admin account (`fanwire-log-archive`), not the workload account that holds the topic, so the routing crosses accounts. Needs a design first |
| **A friendlier 429 message**: the frontend shows a generic failure when `POST /posts` or a repost is rate-limited | `hand` | — | `POSTS-002` (#183), "Not in this task" | `createPost` treats every non-2xx alike. A "slow down" line where the composer shows errors |
| **Local notifications**: the dev stack never creates any, because without `POST_EVENT_BUS_NAME` events go to `InMemoryEventPublisher` and nothing consumes them | `hand` | — | `UI-005`–`UI-007` browser pass | Dev tooling. Until then, `FrontendUI/verification.md` §3a says how to insert rows |
| **A missing post is a no-op for the `PostCreated` consumer**, and maybe the REPOST notification goes on un-repost | `hand` | — | `POSTS-001` (#161), `0x03-posts.md` Open decisions | `notifications/` treats a missing post as a malformed event (`MissingReferenceError`, retried, then the DLQ), so a repost undone before the consumer runs lands in the DLQ. The notification also outlives the undo |

## Frontend

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **Frontend tidy-ups left by `FRONTEND-008`/`009`/`UI-009`**: move `features/games/format.ts` to `src/lib/`; one shared `ScrollTable` in `components/ui/` instead of the copies in `stats` and `players`; one teams fetch in `api/` instead of four; delete or reuse the caller-less `GameScore` and `ChevronDownIcon`; a scrim token for `Dialog`'s backdrop (it uses the `--neutral-950` primitive); stale `LikeButton`/"no `aria-pressed`" comments in `Button.tsx`, `search-isolation.test.ts` and `SearchPage.test.tsx` | `hand` | — | the "for the Director" lists of `FRONTEND-008`/`009`/`010` and `UI-009` | One spec, behaviour unchanged; writes `components/ui/`, `src/lib/` and several features |
| **No sign-out control anywhere.** `useAuth().signOut` works; nothing calls it | `hand` | — | `UI-004`/`UI-008` browser pass | A "Sign out" button in the shell header for signed-in visitors. Writes `src/routes/**`. Browser check |
| **Email toggle while email is off.** "Email me about new notifications" still renders and does nothing | `hand` | — | `0x05-notifications.md` → "Email is off in production" | Keep storing the preference; caption or disable it. Prefer the backend saying whether email is available (a field on the preference response) over a build-time flag |
| **Compose: drop the separate *Attach* click.** Upload → wait for the scan → click *Attach* | `hand` | — | the human, 2026-09-30 ("a bit annoying") | The wait for `Processed` stays; only the click goes. `features/compose/` |
| **"1 followers", "1 likes"**: singular and plural | `auto` | — | `UI-005`, `UI-008` browser passes | The counts are pinned exactly by tests, so each is a behaviour change with its own red test (`features/profile/`, `features/feed/`). **`auto` by the human's choice (2026-10-12)**, an exception to `work-modes.md`'s backend-only rule: the pipeline's first frontend task. Record its cost as handoff §10.5 does. **The feed half ("1 likes") is now `UI-009`'s**; this item is the profile's "1 followers" only |
| **`Badge neutral` is invisible on the score band**: both use `--color-surface-muted`, so "Final" loses its pill | `hand` | — | `UI-005` browser pass | `components/ui` (Badge or `GameScore`), so its own unit. Browser check: no unit test pins it |
| **"Your profile" clips in the bottom bar** at 360 px with a classic scrollbar (345 px of content) | `hand` | — | `UI-005`–`UI-007` browser pass | Shell, `src/routes/**`. Browser check at 360 px |
| **The shell's `scroll-padding-bottom` is about 5 px short**: a focused control near the bottom bar is overlapped (never hidden) | `hand` | — | `FRONTEND-007` browser pass | Shell, `AppLayout.module.css`. Browser check |
| **`Field` layouts**: a checkbox layout (then delete `EmailPreference`'s `.preference > div` exception) and a row layout (so search's box and button, and its three selects, can sit in a row) | `hand` | — | `components.md` §5, `FRONTEND-007` | `src/components/` |
| **`fetchTeams` exists in four places** (profile, `ProfileSetupPage`, compose's `attachmentReads.ts` since FRONTEND-013, stats), sharing one cache key | `hand` | — | `FRONTEND-007` | Move into `api/`; needs all four features in scope |
| **The media-URL join exists twice** (`features/feed/api.ts`, `features/compose/MediaWidget.tsx`) | `hand` | — | `FRONTEND-005` | Move into `api/` or `components/`; needs both in scope |
| **A username character rule** (look-alike usernames) | `director` | — | `typography.md` §1 | A product decision first. **Director** |

## Features in `business-rules.md` that are not built

Both are now **`Prompts/18`'s** (2026-10-20): the game link is the `game_final` attachment (POSTS-005, FRONTEND-014), and the post menu is FRONTEND-012's. Delete each bullet when its unit merges.

- **The game stats page.** "Posts with a link to a game should be clickable
  to go to the stats page." Once it exists, `#GameId<n>` in post text becomes
  a link styled as an inline `neutral` badge (`components.md` §4).
- **The post menu** (report, copy link). Use the native `<dialog>` and the
  Popover API before considering a dependency (`components.md` §2).
