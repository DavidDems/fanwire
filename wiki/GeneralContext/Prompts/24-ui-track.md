---
type: prompt
---

# 24 — UI track 2: adjustments after the first track

**Objective:** build the human's 2026-11-07 adjustments
(`CodeContext/FrontendUI/decisions.md`, "UI adjustments after the track") and
the already-specced `EVENTS-014`, then close `TODO/02-backlog.md` "UI track
(2026-11-07)".

You are a **Director** (`AGENTS.md` "Agent system"). Each unit's code lands on
`agent/<ID>` and is held by `agent-guard` to its spec. Your own edits (this
brief, specs, `FrontendUI/`, `Standards/`, `TODO/`) go on a human-named branch,
and the PR body names every restricted-tree edit.

## Read first, in this order

1. `Architecture/director-sessions.md`: the per-unit loop, verification, the
   guard per commit, sibling PRs, browser rows. Follow it exactly. This brief
   only adds to it.
2. `.ai/tasks/<ID>/task.json` and `brief.md` for the unit you are starting. The
   brief's "Decided" section is settled, so do not re-ask it.
3. `CodeContext/FrontendUI/decisions.md` (the 2026-11-07 entry).

Hand each subagent only its spec's `required_context`, never the whole wiki.

## Where things stand

The first UI track is finished and deployed (index "Deleted 2026-11-06").
Production migration head: `b9f4c7e2d610`. The eight new specs and this brief
are the only changes so far; no unit has started.

## Order and gates

```
F: FRONTEND-040 ──▶ FRONTEND-041 ──▶ FRONTEND-042 ──▶ FRONTEND-043
                                        ▲                 ▲
B: EVENTS-015 ──▶ EVENTS-016 ───────────┘──▶ EVENTS-017 ──┘──▶ EVENTS-014
                                                                    │
                       both chains merged + schedule uploaded ──▶ FRONTEND-044
```

- A unit starts only when every unit before it has **merged to `main`**.
  Branch from `origin/main` after that merge, never from an unmerged branch.
- The F and B chains are independent until `FRONTEND-042` (needs
  `EVENTS-016`) and `FRONTEND-043` (needs `EVENTS-017`). Run one unit per chain
  at a time, each in its own worktree, and test sibling PRs together as
  `director-sessions.md` "Sibling PRs" says.
- The B units run in sequence: each edits `routes.py`, `schemas.py`,
  `openapi.json` and `schema.d.ts`.
- `EVENTS-014` (season schedule, #352) is last in B: it adds a migration and
  `FRONTEND-044` is its page. Run `Migration` after its deploy.
- **`FRONTEND-044` (Schedule page) is the very last unit.** It also needs
  production to hold the 2026-27 schedule: the human uploads the
  LeagueSchedule CSV files and a load runs. Before starting it, check that
  `/api/events/seasons/2026-27/schedule` returns `scheduled` games; if not,
  ask the human (an ordered list) and stop there.

## The loop

For each unit, `director-sessions.md` "The loop, per unit", with these
specifics:

- **Delegate**, don't write the code yourself: one subagent for the tests, one
  for the implementation, each in its own worktree with its own install. You
  review, run every gate, run the guard per commit, commit, push and open the PR.
- **Browser rows**: Playwright against `vite preview` on ports 5210–5219 with
  `--strictPort`, from the unit's worktree. Signed-in rows (`FRONTEND-040`'s
  composer): read `.env.test-accounts.local`, localhost only, sign out after.
  Report each row measured or NOT DONE.
- **Backend units**: the containerized backend suite. `EVENTS-016` and
  `EVENTS-017` record timings on the dev fixture (`fanwire_perf`).
- After the PR is open, `agentctl hand finish <ID> --pr <N>`.

## After a PR is open: merge, deploy, migrate

Only the human can merge and approve the `production` deploy.

1. Send one push notification per ready PR: its number, merge order if two are
   open, and whether its deploy adds a migration. Keep working on the other
   chain.
2. Watch for the merge and the `deploy.yml` run with `gh` (every 20–30
   minutes, not a tight poll). After a sibling merges, update the other branch
   with `main` yourself.
3. After `EVENTS-014`'s deploy, the human runs the `Migration` invoke (the
   auto-mode classifier refused the session's own on 2026-11-06). Record the
   head revision on its PR.
4. Check production with `curl`: `/api/health` and the changed route
   (`/api/events/games/recent`, `/api/events/records/holders?ids=…`,
   `/api/events/seasons/2026-27/leader-boards`).

## How the human wants the work done

- **Autonomous.** Ask only when truly blocked: a gate that cannot be met, an
  AWS step outside the allowed list, an expired SSO session (ask for
  `aws sso login --profile fanwire-workload`, one line), or a criterion that is
  wrong in a way you cannot work around. Use `AskUserQuestion` then.
- **AWS without asking:** read-only calls only, profile `fanwire-workload`,
  region `ca-central-1`. No other AWS writes.
- **Design liberties are yours** within each spec's criteria, `tokens.md` and
  `accessibility.md`. Log each choice in an Update note here (unit, choice,
  why) as you make it.
- **A criterion that blocks a clearly better design**: amend the spec in a
  small Director PR that merges before the unit's PR. Log it.
- Never `git stash` or force-push. One Docker test container at a time. Vitest
  `--maxWorkers=2` for full frontend suites. Stop servers only by their
  recorded port and verified PID.
- Every command for the human is one line of PowerShell in its own fenced
  block; every manual step is an ordered list.

## Finish

1. A Director PR that brings `FrontendUI/components.md` (Historical and
   Seasonal cards, the leader dialog, the shared game card, GamePage without
   the artwork, the composer without quick posts), `layout.md` (the Schedule
   page and its nav item) and `typography.md` (the
   composer's "Quick posts" `h2`) and `Standards/gof-patterns.md` (the
   Prototype line named `PostTemplate.clone()`) up to what was built. It also
   removes "UI track (2026-11-07)" from `TODO/02-backlog.md`, deletes this file
   and lists it as deleted in `GeneralContext/index.md`.
2. **The final report to the human**: each unit with its PR and deploy, the
   migration head, every design choice from the log, every spec amendment,
   the browser rows left NOT DONE, and any follow-up worth a backlog line.

If you stop before the end, update this file first: a dated **Update** note at
the top (what merged, what is open, what is next, the design-choice log), and
correct "Where things stand".
