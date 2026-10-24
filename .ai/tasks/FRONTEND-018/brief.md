# FRONTEND-018: the stats navigator, and Stats rebuilt on it

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 2 of `wiki/GeneralContext/Prompts/20-stats-navigation-and-compose-modal.md`.
The human finds the stats screens hard to use: Seasons is one long page that
loads the champion, both conferences' standings, three leader boards and a
paged list of every game at once. This unit:
- builds one navigator that the Stats page uses now and the compose stats
  picker reuses later (FRONTEND-021);
- puts Seasons on it: a season level with All / East / West standings tabs,
  and a team level under it.

## Decided by the human (2026-10-24, by `AskUserQuestion`)

- **The season-wide games list is dropped.** A season shows its champion and
  standings, and a team's games open when the team is opened. The navigator's
  path is season → team → game.
- **The leaders stay on Seasons until FRONTEND-019 moves them** to Records >
  Seasonal, in one PR. No deploy is ever without them.

## Decided by the Director

- **All shows both conference tables**, as today, and East and West show one
  each. A single league table would need its own games-behind, which the API
  doesn't send.
- **The Records tab is FRONTEND-019's.** This unit keeps the tabs Seasons and
  Players, so it touches no file under `routes/` but the lazy-routes test.
- **Game rows stay plain links** to the game page. The Stats page isn't a
  modal flow, and changing that is out of scope.
- **Compose's reads are left alone.** FRONTEND-020 runs in parallel and owns
  `features/compose/`. FRONTEND-021 folds `attachmentReads.ts` onto
  `api/stats.ts`.

## The navigator, as a sketch (not a contract)

- `components/stats-nav/StatsNavigator.tsx` renders the breadcrumb, Back and
  the current level's view, from props: the stack of levels, `open(level)`,
  `pop(toDepth)`, and an adapter that renders a game or player link.
- **Levels are data**, for example `{ kind: "season", season, conf }` and
  `{ kind: "team", season, teamId }`. Each kind has a view component in the
  same folder, which reads through `api/stats.ts`.
- **`features/stats/SeasonsTab.tsx` is the route adapter:** it builds the
  stack from `?season=&conf=&team=` and turns `open` and `pop` into
  `setParams`.
- **FRONTEND-021's picker will be a state adapter**, which this unit's test
  proves possible. The picker will also add a selectable mode, a game level
  and a box-score level. Don't build those here (YAGNI). Just don't close the
  door on them: the level kinds are a union that can grow.

## The skeptic

**First pass, 2026-10-24: proceed with changes, all landed in this spec.**
The skeptic built a minimal prototype of this unit and measured it:
- the entry grew by 16 B gzip;
- the Stats JS went from 6,830 B to 7,351 B;
- the Stats CSS went from 1,254 B to 1,793 B.

Its changes:
- the navigator may import `features/games/format`;
- the budget gained a CSS line and its ceilings rose to 7.8 kB JS and
  1.9 kB CSS;
- the lazy pin is a test of this unit's own;
- the request counts gained a cold team load and a `staleTime`;
- the latency line became a median with a worst-run cap.

Before the PR is handed over, it lists every Baseline line as met, missed or
unmeasured.

The risks it carries into this unit (Prompt 20 Progress):
- **R1:** the navigator is lazy.
- **R3 and R15:** the CLS at 360 is 0.14 today and must fall under 0.1. The
  leaders stay, so the champion and the All standings must hold their full
  height while they load.
- **R4 and R14:** the long task, as a median of five alternating runs with a
  250 ms worst-run cap.
- **R12 and R20:** the bundle-budget file below. Rollup's name for a new
  shared stats chunk can't be predicted, so the Director may correct the
  budget file in its own commit before the implementation commit, named in
  the PR.

## Traps

- **The bundle-budget test reads per-unit files.**
  - `src/test/bundle-budget.ts` holds the measured base.
  - This unit adds `src/test/bundle-budgets/FRONTEND-018.ts` in its **test
    commit**. It declares every lazy chunk the unit changes, adds or removes,
    each with a gzip ceiling. It also declares `entryJsGzipGrowth`, at most
    100 here.
  - The file is named after the unit, and its `unit` field says the same.
  - Rollup names chunks after their first module, so moving `api.ts` renames
    or removes chunks such as `links` and `format`. Run `npm run build` on a
    scratch copy of the planned layout before declaring.
  - The test refuses a chunk that two units both declare. FRONTEND-020 runs
    in parallel and declares `ComposePage`, so check the merged preview.
- **The Stats chunks reach the entry if one import goes wrong.** A static
  import of `components/stats-nav/` from anything in the entry graph (the
  shell, the feed, the thread modal) pulls the navigator into the main chunk.
  `components/stats-nav/stats-nav-lazy.test.ts` pins it. Don't edit
  `routes/lazy-routes.test.ts`: FRONTEND-020 owns it in this stage.
- **The request counts need a `staleTime`.** The test clients use
  `staleTime: 0`, so "Back makes 0" fails without one. The season reads
  declare 300,000 ms in `api/stats.ts`. Season data changes once a day at
  most.
- **`TEAMS_KEY` is shared by spelling.** `features/profile` and search write
  `["events", "teams"]` themselves. Moving the constant must not change it,
  or the cache splits and Seasons makes a request that today is free.
- **Removing the Games section removes a test.** `SeasonsTab.test.tsx` pins
  it. That test changes in the test commit, and the PR names it.
- **CLS (R3).** Today's 0.14 comes from sections that appear one under
  another as their reads land. Reserve each level's space while it loads
  (the shared `Skeleton`), and keep the tab bar and breadcrumb a fixed
  height.
- **Focus on a level change.** Move focus to the new level's heading, or a
  keyboard user is left on a control that's gone. Don't move it on the first
  render of a cold load.
- **`prettier --write` on named files only.**

## Not in this task

- The Records tab and the moved leaders (FRONTEND-019).
- The compose picker, its selectable mode, and the game and box-score levels
  (FRONTEND-021).
- Any change to the game page, the player page, the modal flow or the shell.
- Any new dependency.
