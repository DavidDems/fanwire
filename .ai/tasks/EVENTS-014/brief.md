# EVENTS-014: a season's schedule, played and upcoming games

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-06)

The site shows only played games. The human wants a **Schedule** page in the
frontend that shows a season's upcoming games next to its played ones, with
short recaps of the played games. This unit is **the backend only**: load the
schedule and serve a season's full schedule. The frontend spec (how upcoming
games are displayed, and the recaps) is written after this merges, and may
ask for more fields then.

The human's constraints:

- **Existing routes do not change.** In particular, a game appears in a
  team's season (`GET /events/teams/{id}/seasons/{season}`) only once it has
  been played.
- **Schedules are visible only from the Schedule page**, so only the new
  route returns unplayed games.

## The data (checked 2026-11-06 against `C:\data\nba-refresh`)

The Kaggle dataset now ships `LeagueSchedule24_25.csv`,
`LeagueSchedule25_26.csv` and `LeagueSchedule26_27.csv`.

- **2026-27:** 1,274 rows, 2026-10-03 to 2027-04-11. 67 preseason
  (prefix `1`), 1,206 regular (prefix `2`) and the Cup final (prefix `6`).
  188 were already played and are in `Games.csv` with the same id, home team
  and start time; 1,086 were still to come. No playoffs yet.
- **Undecided teams.** The Cup quarterfinals (4), semifinals (2) and final
  have `homeTeamId`/`awayTeamId` `0` and, except the final, a start time of
  `00:00:00`. The 24 regular-season games the NBA assigns after the Cup
  knockout round are not in the file yet (1,206, not 1,230). They should
  show up in a later file and be added by the next load.
- **2025-26:** same header as 2026-27. Every row with a prefix of `2`, `4`, `5`
  or `6` is in `Games.csv`. One played game, `42500405` (Finals Game 5), is
  missing from the schedule file. This is why the route takes the union and
  does not only list schedule rows.
- **2024-25 is a different shape:** `hometeamId`/`awayteamId` spelled
  otherwise, no team names, extra `gameSequence`/`seriesText` columns,
  timestamps with `+00:00` and `Z` suffixes, and four January 2025 games
  (the LA fires postponements, `22400532`, `22400537`, `22400538`,
  `22400617`) that are not in `Games.csv`. It is **not supported**: its
  season is fully played and the union with `games` already gives its
  schedule. Reading it is a `DatasetError`, so the runbook says to upload
  only the current season's file.

## Decided (Director, 2026-11-06)

- **A table of its own, not unplayed rows in `games`.** `games` has
  non-null scores and is read by standings, team seasons, leaders, records
  and their aggregate tables, the recent-games list (`EVENTS-013`), search,
  and posts' attachments. Putting unplayed rows there would mean auditing
  every one of those reads against `Game.completed`. A separate
  `scheduled_games` table makes "existing routes unchanged" true by
  construction. The test that compares responses before and after a load
  pins it anyway.
- **Played wins.** For a game in both tables, the response uses the
  `games` row, which records what happened.
- **Replace the season's schedule on each load.** Nothing references
  `scheduled_games`, so replacing a season's rows inside the load's
  transaction is the simplest correct refresh. It drops postponed and
  cancelled rows and fills in Cup knockout teams once they are known.
  Unlike `games`, a changed row is not a `DatasetError`: schedules change
  and results do not.
- **Preseason and All-Star are skipped**, as they are for `games`.
- **`time_tbd`** comes from the source's midnight start time. No NBA game
  starts at 00:00 Eastern.
- **One route, whole season, optional filters.** A full season is about
  1,300 items, well under a Lambda response's 6 MB. Measure it and record the
  number. The future page can narrow it by team or date range. No pagination
  (YAGNI) unless the measurement says otherwise.
- **No "postponed" status.** The source has none. A scheduled game whose
  date has passed stays `scheduled` until a load either brings its result
  or drops the row. Whether the page flags that is a frontend decision.
- **No recap fields yet.** The future frontend spec decides what a recap
  needs (top scorer, line score?), and a later unit adds it. `game_id`
  already lets the page link to the full game.

## Things to get right

- **Reuse the loader's rules.** Use the id-prefix → `game_type` rule, the
  season-from-id rule, the team map and `UnrecognizedTeamError`, and the
  date parser in `nba_history.py`. Don't write second copies.
  `nba_history.py` is already 1,000+ lines, so a sibling module
  (`app/events/schedule.py` or similar) called from `load_nba_history` is
  welcome.
- **The CLI gets it for free.** `scripts/load_nba_history.py` passes a
  directory, so a schedule file in it is read with no CLI change.
- **Existing loader tests.** Adding the schedule fixture to
  `tests/fixtures/nba_data/` changes what a full fixture load writes. Any
  test that pins exact report lines or table counts is fixed in the
  **tests** commit, not the implementation commit.
- **The migration tests pin revisions** (`tests/test_migrations*.py`,
  Prompts/06 "Mechanics"): update them in the tests commit once the new
  revision is head.
- **Measure** on a throwaway Postgres (`docker run` on port 5433), never
  the compose one, with the real `C:\data\nba-refresh` loaded for 2025-26
  and 2026-27. Record the schedule load's added time, the full-season
  response's size and time, and one filtered read.
- **The deploy adds a migration.** Say so in the PR body: the human invokes
  the `Migration` Lambda right after the deploy, then re-runs "Load sports
  data" for `2026-27` with the schedule file uploaded.

## After it merges (Director, not this unit)

- `build-deployment.md` "Load sports data", step 2, also uploads
  `LeagueSchedule26_27.csv`. Only a Director PR may write `Standards/`.
- The frontend spec for the Schedule page.

## Not in this task

Any frontend, recap data, a scheduled refresh (`EVENTS-008`), seasons before
the 2025-26 header shape, and preseason games.
