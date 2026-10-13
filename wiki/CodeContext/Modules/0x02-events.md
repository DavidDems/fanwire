# 0x02 — Events

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized. Covers the `events/` module: `Team` and `Game`. The `Team`-before-`Game` seeding order is already documented in [[0x00-architecture]] — not repeated here. **One source since `EVENTS-003` (2026-10-13):** NBA data comes from a Kaggle dataset loaded into Postgres; the API-SPORTS path (adapter, ingestion pipeline and Lambda, live-score proxy) is retired, and nba.com ids are the only sports-data keys.

Business rules driving this module (full detail in [[wiki/GeneralContext/Architecture/business-rules|Projects]] "Events"): import an existing NBA game-results database (only NBA, only this source, for now), serve it via an API, provide a stats section (champions, team records during the regular season, stats leaders), and posts with a game link must click through to that game's stats page ([[0x03-posts]]'s `EventMention` references `Game` for this).

## `Team`

### Schema
NBA team reference data. One row per team, effectively static.

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key |
| `nba_team_id` | bigint, unique, not null | nba.com `TEAM_ID` (`1610612737`…), set by the NBA dataset loader. The only source key since `EVENTS-003`, which dropped `api_sports_team_id` and the `ck_teams_has_source_id` CHECK |
| `name` | text, not null | e.g. "Boston Celtics" |
| `abbreviation` | text, not null | e.g. "BOS" |
| `conference` | text, not null | Eastern / Western |
| `division` | text, not null | |
| `logo_url` | text, nullable | |

No FKs out of `Team`. `Game` FKs into it (below).

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
An imported NBA game result, including that game's player box score.

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key |
| `nba_game_id` | bigint, unique, not null | nba.com `GAME_ID` as an int (`22200477`), the loader's dedupe key. The only source key since `EVENTS-003`, which dropped `api_sports_game_id` and the `ck_games_has_source_id` CHECK |
| `home_team_id` | FK → `Team.id`, not null | |
| `away_team_id` | FK → `Team.id`, not null | |
| `date` | timestamp, not null | |
| `season` | text/integer, not null | e.g. "2025-26" — needed for the stats section's season scoping |
| `home_score` | integer, not null | final score |
| `away_score` | integer, not null | final score |
| `venue` | text, nullable | |
| `player_stats` | JSONB, not null | embedded per-game box score, see below |
| `game_type` | text, nullable | `regular` / `playoffs` / `play-in`, set by the NBA dataset loader from the `GAME_ID` prefix (the stats section's "regular season" scoping needs it) |

`player_stats` shape (array of objects, one per player who appeared in that game):
```json
[
  {
    "player_name": "Jayson Tatum",
    "team_id": 12,
    "points": 28,
    "rebounds": 7,
    "assists": 5,
    "position": "SF",
    "...": "whatever box-score fields the loader stores"
  }
]
```
`team_id` inside each entry references `Team.id`, but this is data, not an enforced FK — Postgres can't FK into elements of a JSONB array. Integrity here relies on the loader validating each embedded team against `Team` at load time (fail fast, same as `home_team_id`/`away_team_id`), not on the database schema. `EVENTS-004` replaces this column with a `PlayerGameStats` table.

`player_stats` also has a `GIN` index using the `jsonb_path_ops` opclass (`ix_games_player_stats_gin`, Phase 3 `search/` unit) — the right fit for the `@>` containment queries `filter_games`'s position filter runs, see [[0x07-search]].

### Design principles tie-in
- **YAGNI / "Three similar lines beat a premature abstraction"** — no standalone `Player` table and no `PlayerSeasonStat` aggregate table for v1. There is exactly one read need today (a single game's box score on that game's stats page), so normalizing player identity across games would be abstraction with no current consumer. Extracting a real `Player` table is a future migration, triggered when cross-game player tracking (e.g. a player profile page) becomes an actual requirement — not before.
- **"Team records during the regular season" and "stats leaders"** (per [[wiki/GeneralContext/Architecture/business-rules|Projects]]) are computed for v1 by scanning/aggregating `Game` rows (and their embedded `player_stats`) at read time — a query over a season's `Game` rows, not a normalized cross-game table. This is explicitly the deferred-normalization tradeoff above, not an oversight.
- **Single source of truth** — the dataset's box score for a specific game is the only source of player data. No separate player roster or stats table exists to drift out of sync with it (until `EVENTS-004` adds `Player`/`PlayerGameStats`, which then *are* that source).
- **Fail fast** — same rule as `Team`: an import referencing a `team_id` (top-level or inside `player_stats`) not already seeded in `Team` aborts rather than auto-creating a row.

### GoF pattern tie-in
- None today. The Abstract Factory, Adapter, Template Method (ingestion pipeline) and Proxy (live-score cache) that [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] still assigns to this module were removed with the API-SPORTS path (`EVENTS-003`); that Standards file is updated by a Director PR.

### AWS mapping
RDS Postgres table (system of record), per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]. No DynamoDB involvement since `EVENTS-003`. The idempotency and live-score cache tables, the API-SPORTS secret and the ingestion-retry queue still exist in `Fanwire-Data`/`Fanwire-Messaging` with no consumer, their CloudFormation exports kept alive with `exportValue` so the deploy that drops `Fanwire-App`'s imports doesn't fail; a later infra unit deletes them.

### Security
Not PII, not user-generated content. No per-row access control is needed: `Game` and its embedded `player_stats` are public read data served by the events API.

### API routes (Phase 2a)
"Create an API to serve the data of these game from the database to the website" (`wiki/GeneralContext/Architecture/business-rules.md` "Events") was unimplemented through Phase 1 — Phase 2a (`wiki/GeneralContext/Prompts/phase-2-manager-agent.md`) closed it. Routes live in `app.events.routes` (`APIRouter(prefix="/events")`), public, no auth (sports data is public read, matching the guest-feed requirement):
- `GET /events/teams`, `GET /events/teams/{team_id}`
- `GET /events/games` (optional `team_id`/`season` filters, ordered by `date` descending), `GET /events/games/{game_id}` — this is the read side `posts/`'s `EventMention.game_id` links to (a post's game-result attachment resolves here; not built yet — `posts/` is Phase 2 proper).

No pagination on either list endpoint (YAGNI — `Team` is a small, static ~30-row table). Flagged, not resolved: `Game` grows every day of every season indefinitely, unlike `Team` — of the two, `/events/games` is the one most likely to need pagination first once real ingestion volume accumulates. Not added preemptively. **That volume now exists** (`EVENTS-001`): with three seasons loaded, `GET /events/games` returns 3,637 games, and the compose `#` mention picker renders every one of them (labelled "Game N · date · score", no teams). Paginating the route and narrowing the picker are now real needs, outside `EVENTS-001`'s scope.

### Resolved decisions
- **`player_stats` shape — settled as JSONB.** Implemented in `app.events.models.Game.player_stats` (a Postgres `JSONB` column, not null, defaulting to `[]`) — the recommendation above is now the built schema. Revisit only if query patterns on individual player fields (e.g. filtering by points threshold across games) turn out to need indexed columns rather than JSONB containment queries; no such need exists yet (YAGNI).
- **Season format — settled as text, `"YYYY-YY"`** (e.g. `"2025-26"`). Implemented in `app.events.models.Game.season` (`Text`, not null); the dataset loader derives it from the season's start year.
- **`player_stats` position field name — settled as `"position"`.** The dataset loader stores `START_POSITION` there (see the historical-games entry below). Resolves [[0x07-search]]'s position-filter question.
- **API-SPORTS retired (`EVENTS-003`, 2026-10-13).** Removed: `adapters.py` (`ApiSportsAdapter`), `factory.py`, `interfaces.py`, the ingestion pipeline, `proxy.py` (`CachedEventProxy` and its caches), `lambda_handler.py` (the `Ingestion` function), `events/dependencies.py` (`get_live_score_proxy`, key resolution), the `api_sports_*`/`idempotency_table_name`/`live_score_cache_table_name` settings and the `api_sports_*` columns. Migration `c5e8a2d4f9b1` makes the nba ids NOT NULL; it **refuses to run, changing nothing, while any team or game row lacks an nba.com id**, naming the table and count (e.g. a dev database still holding the old `seed_dev.py` fixtures). `UnrecognizedTeamError` now lives in `app.events.errors`; `app.events.ingestion` survives only as its re-export for `scripts/load_nba_history.py`, and goes with `EVENTS-004`. `scripts/seed_dev.py` seeds no teams or games; it prints how to load them.
- **Historical games — the Kaggle "NBA games" dataset, loaded by `app.events.nba_history` (`EVENTS-001`, 2026-10-13).** This is the "existing database of NBA game results" the business rules ask for: `teams.csv`, `games.csv`, `games_details.csv` (Nathan Lauga, nba.com data, 2003-04 to Dec 2022; the dataset lives outside the repo, its licence is the human's to check, tests use a synthetic fixture under `backend/tests/fixtures/nba_history/`). CLI: `python scripts/load_nba_history.py --data-dir <dir> [--season 2021-22 ...]` with `DATABASE_URL` set; never pointed at the live RDS (that is `EVENTS-002`). Human decisions: nba.com ids get their **own columns** (`nba_team_id`/`nba_game_id`; the only ones since `EVENTS-003`); `game_type` is **stored**; **play-in games are loaded**; duplicate rows in the data (29 games and 289 box-score rows in 2020-21) **keep the first and are counted**, while duplicates that disagree on a stored field are a `DatasetError`. Rules: `GAME_ID` prefix `1` preseason and `3` All-Star are skipped and counted (the dataset has no All-Star games); a game without a final score is skipped and counted; `season` is `"YYYY-YY"` from the dataset's start year; `player_stats` holds one entry per player who played (DNP rows left out), `position` is `START_POSITION` as given (`F`/`C`/`G` for starters, null for the bench — `search/`'s `C`/`G`/`F` filter matches starters only); conference/division come from a fixed 30-team mapping in the loader (league reference data; `teams.csv` has neither), and a team outside it is a `DatasetError`; an unknown team in a game or box-score row raises `UnrecognizedTeamError`. **One transaction per run**: everything is read and validated first, and any failure rolls the whole run back, teams included. Re-runs add nothing (`already_present` counts them). Measured: the whole dataset (≈25k stored games) loads in about 26 s against local Postgres.
- **`feed/`'s read interface — implemented (Phase 3, feed/ unit).** `app.events.service.game_ids_for_team(session, team_id) -> list[int]` (the team-scoped feed) — see [[0x06-feed]]. `games_by_ids(session, ids) -> dict[int, GameRef]` remains, `GameRef` now just `id`, but has no caller in app code since `EVENTS-003` removed the live-score lookup it served.
- **`search/`'s sports-data filter — implemented (Phase 3, search/ unit).** `app.events.service.filter_games(session, *, season, team_id, position, limit, offset) -> list[Game]` (plain `WHERE`-clause filtering, all filters optional and AND'd, `team_id` matches home or away, `position` via JSONB containment on `player_stats`) and `distinct_seasons(session) -> list[str]` (for the year dropdown). `ALLOWED_POSITIONS` (`PG, SG, SF, PF, C, G, F` — the standard basketball set; the dataset's starters use the `G`/`F`/`C` subset) is the allow-list `GET /search/games`' `position` query param is validated against at the boundary. See [[0x07-search]].
