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
One player's line in one game's box score (`player_game_stats`). Unique on `(game_id, player_id)`, whose index serves box-score reads by game; `ix_player_game_stats_player_id` serves career and game-log reads by player. The records indexes (migration `b5e9c3a7d2f1`, "API routes" → Records) add four single-stat partial indexes over played lines and one over triple-double lines.

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
  - `players`: rows with minutes (`seconds_played` not null, zero included), starters first, then by seconds played (most first), then player id; each with `line_id` (the `player_game_stats` row's id, a `player_game` attachment's target, `EVENTS-009`), player id and names, starter and starting position, seconds, every counting stat, plus-minus and the three shooting percentages.
  - `did_not_play`: rows without minutes, by player id, with player id, names and `dnp_reason` (may be null).
  - `totals`: sums of the played rows only (seconds and counting stats; no plus-minus), percentages computed from the sums. **Never adjusted to the final score**: the 19 team-games where players' points differ from the score show both numbers as they are.
  - Percentages are **computed, never stored**: made ÷ attempted, a fraction from 0 to 1 rounded to three places (`0.462`, as nba.com shows them), null when nothing was attempted.
  - A game without box-score rows answers 200 with empty lists, zero totals and null percentages.
- **No index for the list (measured, 2026-10-14):** on a full 2003-04 to 2025-26 load (local Docker Postgres), the newest page is a sequential scan plus a top-N sort in 15 ms, `offset` 29,000 in 25 ms, a team-and-season page in 2 ms; the box-score query uses the `(game_id, player_id)` constraint's index in under 1 ms. Over HTTP: 50 games are 10 KB, 200 are 40 KB, a Finals detail is 12.5 KB. Revisit on `db.t4g.micro` only if a measured page is slow.

- **Players (`EVENTS-006`).** Read models built in `app.events.service` (`list_players`, `player_detail`, `player_games`), computed at read time from `Player`, `PlayerGameStats` and `Game`. No aggregate table (YAGNI: a career is at most ~1,600 rows).
  - `GET /events/players`: a bare list. `limit` defaults to 20 (1–100); `offset` ≥ 0. Ordered by last name, then first name, then id. Each item carries id, names, position, jersey, first and last season, and `latest_team_abbreviation`: the team of the player's newest box-score row by game date, DNP rows included, or null when there is none.
    - `q` is trimmed, then must be 1–100 characters. Every whitespace-separated word must be a prefix of the first name or of the last name, matched as `lower(unaccent(name)) LIKE lower(unaccent(:word)) || '%' ESCAPE '\'`. `\`, `%` and `_` in the input are escaped, and every value is a bound parameter.
    - `season` keeps players with at least one **played** row that season. `q` and `season` are ANDed.
    - Two queries: the page, then the latest team of each paged player in one `DISTINCT ON`.
  - `GET /events/players/{player_id}`: the stored attributes, `career_regular`, `career_playoffs` and `seasons`, in four queries whatever the career's length. Those are the player, then a `GROUP BY` game type for the career lines, a `GROUP BY` season and game type for the season lines, and the season teams.
    - A line has games played and started, seconds, the totals of every counting stat, per-game averages (points, rebounds, assists, steals, blocks, turnovers, threes made, minutes) to one place, and the three percentages from the totals.
    - **Only played rows of `regular` and `playoffs` games count.** Play-in and cup-final games are in no line, the NBA's own rule, but they are in the game log.
    - A player without playoff games has a playoff line of zeros, with null averages and percentages.
    - `seasons` has one row per season and game type played, newest season first. `teams` lists the abbreviations in the order first played, and the stats are summed across teams, like nba.com's "TOT" row.
    - Unknown id: 404.
  - `GET /events/players/{player_id}/games`: the game log, played and DNP rows, newest first by game date, then game id. `limit` defaults to 50 (1–200). Optional `season` and `game_type` filters.
    - Each row carries the game id, date, season, type and label; `team` and `opponent` (id, name, abbreviation); `is_home`; `team_score`/`opponent_score`; starter and starting position; seconds (null for a DNP); every counting stat; plus-minus; the three percentages; and `dnp_reason`.
    - Two queries: the existence check, then the page. An unknown player is a 404.
  - **One percentage rule.** `_shooting_from_totals` hands the sums to `_pct`, the only three-place rounding in `app/events`, for the box score and the player lines alike. Percentages are rounded in Python, never by SQL `ROUND`: Postgres rounds half away from zero (0.0625 → 0.063), and the box score would then disagree with the career line (0.062). `tests/events/test_player_detail.py` pins both.
  - **`unaccent`.** Migration `e6b2f8a4c7d1` runs `CREATE EXTENSION IF NOT EXISTS unaccent`, which needs the master user (the Migration Lambda's). `unaccent()` is not `IMMUTABLE`, so it can't sit in an index expression. The names in the 2026-06-15 dataset are stored without accents anyway (`Doncic`, `Jokic`: none of 1,018 players in three loaded seasons has one), so the extension is for the query side: `DONČIĆ` finds `Doncic`.
  - **No index (measured, 2026-10-15).**
    - On a synthetic full-size set (2,426 players, 741k box-score rows), the two-word search is a sequential scan plus a sort in 3.3 ms, and the whole list call takes 18–51 ms over a Windows-host connection.
    - On three real seasons (2018-19, 2023-24, 2024-25) in a throwaway Postgres, the warm search takes 8–17 ms, Dončić's detail 43 ms and his log 18 ms.
    - His lines there match nba.com: 2023-24 regular, 70 GP, 33.9 PPG, .487 FG. The one exception is 2024-25, which shows 48 games, not his 50. The dataset itself has only 27 Lakers rows for him, one of them a DNP.

- **Seasons (`EVENTS-007`).** Read models in `app.events.service` (`standings`, `champion`, `leaders`, `team_season`), computed at read time. Each route takes a fixed number of queries whatever the season's size, and the aggregation is a `GROUP BY` in Postgres. **A malformed value is a 422; a well-formed season with no stored games, or an unknown team, is a 404**, and every route's docstring says so, so it reaches `openapi.json`.
  - `GET /events/seasons`: every season with a stored game, newest first, as a list of `"YYYY-YY"` strings. It reuses `distinct_seasons`, which `search/` keeps using unchanged. 1 query.
  - `GET /events/seasons/{season}/standings`: `{season, tie_break, conferences: [{conference, divisions: [{division, teams}]}]}`. Conferences and divisions are sorted by name.
    - Each row has `team`, `wins`, `losses`, `win_pct` (three places, through `_pct`), `games_behind` and the home/away splits.
    - **Only `regular` games count**, NBA Cup group and knockout games included. `cup-final`, `play-in` and `playoffs` don't count.
    - Within a conference the order is the exact win fraction, then wins, then team name. `win_pct` is rounded for display only.
    - `games_behind` is `((leader_w - w) + (l - leader_l)) / 2` from the first team in that order, so it can be a half game.
    - **NBA tie-breakers are not applied.** `tie_break` says so: "Win percentage, then wins, then team name (NBA tie-breakers not applied)". Real tie-breakers are a later decision for the human.
    - 2 queries: the season check, then one `GROUP BY`.
  - `GET /events/seasons/{season}/champion`: `{season, champion, runner_up, result}`. **Computed, never stored**: among the season's `playoffs` games labelled `NBA Finals` (the dataset's spelling, checked on the full load: 7 games in 2015-16 and in 2024-25), the team with four wins. `result` is its wins, then the runner-up's (`"4-2"`). With no such team yet (a season in progress, or a season without Finals games), the same shape comes back with nulls, a 200. 2 queries.
  - `GET /events/seasons/{season}/leaders?stat=`: `stat` is one of `points|rebounds|assists|steals|blocks|threes`; `threes` means three-pointers made. `limit` defaults to 10 (1–50). `game_type` is `regular` (the default) or `playoffs`.
    - The response is `{rule, minimum_games, leaders: [{player_id, first_name, last_name, teams, games_played, average}]}`.
    - Only played rows of the requested game type count. Rows are ordered by the exact average (descending), then player id (ascending). `average` is rounded to one place through `_per_game`.
    - **Qualifier:**
      - From 2023-24, 65 games: the NBA's rule for awards and leaderboards.
      - Before that, 70 % of the most regular-season games any team played, rounded up and computed in integers. This is the proxy the human accepted for the NBA's old minimums per stat, which aren't reproduced.
      - The playoffs have no minimum (0).
    - `rule` names the rule applied: "65 games (NBA rule from 2023-24)", "70% of 82 team games, rounded up: 58" or "No minimum in the playoffs".
    - 2 queries; 3 for a regular season before 2023-24, which also needs the most team games.
  - `GET /events/teams/{team_id}/seasons/{season}`: the team (with conference and division), its regular-season `record` with home and away splits, and every one of its games that season of every stored type, newest first.
    - Each game has its id, date, type, label, sub-label, `opponent` (id, abbreviation), `is_home`, `team_score`/`opponent_score` and `won`.
    - A known team with no games in a stored season gets a 200 with a 0-0 record.
    - 4 queries.
  - **No index (measured, 2026-10-15).** On the full 2003-04 to 2025-26 load (29,646 games, local Docker Postgres, Windows host), the median warm call over the app is:

    | Call | Median |
    |---|---|
    | seasons | 11 ms |
    | standings | 16 ms |
    | points leaders, regular season | 58–66 ms |
    | points leaders, playoffs | 21 ms |
    | a team's season | 29 ms |

    On that load:
    - Champions match the real results: 2015-16 CLE over GSW 4-3, 2023-24 BOS over DAL 4-1, 2024-25 OKC over IND 4-3.
    - BOS's 2023-24 record is 64-18 (37-4 at home, 27-14 away).
    - The 2023-24 scoring leaders are Dončić 33.9, Antetokounmpo 30.4 and Gilgeous-Alexander 30.1. Embiid is out: he played under 65 games.

- **Records (`EVENTS-010`).** `app.events.records` holds `RECORDS`, a fixed registry of twelve records, team records first: `team-championships`, `team-best-season`, `team-worst-season`, `team-most-points-game`, `team-largest-win`, `player-championships`, `player-points-game`, `player-rebounds-game`, `player-assists-game`, `player-threes-game`, `player-career-points`, `player-career-triple-doubles`. Each has an id, group, title, unit and rule text, and a query builder (a Strategy, [[wiki/CodeContext/Standards/gof-patterns|GoF]]) returning its *candidates*: every qualifying row with its value, and the list's order. One read path ranks, caps and pages any record's candidates, so a new record is one more registry entry. Computed live, as standings and leaders are: no aggregate table.
  - **Counting rules**, each stated in its rule text:
    - Single-game records count `regular` and `playoffs` games only (not play-in or the cup final), and played lines only.
    - Season records count `regular` games, and only seasons with a champion: a season in progress never holds one.
    - Championships use `champion`'s rule through one helper: `service.season_champions()` (one `ROW_NUMBER()` over every season's Finals wins) is built on the same `_finals_teams`/`_finals_wins`/`_finals_order` as `champion`, so they agree by construction. A player's title is a season with a played line for the champion in that season's NBA Finals.
    - Career records count played lines of `regular` games. A triple-double is 10 or more in at least three of points, rebounds, assists, steals and blocks.
    - Team records ignore a game without a result (`Game.completed`).
  - `GET /events/records`: `{since_season, through_season, records: [{id, group, title, unit, rule, holder}]}`. `holder` is the list's first entry plus `tied_count`, how many entries share its value (all of them, not only those inside the cap); null when nothing qualifies. The window is the earliest and latest stored season. **13 queries**: the window, then one per record fetching at most one row.
  - `GET /events/records/{record_id}?limit=&offset=`: `{id, group, title, unit, rule, since_season, through_season, total, entries}`. A list holds at most its **top 100** (a tie at the 100th place is cut by the list's order); `total` is how many it holds; `limit` 1–100 (default 25), `offset` 0–99, so no call pages past the 100th entry. **2 queries**: the window, then the page with its total.
    - An entry has `rank` (competition ranking, `RANK()`: 1, 1, 3), `value`, `team` (id, name, abbreviation), `player` (id, names), `season` and `game` (id, date, type, opponent abbreviation), each null where the record has none. A player's single-game entry names the team he played for.
    - Order: value (ascending for `team-worst-season`, descending otherwise), then wins for season records (more first for best, fewer first for worst), then date or season (earlier first), then team or player id.
    - Season values are win percentages through `_pct`, the one three-place rounding in `app/events`; the exact fraction ranks and orders, in SQL.
  - An unknown id is a 404, a `limit` or `offset` out of range a 422; an empty database answers 200 with null holders and empty lists.
  - **Cached at the edge for five minutes** (the human, 2026-10-23): both routes answer a 200 with `Cache-Control: public, max-age=300`, and `infra/lib/cdn-stack.ts`'s `/api/events/records*` behaviour, ordered before `/api/*`, honours it with a cache key of `limit` and `offset` only: no header, no cookie. That is safe only because the routes never read the caller (no user dependency, pinned by `test_records_contract.py`). Every other route under `/api/*` stays uncached. The latency ceilings are measured at the origin, uncached.
  - **Query shape.** A list's top is `FETCH FIRST 100 ROWS WITH TIES` on the ranked value alone, then cut to 100 by the full order. A holder is `FETCH FIRST 1 ROW WITH TIES`, and `tied_count` is that set's size. Ordering the inner query by the full order instead (value, date, player, line) gave an incremental sort under a parallel Gather Merge that read about 1,000 index rows for a 100-row list. Season records group each side on `games` before the `UNION ALL`: about 1,400 rows reach the final grouping instead of 55,000. The summary's twelve holder statements take no parameters, so each is built once per process: rebuilding them on every call cost about 20 ms of Python.
  - **Eight indexes (migration `b5e9c3a7d2f1`, measured, 2026-10-24).** `tests/events/test_records_indexes.py` pins each to the statement the app sends.

    | Index | Serves | Before → after (list at limit 100, HTTP median) |
    |---|---|---|
    | `ix_player_game_stats_{points,rebounds,assists,three_pointers_made}_played`, each `(stat) WHERE seconds_played IS NOT NULL` | the four single-game player records | 116–138 ms → 16–18 ms; holder 29,380 → about 20 buffers |
    | `ix_player_game_stats_triple_doubles`, `(player_id, game_id)` over played triple-double lines; its predicate is `models.TRIPLE_DOUBLE`, shared with the record | `player-career-triple-doubles` | 96 ms → 21 ms; 15,284 → 1,006 buffers |
    | `ix_games_margin`, `(abs(home_score - away_score))` | `team-largest-win` | 31 ms → 15 ms; holder 1,321 → 9 buffers |
    | `ix_games_nba_finals`, `(season)` over NBA Finals games | every championship rule | `player-championships` 2,687 → 1,461 buffers |
    | `ix_games_season`, `(season)` | the data window (min and max season) that every records call reads | 657 → 7 buffers, 6 ms → 0.1 ms |

    - **The measurement.** The real 2003-04 to 2025-26 load: 29,646 games and 745,466 box-score rows. That is 108.6 MB of `player_game_stats` (`pg_relation_size`) and 5.4 MB of `games`. Local Docker Postgres 16 on Windows, from the June 2026 CSV download.
    - **Upgrade** time: 3.0 s, and the indexes total about 18 MB. The full load took 490 s before the migration and 332 s after it. The first run read the CSVs cold, so compare season by season instead: a season that took 14–15 s without the indexes takes 14–15 s with them, so the indexes add no measurable load time.
    - **Medians after:**
      - local: the summary in 187–193 ms, `player-career-points` in 100–107 ms, every other list in 12–41 ms;
      - the `db.t4g.micro` proxy (`--cpus=1 --memory=1g`, `shared_buffers=256MB`, `work_mem=4MB`): the summary in 315–351 ms, `player-career-points` in 210–274 ms.
    - **Payloads:** the summary is 5.4 KB, a 100-entry list at most 27.5 KB.
    - **Unchanged:** the other events routes stay within 1.5 ms of their medians before the migration.
    - **Not indexed:**
      - `player-career-points` reads every line by design: about 15,300 buffers.
      - `team-most-points-game` reads `games` twice, as a `UNION ALL` of both sides: 1,765 buffers and 35 ms. Indexes on `home_score` and `away_score` were tried and gave no index plan, even with sequential scans off.
      - The season records read `games` through `ix_games_season` once per champion season, on each side: 1,649 buffers and 41 ms.
    - **One Baseline line is missed, and the human accepted it (2026-10-24):** the whole summary touches about 22,200 buffers against the skeptic's cap of 19,193 (1.25 × `player_game_stats`' heap plus 4 × `games`'). The overrun is all repeat reads of `games`. Every latency ceiling is met.
    - **The scale floor was not reached either, also accepted by the human:** the complete real dataset has 745,466 box-score rows, not the 800,000 the skeptic estimated.

No pagination on `GET /events/teams` (YAGNI — `Team` is a small, static ~30-row table).

## The scale generator — `scripts/generate_scale_fixture.py` (`EVENTS-010`)

A dev tool for measuring at full-load scale without the real CSVs: `python scripts/generate_scale_fixture.py [--seasons 23] [--games-per-team 82]`, cwd `backend/`, `DATABASE_URL` pointing at a migrated database. Never run in CI or in production.
- **Fail-closed:** refuses (exit 1, nothing written) unless `ENVIRONMENT` is exactly `development` or `perf`, and when any stored `nba_game_id` is below 9,000,000,000 (a real load).
- **Its own id range:** teams, players and games from 9,200,000,000, clear of `seed_perf.py`'s 9,000,000,000–9,199,999,999.
- **Deterministic and idempotent:** a fixed seed; a second run finds its range populated and writes nothing.
- **Shape:** the 30 franchises (the loader's names and divisions), seasons from 2003-04, every team playing exactly `--games-per-team` regular games, playoffs with an NBA Finals that makes a champion each season, about 26–27 box-score rows per game with about 20 % did-not-play rows. Written with `COPY` in one transaction. It prints its games, rows, triple-doubles, 50-point games and DNP share.
- Its distributions are synthetic: correctness at scale is proven only on the real load.
- EVENTS-010's measurements used the real load, not this generator.

## The attachment interface — `posts/`' read of sports data (`EVENTS-009`)

`posts/`' sports-data attachments (`Prompts/18`, `human-decisions.md` §9) reach `events/` through these `app.events.service` functions only; `posts/` never imports `app.events.models`.

- **Validation, one target, a precise refusal.** `validate_game_final(session, game_id)`, `validate_player_game(session, line_id)`, `validate_player_career(session, player_id, scope)` return `None` or raise a `LinkTargetError` subclass (`app.events.errors`): `LinkTargetNotFoundError`, `GameNotCompletedError`, `PlayerDidNotPlayError`, `NoGamesInScopeError`. A scope outside `CAREER_SCOPES` (`regular`, `playoffs`, which is `LINE_GAME_TYPES`) is a plain `ValueError`: the request is wrong, not the target.
- **`Game.completed`** (a hybrid, row and query): `home_score + away_score > 0`, the loader's "a 0–0 game has no score" rule in one place. Every loaded game is completed today; the property is where the rule changes if unplayed games are ever loaded.
- **Previews, in batches, honest about gaps.** `game_final_previews(session, game_ids)`, `player_game_previews(session, line_ids)`, `player_career_previews(session, [(player_id, scope)])` return dicts of frozen dataclasses (`GameFinalPreview`, `PlayerGamePreview`, `PlayerCareerPreview`). An id with no row, or a career key with an unknown scope, is absent rather than an error, so one odd target never fails a page. A DNP line is returned as stored. An empty career scope has null averages. **Query cost: none for no ids; one query for games and for lines, two for careers, whatever the number of ids** (pinned by query-count tests).
- **Careers are computed live**, by `player_detail`'s own helpers (`_line_columns`, `_stat_line`), so a career preview equals the player page's `career_regular`/`career_playoffs` by construction. No snapshot (out of scope by decision).

## Resolved decisions
- **Season format — settled as text, `"YYYY-YY"`** (e.g. `"2025-26"`). Implemented in `app.events.models.Game.season` (`Text`, not null); the loader derives it from digits 2–3 of the game id.
- **`Player` and `PlayerGameStats` replace `Game.player_stats` (`EVENTS-004`, 2026-10-13).** The JSONB box score (four stats per player, no player identity) and its GIN index `ix_games_player_stats_gin` are dropped by migration `d9f3b6a1e2c4`, which also adds the two tables and the game columns above; existing teams and games keep their rows and ids. Its downgrade restores `player_stats` as `[]` on every row. The trigger this file named for a `Player` table, cross-game player tracking and a player page, is met: `EVENTS-006` serves players ("API routes" above).
- **API-SPORTS retired (`EVENTS-003`, 2026-10-13).** Removed: `adapters.py` (`ApiSportsAdapter`), `factory.py`, `interfaces.py`, the ingestion pipeline, `proxy.py` (`CachedEventProxy` and its caches), `lambda_handler.py` (the `Ingestion` function), `events/dependencies.py` (`get_live_score_proxy`, key resolution), the `api_sports_*`/`idempotency_table_name`/`live_score_cache_table_name` settings and the `api_sports_*` columns. Migration `c5e8a2d4f9b1` makes the nba ids NOT NULL; it **refuses to run, changing nothing, while any team or game row lacks an nba.com id**, naming the table and count (e.g. a dev database still holding the old `seed_dev.py` fixtures). `UnrecognizedTeamError` lives in `app.events.errors`; the `app.events.ingestion` re-export went with `EVENTS-004`. `scripts/seed_dev.py` seeds no teams or games; it prints how to load them.
- **The first dataset (`EVENTS-001`, superseded).** Nathan Lauga's "NBA games" (`teams.csv`, `games.csv`, `games_details.csv`, to December 2022) was loaded by the first version of `app.events.nba_history`; the human has since deleted it. Its 3,637 loaded games match the new dataset on game id, teams and both scores. Its decisions carry over: nba.com ids get their own columns, `game_type` is stored, play-in games are loaded, duplicate rows keep the first and are counted, one transaction per run.
- **`feed/`'s read interface — implemented (Phase 3, feed/ unit).** `app.events.service.game_ids_for_team(session, team_id) -> list[int]` (the team-scoped feed) — see [[0x06-feed]]. `games_by_ids(session, ids) -> dict[int, GameRef]` remains, `GameRef` now just `id`, but has no caller in app code since `EVENTS-003` removed the live-score lookup it served.
- **`search/`'s sports-data filter — implemented (Phase 3, search/ unit; position moved by `EVENTS-004`).** `app.events.service.filter_games(session, *, season, team_id, position, limit, offset) -> list[Game]` (plain `WHERE`-clause filtering, all filters optional and AND'd, `team_id` matches home or away) and `distinct_seasons(session) -> list[str]` (for the year dropdown). `position` is an `EXISTS` on `PlayerGameStats`: a game matches when any player in its box score **started** at that position (bench rows have none). `ALLOWED_POSITIONS` (`PG, SG, SF, PF, C, G, F`) is the allow-list `GET /search/games`' `position` query param is validated against; the data's starters only ever have `G`/`F`/`C`, so `PG`…`PF` match nothing. See [[0x07-search]].
