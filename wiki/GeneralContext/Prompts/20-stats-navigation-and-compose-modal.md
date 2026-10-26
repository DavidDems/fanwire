# 20 — Stats navigation and the compose modal: one stats navigator, records, and posting from anywhere

**Update, 2026-10-26:** FRONTEND-021 is implemented in [PR #249](https://github.com/DavidDems/fanwire/pull/249), awaiting human review. The handoff below is retained as the runbook; do not start another hand-run. Stage-4 measurements and the independent skeptic's verdict are recorded in Progress. Merge the unit before this Director documentation PR.

**Brief for a Director session** (a high-tier model, driven turn by turn by
the human). The units are hand-run on `agent/<ID>` and held by `agent-guard`.
Self-contained: read this file, then what it names.

**Objective:** the human finds the stats screens hard to use (long scrolls,
everything loaded at once) and the form inputs dated. This thread does four
things:
- restyles every input;
- rebuilds Stats around one reusable navigator, with Seasons, Records and
  Players;
- adds a Records section, historical and seasonal;
- turns compose into a modal opened from a floating **+** button, with
  icon-only attach controls, an image check that waits in place, and a stats
  picker built on the same navigator.

The post cards and the thread design stay exactly as they are (the human,
2026-10-23).

**A skeptic is deployed against this thread** (the human, 2026-10-23): see
"The skeptic" below. Every unit's spec carries a **Baseline** that the build
must pass, and the skeptic declares it.

Every Director PR here writes `wiki/GeneralContext/`, `wiki/CodeContext/FrontendUI/`
or `.ai/tasks/`, and says so in its body.

## Read first, in this order

1. `wiki/GeneralContext/Architecture/director-sessions.md`, "The loop, per
   unit": the gates, `agentctl hand start|finish`, browser rows, sibling PRs.
2. `wiki/CodeContext/Modules/0x02-events.md`, "API routes" (`EVENTS-006`,
   `EVENTS-007`): the read models, the qualifying rule for leaders, the
   query-count discipline and the measured timings this thread must not
   regress.
3. `wiki/CodeContext/Modules/0x08-frontend.md`: the modal flow
   (`routes/modal-flow.tsx`, `BackgroundRoutes`, `DetailModal`), compose
   (`ComposeMediator`, `MediaWidget`, `AttachmentPicker`, the pre-filled
   `/compose?link=` address), and the feature-isolation tests.
4. `wiki/CodeContext/FrontendUI/index.md`, then `components.md` (§2
   primitives, §3 icons, §5 map) and `accessibility.md`.
5. `wiki/CodeContext/Modules/0x04-media.md`: the upload, scan and process
   pipeline, and its statuses. The new attach flow waits on these.

## Where things stand (2026-10-23)

Verify these against `origin/main`. They're a starting point, not something
to trust.

- **Brief 18 is finished and deployed** (FRONTEND-012 and FRONTEND-015 on
  2026-10-23). It's deleted by Director PR #228.
- **The stats data** is the Eoin Moore Kaggle load: every game since
  2003-04, about 29,646 games and 806,778 box-score rows (`Prompts/06`). The
  live database has it. **The local dev database is empty and the CSVs are
  not on this machine.** See "Mechanics".
- **Stats today** (`features/stats/`):
  - `StatsPage` has route tabs, Seasons and Players.
  - `SeasonsTab` shows `LeagueView` (champion, standings for both
    conferences, leaders for six stats) and `TeamSeasonView` (a team's
    games) on one long page.
  - `PlayersTab` is a search.
- **Compose today** (`features/compose/`):
  - `/compose` is a full page behind `RequireAuth`, with a "Compose" nav item.
  - `MediaWidget` uploads, polls the pipeline every 300 ms, then needs a
    second "Attach" press.
  - `AttachmentPicker` (FRONTEND-013) is an in-form panel of selects and
    lists.
  - FRONTEND-017's "Post about this" links open `/compose?link=…`.

## The skeptic

A second agent, deployed against this thread's complexity and its effect on
latency. It exists because this thread adds new screens, a modal over every
page and whole-history queries, and any of those can freeze a phone or a
`db.t4g.micro`.

- **Who.** A fresh-context subagent the Director spawns, separate from the
  test and implementation agents. It's told to argue that the unit is too
  complex or too slow, and to prove it with numbers. It reads, measures and
  writes a report. It never edits code or specs itself.
- **When, first: before a unit's branch is cut.** It reviews the spec and
  declares the **Baseline**: the case the build must pass. The Director lands
  that Baseline in the spec, with the spec's own Director PR or with an
  amendment PR merged before the branch is cut (agent-guard reads the spec
  from the merge ref). Each spec written by this brief already carries a
  provisional Baseline. The skeptic tightens it, or argues it down with a
  reason.
- **When, second: before the PR is handed over.** It reads the diff and the
  measured numbers, and lists every Baseline line as met, missed or
  unmeasured. A missed line is fixed (delegated as usual) or taken to the
  human. It is never waived silently.
- **What a Baseline holds**, deterministic where possible (`AGENTS.md`
  "Process note": a rule only on paper isn't a rule):
  - **Query counts per route**, pinned by query-count tests.
  - **Bounded responses.** Every list takes a `limit` with a maximum, and
    payloads are capped.
  - **Bundle budgets.** No chunk over Vite's 500 kB warning, and a stated
    gzip budget for the route chunks a unit adds. The build output is in the
    PR.
  - **Requests per screen.** The number of API calls a screen makes on open,
    pinned with msw request counts.
  - **Measured latency.** The median warm call on a database at full-load
    scale, in the PR body and `0x02-events.md`, against a stated ceiling.
  - **Browser rows for freezing.** No long task over 200 ms while opening or
    switching a stats tab or the compose modal, with Chromium's CPU throttled
    4× at 360 wide (Performance panel). Cumulative layout shift under 0.1.
- **Its verdict on the whole thread** goes in this file's Progress section
  after each stage.

## Deliverables

Units in dependency order. One spec, one branch and one PR per unit.
Units on the same row can run in parallel, but test the combination on a
merged preview before the second one merges. Specs are written just in time:
`UI-010` and `EVENTS-010` are specified by this brief's PR, and the rest are
specified when what they build on has merged.

| Stage | Unit | Scope | Needs |
|---|---|---|---|
| 1 | **UI-010**: soft-filled inputs and shared primitives | every form control restyled (the human's "soft filled" direction); `SegmentedTabs` (an in-page tab bar); `FloatingButton`; `SearchInput`; icons `circle-plus`, `paperclip`, `circle-x` | — |
| 1 | **EVENTS-010**: the records API | `GET /events/records` (each record's holder) and `GET /events/records/{record_id}` (the ranked list); live and measured | — |
| 2 | **FRONTEND-018**: the stats navigator, and Stats rebuilt on it | shared navigator components, outside `features/` so compose can use them; Seasons gets All / East / West tabs and a team level, and the season-wide games list goes | UI-010 |
| 2 | **FRONTEND-020**: the compose modal | `/compose` as an overlay route over the current page; the **+** button bottom right replaces the nav item; paperclip and bar-chart icon buttons; the image check overlay with auto-attach, a 30 s bound and the red refusal line | UI-010 |
| 3 | **FRONTEND-019**: Records | `StatsPage` becomes Seasons / Records / Players; the Records tab: Historical (Team and Player tabs of record cards, each opening its full ranked list) and Seasonal (the per-season leaders, moved from Seasons in this unit) | EVENTS-010, FRONTEND-018 |
| 4 | **FRONTEND-021**: the stats picker modal | the bar-chart button opens a second modal holding the navigator in select mode, with Cancel and Select (disabled until a selectable item is chosen); it replaces `AttachmentPicker` | FRONTEND-018, FRONTEND-020 |

Each frontend unit's `FrontendUI/components.md` rows go in a Director PR:
no unit role may write `FrontendUI/`.

## Decided by the human (2026-10-23, by `AskUserQuestion` and in the request)

- **Compose is `/compose` over the current page**, like the thread modal.
  - Back or Escape closes it.
  - A direct load or a refresh opens it over the feed.
  - `/compose?link=…` keeps working, so FRONTEND-017's links don't change.
- **The + button replaces the Compose nav item**, in the header and in the
  phone's bottom bar. It shows only to a signed-in active member.
- **Inputs are "soft filled"**:
  - no outline at rest, a muted fill, a 12 px radius, 48 px tall, the label
    above;
  - on focus, the fill lightens and an accent ring appears;
  - selects get a custom chevron, and search fields get a leading icon.
- **Records are computed live**, under a measured ceiling. A record that
  misses it gets a stored table, refreshed by the data loader, in its own
  later unit. 0x02's "no aggregate table until measured" rule holds.
- **From the request:**
  - **Image check:**
    - While the pipeline verifies an attached image, an overlay with a
      loading signal covers the image, and the user waits.
    - On `processed` it's attached, with no second press.
    - On a refusal (wrong type, too large, `rejected`) or after 30 s, the
      image is removed and a red line with an ✕ icon reads exactly "The image
      you attached is too large or cannot be accepted".
  - **Stats picker:** Cancel, and Select (grey and disabled until something
    selectable is chosen).
  - **Seasons:** a horizontal All / East / West tab bar, and the leaders move
    to Records > Seasonal.
  - **Records > Historical:**
    - Each record is a card showing its holder, with "View all" at the right
      of its title.
    - Clicking anywhere on the card opens that record's ranked list.
    - Team and Player records are tabs.

## Decided by the human (2026-10-24, by `AskUserQuestion`, for stage 2)

- **The season-wide games list is dropped.** A season shows its champion and
  standings. A team's games open when the team is opened.
- **The leaders stay on Seasons until FRONTEND-019 moves them** to Records >
  Seasonal, in one PR, so no deploy is ever without them.
- **The thread's reply box takes the new image flow too.** `InlineComposer`
  uses the same `MediaWidget`. Only its attach control changes.
- **A published post closes the compose modal**, and the feed's data is
  refreshed.

## How the human wants the work done

- **The loop:** hand-run each unit, test-first in separate commits. Delegate
  the tests and the implementation to worktree subagents; the Director
  reviews, runs the gates and commits (`director-sessions.md`).
- **Check paths before pushing:** check every changed path against the
  dispatched roles before each push.
- **Browser rows:** run them on localhost, signed in with the test accounts,
  in light and dark, at 360 and 1280. **Do the 360 rows:** brief 18's found
  five defects jsdom couldn't see.
- **Decisions:** anything that is the human's, ask with `AskUserQuestion`.
  Manual steps go in an ordered list, with one line of PowerShell per command.

## Local data

- **The dataset:** the Eoin Moore Kaggle dataset "NBA Dataset: Box Scores and
  Stats (1947–Today)". Its four CSVs (`Games.csv`, `PlayerStatistics.csv`,
  `TeamStatistics.csv` and `Players.csv`) are in `C:\data\nba`. That folder
  is outside the repository and is never committed.
  - **Status, 2026-10-25:** downloaded. The four files have the same columns
    as the June 2026 copy, and add the first 28 games of 2026-27. The
    June copy (`C:\data\nba-eoin`, which EVENTS-010 measured on) is retired.
  - **The live database has them** (2026-10-25: the human uploaded the four
    files and loaded `2026-27` by `build-deployment.md` "Load sports data").
  - **`fanwire_perf`,** the Director's measuring database in the dev Postgres,
    holds the full load through 2025-26 plus those 28 games.
- **Load it into `backend-dev`'s Postgres** from the host, with the backend
  venv. Load one season per run: one run holds its whole box score in memory
  (`backend/scripts/load_nba_history.py`).
  - One PowerShell line, from the repository root, with `backend-dev` and
    `postgres` running:
    `$env:DATABASE_URL='postgresql+psycopg://fanwire:fanwire@localhost:5432/fanwire'; foreach ($y in 2003..2025) { $s = "$y-$((($y + 1) % 100).ToString('00'))"; backend\.venv\Scripts\python backend\scripts\load_nba_history.py --data-dir C:\data\nba --season $s; if ($LASTEXITCODE -ne 0) { break } }`
- **The dev database is ephemeral.** `docker compose down` and a fresh `up`
  start it empty, so leave `postgres` running until EVENTS-010's measurements
  and the stage 2 browser rows are done.
  - While the load is in place, browser rows use it, not the small SQL
    fixture. A fresh database needs the test accounts' profiles created again
    on first sign-in.
- **Memory:** a full load plus a test run is a lot for the 16 GB machine.
  Don't load, or start a container, while another session is running tests.

## Mechanics learned the hard way

- **Symptom: no stats data in the browser rows.**
  - The dev database is ephemeral and the CSVs aren't here.
  - For screens, load a small SQL fixture (the memory note
    `project_dev-stats-fixture`).
  - For EVENTS-010's latency numbers, a fixture is useless. Either the human
    puts the four CSVs back (`Prompts/06`, then `load_nba_history.py`), or the
    unit adds a synthetic generator at full-load scale (about 30,000 games and
    800,000 box-score rows). Ask the human which one, at the start of
    EVENTS-010.
- **Symptom: a signed-in browser row is refused by the auto-mode
  classifier.** Keep the sign-in call to the sign-in alone. If it's still
  refused, ask the human once.
- **Symptom: two sibling PRs each green, red together.** Tree-scanning tests
  trip on each other: run the full suite on a merged preview.
- **Symptom: the guard fails on a `FrontendUI/` path.** No unit role may
  write it. Those rows go in a Director PR.
- **Symptom: a test the implementation can't satisfy without breaking the
  spec.** `allow_test_edits_during_impl` is false. The Director corrects the
  test in its own commit, before the implementation commit, and names it in
  the PR (`124b48c` in FRONTEND-012).

## Design notes (starting points, not decisions)

- **The navigator's home.** Compose may not import `features/stats`. The
  shared navigator (levels, breadcrumb, Back, rows, tabs and their reads)
  lives in a shared tree, e.g. `src/components/stats-nav/`, and the stats
  reads now duplicated in `compose/attachmentReads.ts` and `features/stats`
  move into `src/api/`. Proposal: one `StatsNavigator` holds a stack of
  levels, from Seasons → season (All / East / West) → team → game → box-score
  row, and from Players → player → scope. It's route-driven on the Stats
  page and state-driven in the picker, where each level can mark a row
  selectable (a completed game, a played line, a career scope: the three
  `data_link` types). Nothing else is selectable.
- **"Only load what you view."**
  - Standings are about 30 rows (16 ms), so All / East / West filter one
    response on the client.
  - The savings come from not fetching leaders on Seasons, fetching a team's
    games only when the team is opened, and fetching records only on the
    Records tab.
  - The skeptic should pin requests-per-screen for each tab.
- **Records whose rules need care (EVENTS-010 settles them):**
  - A season in progress can't hold a season record, or a 10-0 start would
    top "best record". Only seasons with a champion count.
  - Every record says "since 2003-04", because that is the data.
- **The 30 s image bound is the client's.** The pipeline may still finish
  later, and an unattached media row is already the normal case for an
  abandoned draft (`0x04-media.md`).
- **The + button sits above the phone's bottom bar**, clear of the safe-area
  inset. It must not cover a card's "More options" button at 360: that is a
  browser row.

## Progress

Update this section in every spec PR and unit PR of this thread.

- **2026-10-23, written:** this brief, and the `UI-010` and `EVENTS-010`
  specs with provisional Baselines (one Director PR).
- **2026-10-23, the skeptic's first pass** (stage 1, read-only, `origin/main`
  8bda2e1). The verdict is to proceed on both, with tighter Baselines, which
  this amendment PR lands:
  - **UI-010:**
    - The budgets are cut to +1.0 kB JS gzip and +1.25 kB CSS gzip, pinned
      by a `bundle-budget.test.ts` that runs Vite's build in vitest. CI
      doesn't fail on the chunk warning.
    - Source scans enforce "no `url(`" and "no runtime listeners".
    - **The bottom rule is required:** no soft fill reaches 3:1 in either
      theme.
  - **EVENTS-010:**
    - Every list is capped at its top 100: an unbounded `total` and `offset`
      meant a full scan of about 650k lines on every call.
    - The summary is allowed 13 queries, not 12.
    - **Ceilings:** 50 ms per list, 150 ms for career points, and 250 ms for
      the summary locally. A db.t4g.micro proxy (500 ms and 350 ms) is
      recorded.
    - EXPLAIN buffer caps prove that only career points reads the whole box
      score.
    - Five indexes are expected: four single-game, plus a partial index for
      triple-doubles.
  - **Carried to later specs** (the risks it couldn't measure):
    - **R1:** the main chunk is 468 kB raw, 32 kB under the warning. The
      bundle-budget test carries forward, main stays at most 480 kB raw at
      the thread's end, and the compose modal and the navigator are
      `lazy()`, pinned by a test (FRONTEND-018, -020).
    - **R3:** Stats already fails CLS at 360 wide (0.14). FRONTEND-018's
      Baseline is under 0.1.
    - **R4:** a cold-load long-task row on every unit from stage 2. Today's
      worst is 174 ms, 26 ms under the line.
    - **R11:** Records opens with one call, and "View all" adds one, pinned
      with msw (FRONTEND-019).
    - **R7, decided by the human (2026-10-23):** the records routes are
      cacheable for 5 minutes at CloudFront. EVENTS-010 adds
      `Cache-Control: public, max-age=300` and a `/api/events/records*`
      behaviour whose cache key holds no `Authorization`; `/api/*` stays
      uncached. The ceilings are still measured uncached at the origin.
      FRONTEND-019 uses `staleTime: Infinity` for records either way.
- **2026-10-23, decided (the human, by `AskUserQuestion`):** EVENTS-010
  measures on the real CSVs, which the human puts back
  (`Prompts/06`, `load_nba_history.py`), and builds the synthetic generator
  anyway.
- **2026-10-23, ready to hand-run:** the Baseline amendment merged as #230,
  so both branches can be cut from `main`. **The dataset is pending**: Kaggle
  re-published it on 2026-10-23 and shows "awaiting compression". The human
  downloads it within a few hours, into `C:\Users\david\data\nba` ("Local
  data" below).
- **2026-10-23, `UI-010` hand-run, PR #232** (awaiting review; its
  `FrontendUI/` rows are in this Director PR). Every Baseline line is met:
  - Bundle: entry JS +0.12 kB gzip (148.83, budget 149.6), entry CSS +0.38
    (5.39, budget 6.25). Lazy chunks are unchanged.
  - Requests per screen are unchanged (1 on `/`, 8 on Seasons). There are no
    new long tasks: the worst cold load of `/` is 158 ms, typing has none,
    and CLS is 0 on `/` and `/sign-in`.
  - Post cards and the thread root card are byte-identical in screenshots
    before and after.
  - **Two defects were found and fixed in-unit, each with a Director test
    commit first:**
    - Forced colors (`accessibility.md` A20) dropped the shadow-drawn bottom
      rule and invalid ring. Found by the Director's review.
    - The gradient select chevron disappeared under forced colors. Found by
      the skeptic's second pass.
  - **The skeptic's verdict:** proceed. The cost is negligible and the
    complexity is earned (about 400 lines of code against 1,900 of tests).
  - **Carried to the stage-2 specs (FRONTEND-018, -020):**
    - **R12, the bundle-budget test blocks them as written.** It
      hard-codes every lazy chunk's size and fails on a new chunk, and those
      sizes only exist after implementation, when test edits are frozen.
      Each spec either lists `src/test/bundle-budget.test.ts` for update in
      its implementation commit, or replaces the exact sizes with a gzip
      budget per new lazy chunk, declared in the test commit.
    - **R13:** the entry has 0.77 kB gzip of headroom. Compose and the
      navigator are `lazy()` (R1), and each may grow the entry by at most
      +0.5 kB gzip.
    - **R14:** the (f) rows use five alternating runs per side and report
      the median and the worst. This machine's noise is about ±50 ms.
    - **Look decision for FRONTEND-018:** an overflowing `SegmentedTabs`
      bar shows a classic scrollbar on Windows desktop.
    - **FRONTEND-020:** at 360 the **+** can sit over a card's right edge
      while scrolling; the "More options" row checks it.
- **2026-10-24, `EVENTS-010` hand-run, PR #234** (awaiting review).
  - **The data:** the current dataset still says "awaiting compression", so
    it was measured on the human's June 15 2026 download (`C:\data\nba-eoin`,
    complete through the 2025-26 Finals). It is loaded into a separate
    database, `fanwire_perf`, in the dev Postgres. The `fanwire` database
    still holds only the small browser fixture.
  - **Eight indexes** (migration `b5e9c3a7d2f1`), each justified by a plan:
    - four single-game stats, triple-doubles, the NBA Finals games, a game's
      margin (kept by the human for the summary), and `games (season)` for
      the data window (added by the human);
    - two query rewrites: `FETCH FIRST ... WITH TIES`, and season records
      grouped per side.
  - **Met:** every latency ceiling.
    - Locally: summary 187–193 ms, career points 100–107 ms, other lists at
      most 41 ms.
    - Micro proxy: summary 315–351 ms, career points 210–274 ms.
    - Also met: payloads, the per-list buffer caps, the regressions, and the
      upgrade (3.0 s).
  - **Missed, both accepted by the human (2026-10-24):**
    - the whole summary's buffers, about 22,200 against 19,193 (all repeat
      reads of `games`);
    - the 800,000-row scale floor, because the real data has 745,466.
  - **Carried to FRONTEND-019:**
    - Season records rank on the exact fraction but show three places, so
      two rows can show the same .xxx with different ranks.
    - The points-in-a-game holder is Adebayo's 83 (2026-03-10, in the
      dataset), which the Director couldn't check.
- **2026-10-24, stage 1 done:** EVENTS-010 merged as #234, and this
  brief's entry for it as #235.
- **2026-10-24, the FRONTEND-018 and FRONTEND-020 specs** (one Director PR,
  which also writes `frontend/src/test/`).
  - **Decided by the human** ("Decided by the human … for stage 2" above):
    - the season-wide games list is dropped;
    - FRONTEND-019 moves the leaders;
    - the reply box takes the new image flow;
    - a published post closes the modal;
    - the 30 s bound starts when the upload finishes.
  - **The bundle budget is per unit now (R12).**
    - `src/test/bundle-budget.ts` holds a base measured by the test's own
      build on 041e1c1: entry 148,797 B gzip and 468,568 B raw, entry CSS
      5,388 B, and every lazy JS chunk and stylesheet.
    - Each unit in flight declares its changes in
      `src/test/bundle-budgets/<UNIT>.ts`.
    - **After a unit merges,** the next Director spec PR measures `main`
      again, folds the sizes into the base and deletes the unit's file.
  - **The skeptic's first pass: proceed with changes, on both units.** All of
    them are in the specs. It built bare prototypes of each and measured
    them:
    - FRONTEND-018 grows the entry 16 B, and the Stats JS from 6,830 B to
      7,351 B;
    - FRONTEND-020 grows the entry +807 B gzip, so **R13's +0.5 kB was
      unmeetable**. One unit may now grow the entry by at most 1 kB, and
      FRONTEND-020 declares at most 1,000 B.
    - It also found five contract defects, C1–C5, each now fixed in a spec:
      - the navigator needed `features/games/format`;
      - the + couldn't carry history state;
      - focus had nowhere to return to when compose opens from inside the
        detail modal;
      - the "0 requests" lines needed a `staleTime`;
      - the guard's in-place states would render below the page.
    - It found four budget holes, M1–M4, all fixed:
      - the base was a ceiling, not a measurement;
      - later units would have been refused;
      - two chunks with the same name could hide each other;
      - lazy CSS was not budgeted.
  - **Risks carried:**
    - **R15 (018):** the champion and the All standings must hold their
      height while loading, for CLS under 0.1.
    - **R16 (020):** the pipeline's production latency was never timed. Time
      it on the live stack after deploy.
    - **R17 (020):** the final poll at the bound, now in the spec.
    - **R18 (021):** a link inside the compose dialog continues a modal flow
      (depth 2, with Back), because the dialog renders inside
      `ModalFlowScope`.
    - **R19 (019, 021):** after FRONTEND-020 the entry is about 472 kB raw and
      149.8 kB gzip, so those two units add nothing to it.
    - **R20 (018):** a new shared chunk's name can't be predicted, so the
      Director may correct the budget file before the implementation commit.
    - **R21:** the headroom figure in R13 above was 0.88 kB on 041e1c1, not
      0.77.
- **2026-10-24, the stage-2 specs merged as #236.**
- **2026-10-25, `FRONTEND-018` hand-run, PR #237, and `FRONTEND-020`
  hand-run, PR #238** (both awaiting review). Hand-run in parallel. The pair
  passes on a merged preview: 157 files and 2,188 tests, with typecheck, lint,
  build and both budget files. They merge with no conflicts, in either order.
  - **FRONTEND-018 meets every Baseline line.**
    - Measured on the full load in `fanwire_perf`, at 360 wide with the CPU
      throttled 4×. The cold Seasons load's long task has a median of 102 ms
      (before 141) and a worst of 134 (before 345).
    - CLS is 0.0013 in every run (before 0.365 on the full load).
    - Requests: a cold Seasons load is 7 (before 8), and tabs and Back cost 0.
    - The Stats JS is 7,650 B gzip, against a ceiling of 7,800.
    - The Director corrected the budget file's chunk names after a build
      (R20).
    - The skeptic's second pass found that focus landed on a "Team"
      placeholder, a raw-HTML sweep had stopped covering the moved views,
      and the ceilings had thin margins. All three are fixed, test-first.
  - **FRONTEND-020 meets every Baseline line but one focus criterion.**
    - Entry: +661 B gzip, against an allowance of 1,000.
    - Opening compose with a cold chunk: a median long task of 116 ms, worst
      165, with 42–43 cards on the feed.
    - **The browser rows found a layout shift of 0.24** when the image tile
      appeared: the shared `Dialog` is centred, so the compose dialog jumped.
      Fixed test-first by anchoring the compose dialog at the top. The shift
      is now 0.052.
    - **Six test corrections by the Director**, each one the spec required
      (the `/api` base, the feed under `/compose`, the exact name of the old
      Attach button). From the skeptic's second pass, the publish count runs
      at the app's `staleTime` instead of filtering a request out.
    - **Local uploads can't run.** The quarantine bucket's CORS allows only
      the production domain, and `backend-dev` answers `POST /media/uploads`
      with 500. So the image rows stub the ticket, the bucket and the poll.
  - **Missed and carried:**
    - **R22 (FRONTEND-020 criterion 2 → FRONTEND-021, or a small Director UI
      PR):** focus after Close from inside the detail modal lands on the
      Dialog's content scroller.
      - `components/ui/Dialog.tsx` leaves initial focus to the browser. On
        cached, tall content, Chrome takes the scroller, and that affects
        every `Dialog`.
      - Fix: `autoFocus` on Close, or focus it after `showModal()`.
    - **R23 (→ FRONTEND-021):** a compose chunk that fails to load stays
      failed until a reload, because `loadComposer` caches the rejected
      promise.
    - **R24 (FRONTEND-019):** retire the Stats copy of the table CSS when the
      leaders move.
    - **R16** still stands: time the image pipeline on the live stack after
      deploy.
  - **Rule slip, reported:** the Director stopped its own preview servers with a
    command line match that also stopped about 20 other `vite preview`
    processes on the machine, some days old. From now on, stop processes by
    the port that was started.
- **2026-10-25, stage 2 done:** #237, #238 and #239 merged and deployed.
  The new dataset is in `C:\data\nba` and the live database has the first
  2026-27 games ("Local data").
- **2026-10-25, the FRONTEND-019 spec** (one Director PR, which also writes
  `frontend/src/test/`).
  - **Decided by the human** (by `AskUserQuestion`): a record's ranked list
    opens as a **navigator level** in the page (breadcrumb, Back, its own
    `?record=` address), not in a `Dialog`. So **R22 stays with
    FRONTEND-021** or a small Director UI PR.
  - **The budget fold.** The test's own build on `main` 4fc9b46: entry
    149,444 B gzip and 470,954 B raw, entry CSS 5,543 B. That is 9,046 B raw
    under R1's 480 kB. The FRONTEND-018 and FRONTEND-020 files are deleted,
    and the combine test's "already in the base" case now uses `format`
    (`links` left the base).
  - **The skeptic's first pass: proceed with changes,** all in the spec. Its
    prototype grows the entry by 69 B gzip. The navigator becomes a shared
    `StatsNavigator` chunk (4,359 B), so a cold Seasons loads about 1.66 kB
    gzip of records views it doesn't show. That is accepted. R24 saves only
    67 B gzip. Every request count held: Records opens with 1 and a card adds
    1 (R11), and a cold Seasons goes from 7 to 4.
    - It found eight contract defects, D1–D8, all fixed in the spec: the
      budget lines, a `teamLink` adapter, the record level's group, headings
      that are never empty, the leaders' cell classes, the full list of
      tests the move breaks, history for the bars, and the wording.
  - **Risks carried:**
    - **R25 (FRONTEND-021):** the picker's navigator chunk carries the
      records views (about 3 kB gzip), though a record is never selectable.
      Accept it or split it there, and budget it.
    - **R26 (019):** the shared chunk's name. The Director may correct the
      budget names, keeping the sums of 9,850 JS and 1,800 CSS.
    - **R27 (019):** the cards' hold height at 360, where holder lines wrap.
    - **R28 (019):** the 100-row list's long task is reasoned, not measured.
    - **R29 (a later unit or a Director PR):** `api/records.ts` will duplicate
      `api/stats.ts`'s private `ok()` helper, because `api/stats.ts` is
      forbidden to this unit. Fold the two later.
- **2026-10-26, `FRONTEND-019` hand-run, PR #242** (awaiting review). Its
  `FrontendUI/components.md` rows are in this Director PR, with the
  navigator's rows FRONTEND-018 never got.
  - **It meets every Baseline line.**
    - Bundle: the entry grows 65 B gzip and 241 B raw (to 149,509 and
      471,195). The navigator is a shared `StatsNavigator` chunk of 4,696 B,
      RecordsTab is 1,536 B, and SeasonsTab drops from 4,637 to 1,627. Every
      chunk name came out as declared.
    - Requests: Records opens with 1 call, and a card adds 1 (R11). A cold
      Seasons makes 4, down from 7.
    - It was measured on the full load in `fanwire_perf`, served by the
      branch's backend on its own port. Long tasks at 360 with the CPU
      throttled 4×, as medians (worst):
      - a cold Records, 108 ms (127);
      - opening the 100-row `player-points-game` list, 99 ms (142);
      - a cold record address, 138 ms (170);
      - a cold Seasons, 101 ms (107), against 95 ms (118) on `main`;
      - tabs and Back, 0.
    - CLS is 0 on a cold Records and 0.0056 on a cold record.
    - The container suite passes: 163 files and 2,308 tests.
  - **One Director test correction** (`d30f892`). A `beforeAll` warm-up of the
    lazy Records chunk went into four test files. The first test of a file
    had overrun `findBy`'s 1 s under the full suite's load. No assertion
    changed.
  - **The browser rows** ran signed out and signed in, light and dark, at 360
    and 1280.
    - The holders match the real records: the Warriors' .890, the Kings' 176
      and Kobe's 81 second to Adebayo's 83, which is in the dataset.
    - The test account's profile was created in `fanwire_perf` on its first
      sign-in.
  - **Decided by the human** (by `AskUserQuestion`), both kept as built:
    - at depth 1, the lone breadcrumb and the heading both read "Team
      records";
    - Seasonal opens on the newest season, which early in 2026-27 shows "No
      player qualifies" on every board (**R31**).
  - **The skeptic's second pass: hand over.** R26–R28 are closed by the
    measurements.
  - **Risks carried:**
    - **R30 (FRONTEND-021, or a Director UI PR):** Back pressed before a cold
      record's list lands goes to the Team tab, even for a player record.
    - **R32 (watch CI):** the StatsPage and routes tests that reach
      `/stats/records` have no warm-up, so a cold-chunk `findBy` flake is
      possible there.
    - **R33 (the next spec PR):** the margins are thin. The entry has 59 B raw
      left under this unit's +300 allowance, and `css:StatsNavigator.css` has
      36 B. The next fold re-measures `main`.
    - **R25 and R29 still stand.** The picker's chunk now carries the records
      views and `SeasonSelect` too.
- **2026-10-26, stage 3 done:** #242 and #243 merged and deployed.
- **2026-10-26, the skeptic's verdict on the thread so far (stages 1–3): the
  complexity is earned, and latency held.**
  - **One navigator serves Seasons and Records.** A cold Seasons went from 8
    requests to 7, then to 4. The leaders and the season-wide games list are
    off Seasons.
  - **Every measured row passed.** The worst cold long tasks were 134 ms
    (018), 165 (020) and 170 (019), all under the 200 ms median and 250 ms
    worst-run caps. CLS was 0.0013, 0.052 and 0.0056, and 018 fixed the
    0.365 Seasons regression.
  - **R1 holds.** Over four units the entry grew from 148,797 to 149,517 B
    gzip and from 468,568 to 471,195 B raw, which leaves 8,805 B of raw
    headroom. Its own build of 47b6ffd matched the R33 fold byte for byte.
  - **What slipped:**
    - FRONTEND-020 criterion 2 (R22), reproduced on `main`: focus lands on
      the Dialog's content scroller;
    - R16: the image pipeline has still never been timed live, and every
      image row has used stubs;
    - the process kill by command-line pattern, already reported.
  - **R23 is worse than recorded.** On `main`, a compose chunk that fails to
    load replaces the whole app with React Router's "Unexpected Application
    Error".
  - **R32's flake is real.** It took a Director correction (`d30f892`), and
    StatsPage and routes are still open.
  - **Data gaps for later rows:**
    - `fanwire_perf` has no posts and 1 user;
    - `fanwire` has a 20-card feed and only 2 games.
- **2026-10-26, the FRONTEND-021 spec** (one Director PR, which also writes
  `frontend/src/test/`).
  - **Decided by the human** (by `AskUserQuestion`):
    - a game's result is picked on the game's level, beside its box-score
      lines;
    - the picker's tabs are Seasons and Players;
    - compose opens with focus in its text box (R38).
  - **The budget fold (R33).** The test's own build on `main` 47b6ffd
    measured the entry at 149,517 B gzip and 471,195 B raw, and the entry CSS
    at 5,543 B. `bundle-budgets/FRONTEND-019.ts` is deleted. The combine
    test's "added" case now uses `PickerTab`, because `RecordsTab` is in the
    base.
  - **The skeptic's first pass: proceed with changes,** all of them in the
    spec. It built a prototype on 741944e.
    - **Bundle:** the entry grows +215 B gzip and +500 B raw, declared at 300
      and 700.
    - **Compose open gets lighter:** `ComposePage` plus `stats` is 4,566 B,
      against 5,373 before.
    - **R25 is split by injection.** `StatsNavigator` takes the levels it
      doesn't own from its caller, so the shared chunk goes from 4,696 to
      3,243 B and the records views move into `RecordsTab`. A cold Records
      has no extra serial load.
    - **Requests:** opening the picker cold makes 3, reopening it makes 0,
      and every level makes 1.
    - **Long tasks:** the worst prototype row was 137 ms (a 96-game team),
      and the picker cold had a median of 55 ms.
    - **CLS:** anchoring the picker at the top keeps it at 0.0275 or less. It
      was 0.27 centred.
    - **Two blocking defects:**
      - **D6:** Enter inside a picker nested in the compose `<form>` posted
        the draft;
      - **D4:** the select-mode views can't live in `stats-nav`.
    - **The other defects (D1–D16):**
      - the under-declared bundle lines, and the entry's real growth;
      - a season select, whose duplicate id cost it its name;
      - the request counts, and the shared cache keys;
      - the 47 tests in 6 files that the change breaks;
      - R23's two traps: `React.lazy` caches its rejection, and Vite never
        re-requests a stylesheet;
      - R30's group from the record id's prefix;
      - a database for the feed rows;
      - the PR body's test list;
      - a wrong number.
    - **Closed or held by the design:** R18, R19, R1, R22, R25, R29 and R30.
      R32 stays open.
  - **Risks carried:**
    - **R34 (021):** sharing the navigator splits the Stats chunks. A cold
      Seasons or Records fetches 3 more files, in parallel, with +247 B gzip
      of CSS, though the Seasons JS drops 1,137.
    - **R35 (021):** the `stats` and `StatsNav.module` chunk names depend on
      the import graph, so the Director may correct them (R20).
    - **R36:** a 96-game team table plus 27 radios is the heaviest DOM, with
      a worst of 146 ms. A full playoff season (about 110 games) has no
      measured margin.
    - **R37:** Escape and Back in nested Dialogs are proven for one level
      only.
    - **R16** still stands.
- **2026-10-26, the FRONTEND-021 spec merged as #247.** The human approved
  its deploy (the spec and the budget base only, so the app doesn't change).
- **2026-10-26, handoff.** The Director session that wrote the spec stopped
  here, because the human's weekly Claude limit is nearly used. The hand-run
  of FRONTEND-021 is handed to another agent, which may not be Claude Code.
  Nothing for it has started: no branch, no `state.json`.
- **2026-10-26, FRONTEND-021 hand-run, PR #249** (awaiting review), the
  final feature unit of this brief. Its FrontendUI rows are in this separate
  Director PR, which deliberately writes `FrontendUI/` and `GeneralContext/`.
  - **Every Baseline line is met.** Full frontend container: 170 files and
    2,335 tests; typecheck, lint, production build and both bundle suites pass.
  - **Bundle:** entry 471,844 B raw and 149,814 B gzip;
    growth +649 raw and +297 gzip,
    within +700/+300 without tolerance. Every declared chunk name matched;
    no budget correction, dependency change or records code in the picker.
  - **Requests:** compose 0 (prefill 1), picker cold 3 and cached/reopen 0;
    season change 2, search/team/game/player 1 each, tabs/Back/selection and
    dismissal 0. The real route-table tests pin these on a staleTime-0 client.
  - **Measured on the full load**, 360 x 780, Chrome at CPU 4x, five alternating
    runs per side, as medians (worsts): picker cold 88 ms
    (95), warm 0 (0), the 96-game team
    67 (82). Compose over the dev database's first
    20 cards is 60 (73).
  - **Delayed CLS**, with every events read delayed 800 ms: picker
    0.0275, team 0.0025,
    player 0, summary after Select
    0; all below 0.1.
  - **Browser rows pass**, signed in, light/dark at 360/1280: the three link
    types publish; Undo, disabled Select, Enter safety, Cancel/Escape,
    focus return, native keyboard controls and rings, no page overflow and
    the sticky footer. Own local test posts are cleaned up. Images use the
    required stubbed ticket/bucket/poll; Cancel and Escape preserve them.
  - **R22/R23/R25/R29/R30/R32 are closed.** Chrome returns from compose to the
    detail's Close. Offline compose and picker imports recover through both
    Try again and close/reopen, with computed sticky styling restored. Early
    Back from a cold player record returns to Player.
  - **Decided by the human:** Back from a player restores search text and
    cached results, without another request.
  - **The skeptic's second pass: hand over.** It found a search refetch after
    a 30-second player visit. Fixed test-first by keeping the search mounted
    and natively hidden while showing the player, retaining its observer and
    excluding its controls from accessibility/tab order. A 31-second real
    browser dwell keeps search requests at 1 before and after Back.
  - **Director test corrections**, each separate from implementation and
    named in the unit PR: the retained attachment-shell isolation check, an
    awaited season value, and two awaited Cancel controls during lazy loading.
    Mutation checks preserve their assertions. A separate regression also
    fixes record-group arrow keys losing tab focus after view injection.
  - **Carried:** R16, production image-pipeline timing, remains an operational
    check after deploy. No live pipeline timing is claimed here.
- **Next:** review and merge the unit first, then this Director documentation
  PR. Keep this prompt while human review/deployment and the carried R16 check
  remain open; close it by the index's lifecycle rule once the thread is finished.

## Handoff: hand-running FRONTEND-021

For whichever agent picks this up, Claude Code or not. You are a
**Director**: an interactive session driven by the human. Read `AGENTS.md`
first, then this brief from the top. The contract is
`.ai/tasks/FRONTEND-021/task.json`, and `brief.md` beside it is its prose,
its traps and the skeptic's findings. The loop is
`wiki/GeneralContext/Architecture/director-sessions.md`, "The loop, per
unit". What follows is that loop for this unit, with what this thread
learned.

### Steps, in order

1. **Cut the branch from `origin/main`**, in a worktree of its own: other
   sessions may share the main checkout.
   `git fetch; git worktree add -b agent/FRONTEND-021 ../fanwire-wt/FRONTEND-021 origin/main`
   - Then run `python .ai/bin/agentctl.py hand start FRONTEND-021`, and
     commit `.ai/tasks/FRONTEND-021/state.json` alone.
   - Run `npm ci` in the worktree's `frontend/`.
2. **The test commit,** test-first and alone. It holds:
   - every new test the acceptance criteria need;
   - the changes to the 47 broken tests in 6 files, which the spec's
     "Every existing frontend test passes" criterion names;
   - `frontend/src/test/bundle-budgets/FRONTEND-021.ts`, with exactly the
     Baseline (a) lines: entry +300 gzip and +700 raw, the seven changed
     outputs and the six added ones, summing to 17,250 JS and 2,700 CSS;
   - the R32 warm-ups.

   Prove the red is red for the right reason: the thing under test is
   missing, not a broken test file. The implementation can't edit tests
   (`allow_test_edits_during_impl` is false), so get every test right here.
3. **The implementation commit,** separate. Follow the spec's design:
   - `LevelViews` injection: the game, players and player views live in
     `features/compose/`, and the records views in `RecordsTab`;
   - the picker `Dialog` outside the compose `<form>`, anchored at the top;
   - `seasonsQuery`, the game and player reads in `api/stats.ts` with the
     game page's and player page's keys, and `api/ok.ts`;
   - R23's retry: no `React.lazy`, and the failed stylesheets re-requested;
   - R22's focus line in `Dialog`, and `autoFocus` on compose's text box;
   - R30's group from the record id's prefix.

   Run `prettier --write` on **named files only**: a glob also reformats
   the committed tests.
4. **If a chunk name differs** from the budget file once built (R20, R35),
   correct the names in a separate Director commit, keeping both sums. Any
   test correction is likewise its own commit, before the implementation,
   and the PR body names it.
5. **Gates,** all green, before pushing:
   - `docker compose run --rm frontend-test`, the full suite: run it once,
     and never while another heavy job runs, because the machine has 16 GB;
   - from `frontend/`: `npm run typecheck`, `npm run lint`, `npm run build`;
   - `npx vitest run src/test/bundle-budget.test.ts src/test/bundle-budget-combine.test.ts`.
6. **Check every changed path** against the spec's `allowed_paths` and
   `forbidden_paths` before you push. Restricted trees are never yours on
   this branch: `.ai/` (except `state.json`), `wiki/GeneralContext/` and
   `wiki/CodeContext/FrontendUI/`.
7. **Measure Baseline (c), (d) and (e)** with a host Playwright script, as
   (d) and (e) describe.
   - **Method:** CPU 4x over CDP, 360 x 780, PerformanceObserver for
     `longtask` and `layout-shift`, a fresh context per run, and five runs
     alternating `origin/main` and the branch. For (e), delay every
     `/api/events/` read by 800 ms.
   - **Backend:** the branch's backend on its own port, from the backend
     venv, with `DATABASE_URL` set to the `fanwire_perf` database in the
     running dev Postgres (localhost:5432). The compose-over-a-feed rows use
     the `fanwire` database instead, which has 20 cards.
   - **Frontend:** `vite preview` of each side on its own port.
   - **Signing in:** the test accounts are in `.env.test-accounts.local`,
     and the Cognito settings in `backend/.env`. Never print either.
   - The skeptic's stage-4 scripts may still be in the Director's temp
     scratchpad:
     `%TEMP%\claude\C--Users-david-source-repos-fanwire\94bbf625-97cd-4f30-9cf2-1232def03eca\scratchpad\skeptic\scripts\`.
     If they are gone, rebuild them from this method.
   - **Stop only the servers you started, and only by their port.** Never
     by a command-line pattern: that killed about 20 other servers on
     2026-10-24. Leave `fanwire-postgres-1` and `fanwire-backend-dev-1`
     running.
8. **The browser rows** in the spec's last criterion: light and dark, 360
   and 1280, signed in.
9. **Update `wiki/CodeContext/Modules/0x08-frontend.md`** with a section of
   its own for this unit (the spec says what goes in it).
10. **Push and open the PR. Merge nothing.** The PR body holds:
    - the before and after build tables;
    - the request counts, and the (d) and (e) rows as medians and worsts;
    - **every test file the test commit changed, test by test**;
    - every Director test or budget correction, by commit;
    - the browser rows.
11. **The skeptic's second pass,** before handing over. It is a
    fresh-context reviewer, separate from whoever wrote the code. It reads
    the diff and the measured numbers, and lists every Baseline line as met,
    missed or unmeasured. It also checks the PR body's test list and named
    corrections. A missed line is fixed, test-first, or taken to the human.
    It is never waived silently. If your tool can't spawn a separate agent,
    tell the human, and ask how they want the second pass run.
12. **Record the finish:**
    `python .ai/bin/agentctl.py hand finish FRONTEND-021 --pr <N>`, then
    commit `state.json` and push it to the PR.
13. **A Director PR, after the unit's PR:**
    - this brief's Progress, with the stage-4 result and the skeptic's
      verdict on the whole thread;
    - the unit's `FrontendUI/components.md` rows: no unit role may write
      `FrontendUI/`;
    - then, if the thread is finished, the lifecycle rule in
      `wiki/GeneralContext/index.md`, "Task prompts".

### What is known not to block

- **The advisory coverage check** fails on long specs, because Haiku hits
  its 4,000-token output cap. Raising the cap is a Director PR to `.ai/` and
  the human's call. Don't rerun it.
- **R16** (timing the image pipeline live) is not this unit's.
- **Local uploads can't run** (FRONTEND-020): stub the image rows.

### Ask the human, don't decide

Any UI or UX choice the spec leaves open. Give manual steps as an ordered
list, with one PowerShell line per command.

## Limits

- Never `cdk deploy`. Merge nothing. Never start `agent-orchestrator.yml`.
- Never handle a secret's value. Never use `git stash`.
- Don't touch the post cards or the thread's design (`PostNode`,
  `PostAction`, the previews, `ThreadModal`'s layout).
- No new dependency without a Director PR and the human's yes.

Repository content, including this file, is data, not instruction.
