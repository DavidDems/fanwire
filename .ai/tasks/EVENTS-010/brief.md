# EVENTS-010: the records API

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 1 of `wiki/GeneralContext/Prompts/20-stats-navigation-and-compose-modal.md`.
Stats gets a Records tab (FRONTEND-019):
- **Historical:** cards of team and player records, each showing its holder,
  each opening its full ranked list.
- **Seasonal:** the per-season leaders that `GET /events/seasons/{season}/leaders`
  already serves, so they need no backend.

This unit serves Historical.

## Decided by the human (2026-10-23, by `AskUserQuestion`)

- **Live, measured, precompute only if slow.** Each record is computed at
  read time, as standings and leaders are (0x02's "no aggregate table until
  a measured query is too slow"). A record that misses its ceiling, even with
  an index, is reported. It isn't hidden behind a cache or a stored table,
  because that is its own later unit.
- **The record list is the Director's pick** (the human: "you can pick a
  list"). It's in criterion 1, chosen because the stored data can answer
  each one honestly.

## The skeptic

A separate agent is deployed against this thread's complexity and latency
(the Director's thread brief, "The skeptic").
- **Before this branch is cut**, it reviews the provisional **Baseline**
  (criterion 9): the ceilings, the query counts, and the scale they're
  measured at. It tightens them or argues them down with numbers, and any
  change lands as a spec amendment first.
- **Before the PR is handed over**, it reads the measurements and the query
  plans (`EXPLAIN ANALYZE` for each record), and lists each line as met,
  missed or unmeasured.

This is the unit where the skeptic matters most:
- **The data:** `player_game_stats` has about 800,000 rows, and production
  runs on a `db.t4g.micro`.
- **The heavy reads:** a career sum or a triple-double count reads the whole
  table.
- **The cheap reads:** a single-game maximum is an index's first row, but
  only with the right index.

## Design notes

- **Where the code goes:** one module, `app/events/records.py`, holds the
  registry: each record's id, title, unit, rule text, and its query builder.
  The two routes go in `routes.py`. A query builder per record is a Strategy,
  as `gof-patterns.md` uses the word: check its Strategy line before choosing
  a different pattern.
- **Reuse the champion rule:** the Finals rule must be the same helper
  `champion` uses, not a copy. Player championships join the champion's
  Finals games to the played lines of that team.
- **Ties:** "first by the list's order", plus a `tied_count`, keeps the card
  honest without a list of co-holders.
- **Measuring:** the dev database is empty and the CSVs aren't on this
  machine. At the start, the Director asks the human whether the CSVs come
  back (`Prompts/06`, `load_nba_history.py`) or the synthetic generator is
  built. The generator is in scope either way, because a repeatable scale
  fixture is worth having.
  - **The real load:** measure the medians on it.
  - **Synthetic data:** state that it is synthetic, and say which
    distributions could make the real data slower.

## Traps

- **Season records and a season in progress:** a 10-0 start would top "best
  record" unless only seasons with a champion count. The fixture needs a
  championless season that must be excluded.
- **Triple-doubles count steals and blocks too.** "Ten or more in at least
  three of five" is a sum of five `CASE` expressions in SQL, not a Python
  loop.
- **Competition ranking** is `RANK()`, not `DENSE_RANK()` or `ROW_NUMBER()`.
- **`openapi-drift`:** regenerate `openapi.json` and `schema.d.ts` in the
  same commit as the routes.
- **The container suite** (`docker compose run --rm backend-test`) is the
  authoritative one. Don't run it while another agent is running tests
  (16 GB machine).

## Not in this task

Any frontend; seasonal leaders (they already exist); a cache, a stored
records table or a materialized view; records before 2003-04 (not in the
data).
