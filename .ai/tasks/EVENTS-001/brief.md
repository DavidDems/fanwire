# EVENTS-001 — historical NBA games from the Kaggle dataset

## Why this exists

`business-rules.md` "Events" asks for **"an existing database of NBA game
results"**. Everything since was built around API-SPORTS: the `Team`/`Game`
schema is keyed on `api_sports_team_id`/`api_sports_game_id` (unique, not
null), an hourly ingestion Lambda calls an adapter that has never seen a real
response (`backend/app/events/adapters.py`'s docstring), and the key in
Secrets Manager is a placeholder. So the live site has no games, and the
local dev stack has only `scripts/seed_dev.py`'s handful of fixture rows.

On 2026-10-13 the human chose the source: the **Kaggle "NBA games" dataset**
(Nathan Lauga, `kaggle.com/datasets/nathanlauga/nba-games`): `teams.csv`,
`games.csv` and `games_details.csv` (one row per player per game), from the
2003-04 season onward. It has no rate limit and needs no key, and its
per-player rows fit `Game.player_stats` as `0x02-events.md` documents it.
First pass is **historical only**. Nothing live.

## What "done" looks like

`python scripts/load_nba_history.py --data-dir <dir> [--season 2021-22 ...]`
run in `backend-dev` (or locally, with `DATABASE_URL` set) fills `Team` and
`Game`. The search page's game filter, the feed's game blocks and `#GameId`
mentions then work against real games in the browser.

## Things to get right

- **Verify the dataset's real columns first.** The human downloads it (see
  the prompt). Read the CSV headers before you write a fixture. What this
  brief remembers is: `games.csv`: `GAME_DATE_EST`, `GAME_ID`,
  `HOME_TEAM_ID`, `VISITOR_TEAM_ID`, `SEASON`, `PTS_home`, `PTS_away`;
  `games_details.csv`: `GAME_ID`, `TEAM_ID`, `PLAYER_NAME`,
  `START_POSITION`, `PTS`, `REB`, `AST`, …; `teams.csv`: `TEAM_ID`,
  `ABBREVIATION`, `NICKNAME`, `CITY`. Trust the file, not this list.
- **Ids: a design decision, bring it to the human.** The dataset's ids are
  nba.com's, not API-SPORTS'. Recommended: add a unique, nullable `nba_*_id`
  to each table, make `api_sports_*_id` nullable, and require at least one
  (a check constraint). Don't store nba.com ids in the `api_sports_*`
  columns: a real API-SPORTS import later would collide with them. Whatever is
  chosen changes the response schemas, so regenerate `backend/openapi.json`
  and `frontend/src/api/schema.d.ts` (`openapi-drift` in CI fails otherwise).
- **Game type.** nba.com's `GAME_ID` prefix encodes it (`1` preseason, `2`
  regular season, `3` All-Star, `4` playoffs, `5` play-in). Confirm that
  against the data. Whether to *store* regular season vs playoffs (the stats
  section's "team records during the regular season" will need it) is a
  question for the human, not something to add silently.
- **Teams.** `teams.csv` has no conference or division, and `Team` needs
  both. A fixed 30-team mapping in the loader is fine: league reference data,
  not invented data.
- **Positions.** `START_POSITION` is blank for bench players and holds
  `F`/`C`/`G` for starters, while `search/`'s `ALLOWED_POSITIONS` also
  allows `PG`…`PF`. Store what the data says; don't invent a position.
- **Scope.** One transaction per season is a reasonable unit for "leaves the
  database as it was" on a failure. The loader writes only `Team` and `Game`,
  through `app.events.models`. No raw SQL beyond what the migration needs.
- **Not in this task:** loading the live RDS (that is `EVENTS-002`, which
  needs an infra design), a stats page, pagination of `/events/games`, and
  removing `seed_dev.py` (update it only if the schema change breaks it).

## Known constraints

- The dataset lives **outside the repository** (`.gitignore` is a path no
  task may write, so the dataset can't be ignored from here). Tests use a
  synthetic fixture under `backend/tests/`.
- The dataset's licence is the human's to check (Kaggle page). Nothing from
  it is committed.
