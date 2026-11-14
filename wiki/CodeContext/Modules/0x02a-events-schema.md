---
type: reference
---

# 0x02a — Events: schema

**Agent-facing.** Part of [[0x02-events]] (index, the attachment interface and resolved decisions).

## `Team`

### Schema
NBA team reference data. One row per team, effectively static.

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key |
| `nba_team_id` | bigint, unique, not null | nba.com team id (`1610612737`…), set by the NBA dataset loader. The only source key |
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
- None. The dataset loader (`app.events.nba_history`) is plain functions over CSV rows.

### AWS mapping
RDS Postgres table, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] and [[0x00-architecture]]'s "every table in this wiki lives in RDS" rule. No DynamoDB involvement.

### Security
Not PII, not user-generated. No entity-specific requirement: the data is public reference data, and no vendor key is involved.

### Open decisions
None flagged — this table is small and stable enough that the shape above is treated as settled, not provisional.

## `Game`

### Schema
An imported NBA game result. Its box score is `PlayerGameStats` (below).

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key; posts' `EventMention.game_id` points at it, so a loader never deletes and re-inserts a game |
| `nba_game_id` | bigint, unique, not null | nba.com game id as an int (`22200477`), the loader's dedupe key. The only source key |
| `home_team_id` | FK → `Team.id`, not null | |
| `away_team_id` | FK → `Team.id`, not null | |
| `date` | timestamp, not null | the dataset's US Eastern start time, naive |
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
- **"Team records during the regular season" and "stats leaders"** (per [[wiki/GeneralContext/Architecture/business-rules|Projects]]) are computed at read time with `GROUP BY` over `PlayerGameStats` joined to `Game`. No aggregate table (YAGNI): a career is at most ~1,600 rows. Add one only if a measured query is too slow on `db.t4g.micro`, as the records library did ([[0x02d-events-records]]).
- **Single source of truth** — the dataset's box score is the only source of player data, stored once in `PlayerGameStats`. Team totals and percentages are computed from its rows, never stored.
- **Fail fast** — same rule as `Team`: an import referencing an unknown team or player aborts rather than auto-creating a row.

### GoF pattern tie-in
- None. [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] still assigns Abstract Factory, Adapter, Template Method (ingestion pipeline) and Proxy (live-score cache) to this module; that Standards file is stale, and a Director PR corrects it.

### AWS mapping
RDS Postgres table (system of record), per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]. No DynamoDB involvement. The idempotency and live-score cache tables, the API-SPORTS secret and the ingestion-retry queue exist in `Fanwire-Data`/`Fanwire-Messaging` with no consumer, their CloudFormation exports kept alive with `exportValue`; a later infra unit deletes them.

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
One player's line in one game's box score (`player_game_stats`). Unique on `(game_id, player_id)`, whose index serves box-score reads by game; `ix_player_game_stats_player_id` serves career and game-log reads by player. The records indexes (migration `b5e9c3a7d2f1`, [[0x02d-events-records]]) add four single-stat partial indexes over played lines and one over triple-double lines; migration `a8d3e5f1c2b7` adds eight more over played lines.

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
