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

11. `director`: Models to `claude-sonnet-5-5` / `claude-opus-5-5`; pin the CLI at 2.1.280.
12. `director`: The CI half of bug 17.
14. `director`: **Cheap automations** on `claude-haiku-5-5` or `jev`: spec drift check;
    CI failure summary on a red task PR; criteria coverage check on a task
    PR; wiki update proposal after merge. Brief: `Prompts/04-cheap-automations.md`; after D4–D7.
    **CI failure summary built** (`ci-summary.yml`, 2026-10-13, #141, #143) and
    proven live on #144 (2026-10-14, $0.001141). **Criteria coverage check
    built** (`coverage-check.yml`, 2026-10-14, `jev` in shadow); proven by the
    next `agent/*` PR push (#151). **Spec drift check built** (`spec-drift.yml`,
    2026-10-14, dispatch-only, `jev` in shadow). Next: wiki.

Decided, nothing to build: bot-opened PRs keep `action_required`.

## Sports data

NBA data from the Eoin Moore Kaggle dataset, 2003-04 onward (the human's
choice, 2026-10-13; `EVENTS-001`, #139, loaded a first, thinner dataset).
Live brief and unit order: `Prompts/06-nba-data.md`.

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **Delete the API-SPORTS infra resources**: the idempotency and live-score tables, the API-SPORTS secret, the ingestion-retry queue and DLQ, and their exports | `hand` | — | `EVENTS-003` (#142, deployed 2026-10-14) | Now unblocked; needs a spec. Two are `RETAIN`: the human deletes them by hand afterwards |
| **Game detail API** and a paginated, filterable game list | `hand` | `EVENTS-005` | `business-rules.md` "Events" | Done, #146 (2026-10-14) |
| **Player API**: search, detail with career and season stats, game log | `hand` | `EVENTS-006` | the human, 2026-10-13 | Specced 2026-10-14; runs under `Prompts/07` |
| **Stats API**: seasons, standings, champion, leaders, a team's season | `hand` | `EVENTS-007` | `business-rules.md` "Events" | Specced 2026-10-14; runs under `Prompts/07`, after `EVENTS-006` |
| **Load the live RDS**: S3 data bucket and a hand-invoked load function | `hand` | `EVENTS-002` | #139's proposal | Done, #148; loaded by the human 2026-10-14 (runbook #149) |
| **Scheduled refresh from Kaggle** during the season | `hand` | `EVENTS-008` | the human, 2026-10-13 | Gated: the dataset must resume updating after 2026-10-21, and a Kaggle token must be in Secrets Manager |
| **Frontend pass for sports data**: game page with box score, Stats page (Seasons, Players), player pages, `#GameId` links | `hand` | `FRONTEND-008`, `FRONTEND-009` | the human, 2026-10-13 and 2026-10-14 | Specced 2026-10-14; `Prompts/07`. A narrower compose picker is still unplanned |

## Backend and infra

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **`lambda-vpc-eni` self-deny**: a `Deny` on the ENI actions conditioned on `lambda:SourceFunctionArn` (`ArnLike` `Fanwire-App-*`) in `backendFunction` | `hand` | — | `0x00-architecture.md` → the `lambda-vpc-eni` waiver | Check how `infra/test/iam-policy.test.ts` treats a `Deny`. Proven only by a deploy plus a logged-in `/api/users/me` |
| **DLQ-depth alarms**: one CloudWatch alarm per DLQ on `ApproximateNumberOfMessagesVisible > 0`, in `messaging-stack.ts` | `hand` | — | the runbook's known gap | Grows the CloudFormation exec policy (`cloudwatch:*`, and `CloudWatch` in `cfn-exec-policy.test.ts`'s `TYPE_TO_IAM`); the human rolls the policy out **before** the deploy. **Where it notifies is a human decision** (SNS → email); build the alarm first |
| **Local notifications**: the dev stack never creates any, because without `POST_EVENT_BUS_NAME` events go to `InMemoryEventPublisher` and nothing consumes them | `hand` | — | `UI-005`–`UI-007` browser pass | Dev tooling. Until then, `FrontendUI/verification.md` §3a says how to insert rows |
| **Team abbreviations on `LiveScoreView`**, so the feed's score block can name teams instead of "Home" and "Away" | `hand` | — | `components.md` §4 | `feed/` backend, then a frontend unit |

## Frontend

| Item | Mode | Task | Where it came from | Notes |
|---|---|---|---|---|
| **Post counts and a one-click repost** (backend): `reply_count`, `repost_count`, `reposted_by_viewer`, `reposted_post`; `POST`/`DELETE /posts/{id}/repost` | `hand` | `POSTS-001` | the human, 2026-10-14 | Specced; `Prompts/07`. Un-repost is the first post delete (plain reposts only) |
| **The post card**: icon-only like, reply and repost with "x likes"/"x replies"/"x reposts", live like and repost counts, reposts rendered as the original | `hand` | `UI-009` | the human, 2026-10-14 | Specced; after `POSTS-001` |
| **Thread modal at `/posts/:id`** with the reply written in place, below the original | `hand` | `FRONTEND-010` | the human, 2026-10-14 | Specced; after `UI-009` |
| **No sign-out control anywhere.** `useAuth().signOut` works; nothing calls it | `hand` | — | `UI-004`/`UI-008` browser pass | A "Sign out" button in the shell header for signed-in visitors. Writes `src/routes/**`. Browser check |
| **Email toggle while email is off.** "Email me about new notifications" still renders and does nothing | `hand` | — | `0x05-notifications.md` → "Email is off in production" | Keep storing the preference; caption or disable it. Prefer the backend saying whether email is available (a field on the preference response) over a build-time flag |
| **Compose: drop the separate *Attach* click.** Upload → wait for the scan → click *Attach* | `hand` | — | the human, 2026-09-30 ("a bit annoying") | The wait for `Processed` stays; only the click goes. `features/compose/` |
| **"1 followers", "1 likes"**: singular and plural | `auto` | — | `UI-005`, `UI-008` browser passes | The counts are pinned exactly by tests, so each is a behaviour change with its own red test (`features/profile/`, `features/feed/`). **`auto` by the human's choice (2026-10-12)**, an exception to `work-modes.md`'s backend-only rule: the pipeline's first frontend task. Record its cost as handoff §10.5 does. **The feed half ("1 likes") is now `UI-009`'s**; this item is the profile's "1 followers" only |
| **`Badge neutral` is invisible on the score band**: both use `--color-surface-muted`, so "Final" loses its pill | `hand` | — | `UI-005` browser pass | `components/ui` (Badge or `GameScore`), so its own unit. Browser check: no unit test pins it |
| **"Your profile" clips in the bottom bar** at 360 px with a classic scrollbar (345 px of content) | `hand` | — | `UI-005`–`UI-007` browser pass | Shell, `src/routes/**`. Browser check at 360 px |
| **The shell's `scroll-padding-bottom` is about 5 px short**: a focused control near the bottom bar is overlapped (never hidden) | `hand` | — | `FRONTEND-007` browser pass | Shell, `AppLayout.module.css`. Browser check |
| **`Field` layouts**: a checkbox layout (then delete `EmailPreference`'s `.preference > div` exception) and a row layout (so search's box and button, and its three selects, can sit in a row) | `hand` | — | `components.md` §5, `FRONTEND-007` | `src/components/` |
| **`fetchTeams` exists in four places** (profile, `ProfileSetupPage`, `MentionAutocomplete`, search), sharing one cache key | `hand` | — | `FRONTEND-007` | Move into `api/`; needs all four features in scope |
| **The media-URL join exists twice** (`features/feed/api.ts`, `features/compose/MediaWidget.tsx`) | `hand` | — | `FRONTEND-005` | Move into `api/` or `components/`; needs both in scope |
| **A username character rule** (look-alike usernames) | `director` | — | `typography.md` §1 | A product decision first. **Director** |

## Features in `business-rules.md` that are not built

Both are `hand`, with no task yet: each needs a design pass before a spec.

- **The game stats page.** "Posts with a link to a game should be clickable
  to go to the stats page." Once it exists, `#GameId<n>` in post text becomes
  a link styled as an inline `neutral` badge (`components.md` §4).
- **The post menu** (report, copy link). Use the native `<dialog>` and the
  Popover API before considering a dependency (`components.md` §2).
