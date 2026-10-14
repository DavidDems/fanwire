# 0x02 — Events

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized. Covers the `events/` module: `Team`, `Game`, `Player` and `PlayerGameStats` (the box score). The `Team`-before-`Game` seeding order is already documented in [[0x00-architecture]] — not repeated here. **One source since `EVENTS-003` (2026-10-13):** NBA data comes from a Kaggle dataset loaded into Postgres; the API-SPORTS path (adapter, ingestion pipeline and Lambda, live-score proxy) is retired, and nba.com ids are the only sports-data keys. **Since `EVENTS-004` that dataset is Eoin Moore's** "NBA Dataset: Box Scores and Stats" (CC0), 2003-04 onward, and players and box scores are tables of their own.

Business rules driving this module (full detail in [[wiki/GeneralContext/Architecture/business-rules|Projects]] "Events"): import an existing NBA game-results database (only NBA, only this source, for now), serve it via an API, provide a stats section (champions, team records during the regular season, stats leaders), and posts with a game link must click through to that game's stats page ([[0x03-posts]]'s `EventMention` references `Game` for this).

## `Team`

### Schema
NBA team reference data. One row per team, effectively static.

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key |
| `nba_team_id` | bigint, unique, not null | nba.com team id (`1610612737`…), set by the NBA dataset loader. The only source key since `EVENTS-003`, which dropped `api_sports_team_id` and the `ck_teams_has_source_id` CHECK |
| `name` | text, not null | e.g. "Boston Celtics" |
| `abbreviation` | text, not null | e.g. "BOS" |
| `conference` | text, not null | Eastern / Western |
| `division` | text, not null | |
| `logo_url` | text, nullable | |

No FKs out of `Team`. `Game` and `PlayerGameStats` FK into it (below).

The dataset's files carry no abbreviation, conference or division, so the loader holds the 30 current franchises as league reference data (`app.events.nba_history._TEAMS`, today's names) and creates every one of them on a run. Every 2003-04+ game is between two of them; a team outside them is `UnrecognizedTeamError`. A team already stored (matched by `nba_team_id`) is left as it is and keeps its `id`: users' `preferred_team_id` points at it.

### Design principles tie-in
- **Fail fast** — `Team` rows are seeded up front, not created on demand. A dataset game or box-score row referencing a team not already in this table is a boundary error that stops the load (`app.events.errors.UnrecognizedTeamError`), per [[wiki/CodeContext/Standards/design-principles|Design principles]] "Fail fast" and "Validate at boundaries only" — an unrecognized team is invalid external input, not a case to silently paper over with an auto-created row.
- **Single source of truth** — `Team` is the one place team identity/metadata lives; `Game` and any future module reference it by FK, never copy team name/abbreviation inline.

### GoF pattern tie-in
- None today. The dataset loader (`app.events.nba_history`) is plain functions over CSV rows; the Abstract Factory / Adapter pair that once sat here for API-SPORTS was removed with that path (`EVENTS-003`).

### AWS mapping
RDS Postgres table, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] and [[0x00-architecture]]'s "every table in this wiki lives in RDS" rule. No DynamoDB involvement.

### Security
Not PII, not user-generated. No entity-specific requirement: the data is public reference data, and no vendor key is involved since the API-SPORTS path was retired.

### Open decisions
None flagged — this table is small and stable enough that the shape above is treated as settled, not provisional.

## `Game`

### Schema
An imported NBA game result. Its box score is `PlayerGameStats` (below).

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key; posts' `EventMention.game_id` points at it, so a loader never deletes and re-inserts a game |
| `nba_game_id` | bigint, unique, not null | nba.com game id as an int (`22200477`), the loader's dedupe key. The only source key since `EVENTS-003`, which dropped `api_sports_game_id` and the `ck_games_has_source_id` CHECK |
| `home_team_id` | FK → `Team.id`, not null | |
| `away_team_id` | FK → `Team.id`, not null | |
| `date` | timestamp, not null | the dataset's US Eastern start time, naive (`EVENTS-001` rows had midnight; the new loader sets the time) |
| `season` | text, not null | e.g. "2025-26" — needed for the stats section's season scoping |
| `home_score` | integer, not null | final score |
| `away_score` | integer, not null | final score |
| `venue` | text, nullable | the dataset's arena name; blank for most games before 2025-26 |
| `game_type` | text, nullable | `regular` / `cup-final` / `play-in` / `playoffs`, from the game id's first digit (below) |
| `label` | text, nullable | the dataset's display label as written: "NBA Finals", "East - First Round", "Emirates NBA Cup", "SoFi Play-In Tournament" |
| `sub_label` | text, nullable | "Game 5", "East Group B", "Championship" |
| `series_game_number` | integer, nullable | a playoff series' game number; null outside a series (the source's `0`) |
| `home_line_score`, `away_line_score` | integer[], nullable | points per period: four quarters, then overtimes. **The source has only `ot1Points`, `ot2Points` and `otAllPoints`, so a third overtime and any later are one figure** (`otAll − ot1 − ot2`). Null when the source has no quarter points: 1,322 of 2021-22's 1,323 games and one 2023-24 game. 2021-22's overtime columns are blank too |

`game_type` rule (decided by the id prefix, not by the source's `gameType` text, whose spellings vary): `2` regular season (**NBA Cup group and knockout games included**, their label kept), `6` the NBA Cup final (`cup-final`, counted in no standings), `5` play-in, `4` playoffs. `1` preseason and `3` All-Star are not loaded.

### Design principles tie-in
- **"Team records during the regular season" and "stats leaders"** (per [[wiki/GeneralContext/Architecture/business-rules|Projects]]) are computed at read time with `GROUP BY` over `PlayerGameStats` joined to `Game`. No aggregate table (YAGNI): a career is at most ~1,600 rows. Add one only if a measured query is too slow on `db.t4g.micro`.
- **Single source of truth** — the dataset's box score is the only source of player data, stored once in `PlayerGameStats`. Team totals and percentages are computed from its rows, never stored.
- **Fail fast** — same rule as `Team`: an import referencing an unknown team or player aborts rather than auto-creating a row.

### GoF pattern tie-in
- None today. The Abstract Factory, Adapter, Template Method (ingestion pipeline) and Proxy (live-score cache) that [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] still assigns to this module were removed with the API-SPORTS path (`EVENTS-003`); that Standards file is updated by a Director PR.

### AWS mapping
RDS Postgres table (system of record), per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]. No DynamoDB involvement since `EVENTS-003`. The idempotency and live-score cache tables, the API-SPORTS secret and the ingestion-retry queue still exist in `Fanwire-Data`/`Fanwire-Messaging` with no consumer, their CloudFormation exports kept alive with `exportValue` so the deploy that drops `Fanwire-App`'s imports doesn't fail; a later infra unit deletes them.

### Security
Not PII, not user-generated content. No per-row access control is needed: games, players and box scores are public read data served by the events API.

## `Player`

### Schema
An NBA player, keyed by nba.com's person id. Attributes are what the dataset's `Players.csv` gives; **an attribute the file leaves blank is null, never invented** (about 80 % of players carry birth date, height, weight, draft and school).

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key |
| `nba_person_id` | bigint, unique, not null | nba.com `personId` |
| `first_name`, `last_name` | text, nullable | both can be blank in the source (mononyms) |
| `birth_date` | date, nullable | |
| `height_inches`, `weight_lbs` | integer, nullable | |
| `country`, `school`, `jersey` | text, nullable | jersey as written (`"23"`, `"11-12"`) |
| `position` | text, nullable | from the `guard`/`forward`/`center` flags, in that order: `G`, `F`, `C`, `G-F`, `F-C`; null when no flag is set |
| `draft_year`, `draft_round`, `draft_number` | integer, nullable | the source's negative "none" markers (`-1` for undrafted) are null |
| `first_season`, `last_season` | text, nullable | `"YYYY-YY"`, from `fromYear`/`toYear` (season start years) |

Only players a loaded box score names are stored. One already stored (matched by `nba_person_id`) is left as it is: a refresh of a player's attributes (e.g. `last_season`) is not done by the loader today.

## `PlayerGameStats`

### Schema
One player's line in one game's box score (`player_game_stats`). Unique on `(game_id, player_id)`, whose index serves box-score reads by game; `ix_player_game_stats_player_id` serves career and game-log reads by player.

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key |
| `game_id` | FK → `Game.id`, not null | |
| `player_id` | FK → `Player.id`, not null | |
| `team_id` | FK → `Team.id`, not null | the player's team in that game. The source leaves it blank on ~10 % of rows (36k in 2021-22); the loader takes it from the row's home flag, which never disagrees |
| `starter` | boolean, not null | the row has a starting position |
| `starting_position` | text, nullable | `G`, `F` or `C` for a starter (the source never has `PG`…`PF`); null for the bench |
| `seconds_played` | integer, nullable | **null = did not play**; `PlayerGameStats.played` (a hybrid property, usable in queries) is `seconds_played IS NOT NULL` |
| `field_goals_made`/`_attempted`, `three_pointers_made`/`_attempted`, `free_throws_made`/`_attempted` | integer, not null | |
| `offensive_rebounds`, `defensive_rebounds`, `rebounds` | integer, not null | |
| `assists`, `steals`, `blocks`, `turnovers`, `personal_fouls`, `points`, `plus_minus` | integer, not null | percentages are not stored: computed from made/attempted |
| `dnp_reason` | text, nullable | the source's comment on a row without minutes (`"DNP - Coach's Decision"`, `"DND - Injury/Illness"`); null when it gives none |

A DNP row is stored (its stats are the source's zeros) so a box score can list who did not play and why. It is not counted as having played.

**Minutes.** The source's `numMinutes` is not one format: whole minutes (`"39.0"`, truncated) through 2023-24, **minutes.seconds** (`"27.04"` = 27:04; `"30.6"` = 30:60, seconds rounded up without carrying) in most of 2024-25 and 2025-26, and true decimals (`"39.1666…"`) in the rest of 2025-26. The loader stores seconds and decides per team per game: minutes.seconds when, read that way, the rows add up to the team's minutes in `TeamStatistics.csv` (240 plus 25 per overtime, within a minute) and read as decimals they don't; otherwise decimals, and a team-game that fits neither is reported (none in the 2026-06-15 data). A team's minutes before 2024-25 sum to about 235–238, not 240: truncation in the source.

## The loader — `app.events.nba_history` (`EVENTS-004`)

`load_nba_history(session, data_dir, seasons=None) -> LoadReport` reads `Games.csv`, `PlayerStatistics.csv` (not `…Extended`, which has fewer rows), `TeamStatistics.csv` and `Players.csv` from a directory outside the repo (the human's copy: `C:\data\nba-eoin`, version of 2026-06-15). CLI: `python scripts/load_nba_history.py --data-dir <dir> [--season 2025-26 ...]` with `DATABASE_URL` set (the script kept its name; `seed_dev.py` points at it). Never pointed at the live RDS (that is `EVENTS-002`). Tests use a synthetic fixture with the dataset's exact headers under `backend/tests/fixtures/nba_data/`.

- **Scope:** 2003-04 onward (every team is one of today's 30). `--season` before 2003-04 is a `DatasetError`.
- **One transaction per run**: every file is read and validated before the first write; any failure rolls back everything, teams and players included.
- **Fail fast:** an unknown team in a stored game or its box score is `UnrecognizedTeamError`; a box-score player absent from `Players.csv` is `UnrecognizedPlayerError` (`app.events.errors`). A box-score team that contradicts its home flag, a malformed value, a missing file or column, and duplicate game rows that disagree are `DatasetError`. Ids in skipped games (All-Star teams) are never checked.
- **Skipped and counted:** preseason, All-Star, and a game without a final score. **A 0–0 game counts as without a score** (the human's decision, 2026-10-13): 22400627 and 22400988 are written 0–0, have no box score, and their winner column contradicts their quarter points. Both are named in the report.
- **Reported, not corrected:** a stored game without box-score rows (stored with an empty box score); a team whose players' points differ from its score (19 team-games, mostly 2003-05, 1–3 points); a team-game whose minutes fit neither format. Named only for games the run writes.
- **Ignored:** a `TeamStatistics.csv` line with `teamId` 0 (two 2025-26 games carry one beside their two real lines, every field blank).
- **Duplicates:** a repeated game or `(game, player)` row keeps the first and is counted (none in the current data).
- **Existing rows keep their ids.** A game stored before (by `EVENTS-001`) whose teams and score agree is **updated**: its new fields set and its box score added. A game that already has its box score and the same fields is **already present**. A stored game whose teams or score disagree is a `DatasetError`: a corrected result is never applied silently. A second run over the same data writes nothing and reports nothing new.
- **Report per season:** games loaded / updated / already present; skipped preseason / All-Star / no score; box-score rows loaded / already present / skipped; duplicates; and the named games above.
- **Measured** (local Docker Postgres, Windows host, 2026-10-13): the whole 2003-04 to 2025-26 range in **one run in 133 s** (29,646 games, 745,466 box-score rows, 2,426 players); one season in about 28 s, almost all of it reading `PlayerStatistics.csv` (390 MB) once; a second full run in 36 s, writing nothing. Box-score rows go in with `COPY` on the session's connection: an ORM/executemany insert sent one statement per row and took 7 minutes for one season.

## The load function — `app.events.load_handler` (`EVENTS-002`)

The loader above, run against the live database as the `SportsDataLoad` Lambda: the shared image with command `app.events.load_handler.handler`, 15 min, 2048 MB, 1024 MB of `/tmp`. **Nothing invokes it.** The human uploads the four CSVs to `SportsDataBucket` (`Fanwire-Storage`, private, CMK, SSL only, no events) under `nba-eoin/`, and invokes it by hand. The step-by-step runbook is `build-deployment.md` "Load sports data", added by a Director PR because no unit role may write `Standards/`. Its one grant beyond what every function has is `s3:GetObject` on `nba-eoin/*`.

- **Event:** `{"seasons": ["2025-26", ...]}`, exactly that key, a non-empty list of distinct seasons, checked by `nba_history.validate_seasons`. **Required** (the human, 2026-10-14): a full reload lists every season. A bad event raises `InvalidLoadEvent` before any S3 call or connection.
- **Order:** event → settings (`SPORTS_DATA_BUCKET`, `DATABASE_URL`; unset fails fast) → advisory lock `LOAD_LOCK_KEY` (not `app.migrate`'s) → download `Games.csv`, `PlayerStatistics.csv`, `TeamStatistics.csv`, `Players.csv` to a new temporary directory → `load_nba_history` (one transaction) → remove the directory, success or not → return `teams_created`, `players_created`, `seasons` (each `SeasonReport` as data) and `lines`, the per-season lines also logged.
- **The lock** exists because the AWS CLI retries an invoke when its read timeout fires (60 s by default): without it the retry is a second load running beside the first. With it, the second fails fast (`SportsDataLoadLocked`, "already running") and writes nothing.
- **Failures raise** `SportsDataLoadFailed`, never return an error value, with the message passed through `app.migrate.redact` and the cause chain broken (`from None`), so `DATABASE_URL` never reaches CloudWatch. A missing object names its key.
- **Sizing** (2026-10-14, local Postgres): one season 18 s at a 99 MB peak; all 23 seasons 73–139 s at 709 MB. The four files are ~440 MB, over the default 512 MB of `/tmp`.

## API routes (Phase 2a)
"Create an API to serve the data of these game from the database to the website" (`wiki/GeneralContext/Architecture/business-rules.md` "Events") was unimplemented through Phase 1 — Phase 2a (`wiki/GeneralContext/Prompts/phase-2-manager-agent.md`) closed it. Routes live in `app.events.routes` (`APIRouter(prefix="/events")`), public, no auth (sports data is public read, matching the guest-feed requirement):
- `GET /events/teams`, `GET /events/teams/{team_id}`
- `GET /events/games` — **paged (`EVENTS-005`)**: `limit` (default 50, 1–200) and `offset`, ordered `date desc, id desc` (several games share an evening; without the id tie-break, pages could repeat or drop one). Optional filters, ANDed: `season` (`YYYY-YY`), `team_id` (home or away), `game_type` (`regular`, `cup-final`, `play-in`, `playoffs`), `date_from`/`date_to` (inclusive calendar days of the stored naive US-Eastern `date`: `date_to` compares against the start of the next day). A malformed value, an unknown `game_type`, or `date_from` after `date_to` is a 422, never an empty list. The response is still a list of `GameOut`, so the compose `#` picker keeps working on the 50 newest games; a narrower picker is the frontend pass's. Why paged: a full load is 29,646 games, over a Lambda response's 6 MB as one list.
- `GET /events/games/{game_id}` — a **`GameDetailOut` (`EVENTS-005`)**, the game page and the read side `posts/`'s `EventMention.game_id` links to. A read model built by `app.events.service.game_detail` (plain dataclasses), not the ORM row, in **two queries whatever the box score's size**: the game joined to both teams, then the game's `PlayerGameStats` rows joined to `Player`, grouped by team in Python. It carries the game's fields (label, sub-label, series game number, venue, both scores), `home_team`/`away_team` (id, name, abbreviation), `home_line_score`/`away_line_score` **as stored** (the figure after the second overtime stays "third overtime and later", not split or padded), and `home_box_score`/`away_box_score`:
  - `players`: rows with minutes (`seconds_played` not null, zero included), starters first, then by seconds played (most first), then player id; each with player id and names, starter and starting position, seconds, every counting stat, plus-minus and the three shooting percentages.
  - `did_not_play`: rows without minutes, by player id, with player id, names and `dnp_reason` (may be null).
  - `totals`: sums of the played rows only (seconds and counting stats; no plus-minus), percentages computed from the sums. **Never adjusted to the final score**: the 19 team-games where players' points differ from the score show both numbers as they are.
  - Percentages are **computed, never stored**: made ÷ attempted, a fraction from 0 to 1 rounded to three places (`0.462`, as nba.com shows them), null when nothing was attempted.
  - A game without box-score rows answers 200 with empty lists, zero totals and null percentages.
- **No index for the list (measured, 2026-10-14):** on a full 2003-04 to 2025-26 load (local Docker Postgres), the newest page is a sequential scan plus a top-N sort in 15 ms, `offset` 29,000 in 25 ms, a team-and-season page in 2 ms; the box-score query uses the `(game_id, player_id)` constraint's index in under 1 ms. Over HTTP: 50 games are 10 KB, 200 are 40 KB, a Finals detail is 12.5 KB. Revisit on `db.t4g.micro` only if a measured page is slow.

No pagination on `GET /events/teams` (YAGNI — `Team` is a small, static ~30-row table).

## Resolved decisions
- **Season format — settled as text, `"YYYY-YY"`** (e.g. `"2025-26"`). Implemented in `app.events.models.Game.season` (`Text`, not null); the loader derives it from digits 2–3 of the game id.
- **`Player` and `PlayerGameStats` replace `Game.player_stats` (`EVENTS-004`, 2026-10-13).** The JSONB box score (four stats per player, no player identity) and its GIN index `ix_games_player_stats_gin` are dropped by migration `d9f3b6a1e2c4`, which also adds the two tables and the game columns above; existing teams and games keep their rows and ids. Its downgrade restores `player_stats` as `[]` on every row. The trigger this file named for a `Player` table — cross-game player tracking, a player page — is now a requirement (`EVENTS-006`).
- **API-SPORTS retired (`EVENTS-003`, 2026-10-13).** Removed: `adapters.py` (`ApiSportsAdapter`), `factory.py`, `interfaces.py`, the ingestion pipeline, `proxy.py` (`CachedEventProxy` and its caches), `lambda_handler.py` (the `Ingestion` function), `events/dependencies.py` (`get_live_score_proxy`, key resolution), the `api_sports_*`/`idempotency_table_name`/`live_score_cache_table_name` settings and the `api_sports_*` columns. Migration `c5e8a2d4f9b1` makes the nba ids NOT NULL; it **refuses to run, changing nothing, while any team or game row lacks an nba.com id**, naming the table and count (e.g. a dev database still holding the old `seed_dev.py` fixtures). `UnrecognizedTeamError` lives in `app.events.errors`; the `app.events.ingestion` re-export went with `EVENTS-004`. `scripts/seed_dev.py` seeds no teams or games; it prints how to load them.
- **The first dataset (`EVENTS-001`, superseded).** Nathan Lauga's "NBA games" (`teams.csv`, `games.csv`, `games_details.csv`, to December 2022) was loaded by the first version of `app.events.nba_history`; the human has since deleted it. Its 3,637 loaded games match the new dataset on game id, teams and both scores. Its decisions carry over: nba.com ids get their own columns, `game_type` is stored, play-in games are loaded, duplicate rows keep the first and are counted, one transaction per run.
- **`feed/`'s read interface — implemented (Phase 3, feed/ unit).** `app.events.service.game_ids_for_team(session, team_id) -> list[int]` (the team-scoped feed) — see [[0x06-feed]]. `games_by_ids(session, ids) -> dict[int, GameRef]` remains, `GameRef` now just `id`, but has no caller in app code since `EVENTS-003` removed the live-score lookup it served.
- **`search/`'s sports-data filter — implemented (Phase 3, search/ unit; position moved by `EVENTS-004`).** `app.events.service.filter_games(session, *, season, team_id, position, limit, offset) -> list[Game]` (plain `WHERE`-clause filtering, all filters optional and AND'd, `team_id` matches home or away) and `distinct_seasons(session) -> list[str]` (for the year dropdown). `position` is an `EXISTS` on `PlayerGameStats`: a game matches when any player in its box score **started** at that position (bench rows have none). `ALLOWED_POSITIONS` (`PG, SG, SF, PF, C, G, F`) is the allow-list `GET /search/games`' `position` query param is validated against; the data's starters only ever have `G`/`F`/`C`, so `PG`…`PF` match nothing. See [[0x07-search]].
