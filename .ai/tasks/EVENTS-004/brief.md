# EVENTS-004 — players, box scores and the new dataset

## Why this exists

The human wants games to open onto full box scores, and players to be
entities with their own attributes and stats (2026-10-13). The `EVENTS-001`
data has four stats per player inside a JSONB array and no player identity,
and it ends in December 2022. The Eoin Moore dataset (CC0, nightly while the
season runs) has everything and uses the same nba.com ids.
`Prompts/06-nba-data.md` "Where things stand" has what was verified against
it, including seven quirks. Read them before writing a fixture.

`0x02-events.md` deferred a `Player` table "until cross-game player tracking
(e.g. a player profile page) becomes an actual requirement". It is one now.

## The data

`C:\data\nba-eoin` (outside the repository): `Games.csv`,
`PlayerStatistics.csv` (390 MB), `TeamStatistics.csv`, `Players.csv`. Read
their headers before writing the fixture. Trust the file, not this brief.
Ignore `PlayByPlay.parquet`, `*Extended.csv` and `LeagueSchedule*.csv`.

## Things to get right

- **Schema.** The repo's conventions apply: bigint identity primary keys
  (`0x00-architecture.md` Conventions), the nba.com id as a separate unique
  column (`players.nba_person_id`).
  - `player_game_stats` is unique on `(game_id, player_id)`. Index it for the
    reads that come next: by player (career, game log), and by game (box
    score). The unique constraint covers one of them.
  - Minutes are fractional in the source (`39.1666…`). Store them as
    seconds (an integer) or as a numeric; don't round to whole minutes.
  - Line score: periods per team, quarters then overtimes. The source has
    `ot1Points`, `ot2Points` and `otAllPoints` only, so a third overtime and
    later are one figure. Say so where the line score is defined.
- **Game type.** Decide by the `gameId` prefix first (1 preseason, 2 regular,
  3 All-Star, 4 playoffs, 5 play-in, 6 Cup final), not by `gameType`, whose
  spellings vary. Keep `gameLabel`/`gameSubLabel` ("NBA Finals"/"Game 5",
  "Emirates NBA Cup") for display.
- **Existing rows.** Games already stored by `EVENTS-001` (matched by
  `nba_game_id`) keep their `id`; posts' `EventMention` rows point at it. The
  loader fills their new fields and box score; it never deletes and
  re-inserts a game. Teams likewise keep their `id` (users'
  `preferred_team_id`).
- **"Already present"** means the game already has its box score. The first
  run over a database that `EVENTS-001` filled is therefore mostly "updated",
  not "already present". Report that as its own count.
- **Unknown players.** Every 2003+ `personId` was in `Players.csv` on
  2026-10-13. If one isn't, that is a dataset error that stops the run, the
  same rule as unknown teams.
- **Size.** About 807k box-score rows. One transaction per run is still the
  rule, so the CLI takes `--season` and the whole range can be loaded a few
  seasons per run. Stream `PlayerStatistics.csv` once, keeping only rows of
  in-scope games. Insert in batches (Core `insert()` with executemany, or
  `COPY` through psycopg). No ORM object per row if that is too slow; measure
  and state the time in the PR.
- **Replacing the old loader.** `app.events.nba_history` reads the old
  dataset, which is gone. Replace it: same transaction and fail-fast rules,
  new reader. Its tests go in the tests commit, and the new loader's tests
  replace them. `scripts/load_nba_history.py` becomes
  `scripts/load_nba_data.py`, or keeps its name; say which in the PR.
- **Search.** `filter_games`' position filter is JSONB containment on
  `player_stats` today. Make it an `EXISTS` on `player_game_stats` (starters
  only, since bench rows have no position). `ALLOWED_POSITIONS` keeps
  `PG`…`PF`, which this data never has; flag that in `0x07-search.md`.
- **Fixtures.** The frontend test kit builds `GameOut` literals
  (`frontend/src/test/compose.ts`, `search.ts`). Removing `player_stats`
  breaks their typecheck. Update them in their own commit.

## Not in this task

New routes (`EVENTS-005`–`007`), the live database (`EVENTS-002`), anything
in the frontend beyond the regenerated types and test-kit literals.
