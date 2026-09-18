# 0x02 — Events

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized. Covers the `events/` module: `Team` and `Game`. Ingestion pipeline shape and the `Team`-before-`Game` seeding order are already documented in [[0x00-architecture]] — not repeated here.

Business rules driving this module (full detail in [[wiki/GeneralContext/Architecture/business-rules|Projects]] "Events"): import an existing NBA game-results database (only NBA, only this source, for now), serve it via an API, provide a stats section (champions, team records during the regular season, stats leaders), and posts with a game link must click through to that game's stats page ([[0x03-posts]]'s `EventMention` references `Game` for this).

## `Team`

### Schema
NBA team reference data. One row per team, effectively static.

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key |
| `api_sports_team_id` | integer, unique, not null | vendor ID from API-SPORTS — what `Game` import matches against |
| `name` | text, not null | e.g. "Boston Celtics" |
| `abbreviation` | text, not null | e.g. "BOS" |
| `conference` | text, not null | Eastern / Western |
| `division` | text, not null | |
| `logo_url` | text, nullable | |

No FKs out of `Team`. `Game` FKs into it (below).

### Design principles tie-in
- **Fail fast** — `Team` rows are seeded up front, not created on demand. An API-SPORTS `Game` payload referencing a `team_id` not already in this table is a boundary error that stops the import, per [[wiki/CodeContext/Standards/design-principles|Design principles]] "Fail fast" and "Validate at boundaries only" — an unrecognized team is invalid external input, not a case to silently paper over with an auto-created row.
- **Single source of truth** — `Team` is the one place team identity/metadata lives; `Game` and any future module reference it by FK, never copy team name/abbreviation inline.

### GoF pattern tie-in
- Populated via the same `SportsDataSource` interface (`ApiSportsAdapter`, behind `SportsProviderFactory`) as `Game` — `events/` never parses the vendor's raw team JSON directly outside the adapter (see [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]).

### AWS mapping
RDS Postgres table, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] and [[0x00-architecture]]'s "every table in this wiki lives in RDS" rule. No DynamoDB involvement — team reference data isn't live/cacheable in the sense `CachedEventProxy` addresses.

### Security
Not PII, not user-generated. No entity-specific requirement beyond the general one in [[wiki/CodeContext/Standards/security|Security]] that the API-SPORTS key used to fetch this data is a shared secret in Secrets Manager, never client-reachable.

### Open decisions
None flagged — this table is small and stable enough that the shape above is treated as settled, not provisional.

## `Game`

### Schema
An imported NBA game result, including that game's player box score.

| Field | Type | Notes |
|---|---|---|
| `id` | PK | internal surrogate key |
| `api_sports_game_id` | integer, unique, not null | vendor ID — dedupe/idempotency key for re-imports |
| `home_team_id` | FK → `Team.id`, not null | |
| `away_team_id` | FK → `Team.id`, not null | |
| `date` | timestamp, not null | |
| `season` | text/integer, not null | e.g. "2025-26" — needed for the stats section's season scoping |
| `home_score` | integer, not null | final score |
| `away_score` | integer, not null | final score |
| `venue` | text, nullable | |
| `player_stats` | JSONB, not null | embedded per-game box score, see below |

`player_stats` shape (array of objects, one per player who appeared in that game):
```json
[
  {
    "player_name": "Jayson Tatum",
    "team_id": 12,
    "points": 28,
    "rebounds": 7,
    "assists": 5,
    "...": "whatever fields API-SPORTS' box score endpoint returns for that sport"
  }
]
```
`team_id` inside each entry references `Team.id`, but this is data, not an enforced FK — Postgres can't FK into elements of a JSONB array. Integrity here relies on the ingestion pipeline validating each embedded `team_id` against `Team` at import time (fail fast, same as `home_team_id`/`away_team_id`), not on the database schema.

### Design principles tie-in
- **YAGNI / "Three similar lines beat a premature abstraction"** — no standalone `Player` table and no `PlayerSeasonStat` aggregate table for v1. There is exactly one read need today (a single game's box score on that game's stats page) and API-SPORTS is scoped per-game anyway, so normalizing player identity across games would be abstraction with no current consumer. Extracting a real `Player` table is a future migration, triggered when cross-game player tracking (e.g. a player profile page) becomes an actual requirement — not before.
- **"Team records during the regular season" and "stats leaders"** (per [[wiki/GeneralContext/Architecture/business-rules|Projects]]) are computed for v1 by scanning/aggregating `Game` rows (and their embedded `player_stats`) at read time — a query over a season's `Game` rows, not a normalized cross-game table. This is explicitly the deferred-normalization tradeoff above, not an oversight.
- **Single source of truth** — the API-SPORTS box score for a specific game is the only source of player data in v1. No separate player roster or stats table exists to drift out of sync with it.
- **Fail fast** — same rule as `Team`: an import referencing a `team_id` (top-level or inside `player_stats`) not already seeded in `Team` aborts rather than auto-creating a row.

### GoF pattern tie-in
- **Abstract Factory** (`SportsProviderFactory`) and **Adapter** (`ApiSportsAdapter` implementing `SportsDataSource`) — `Game` rows are built from the adapter's normalized shape, never from API-SPORTS' raw response, so a future second provider swaps the whole family without touching this schema (per [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] and the "single-provider until proven insufficient" decision in [[wiki/GeneralContext/Architecture/business-rules|Projects]]).
- **Template Method** (`AbstractEventIngestionPipeline.run()`: `fetchRawEvents → normalize → dedupe → matchToMentions → publish`) — this is where a `Game` row (with its embedded `player_stats`) actually gets produced and persisted. Full pipeline detail lives in [[0x00-architecture]], not repeated here.
- **Proxy** (`CachedEventProxy`, DynamoDB, short TTL) sits in front of live-score reads for in-progress games. It is a cache in front of `Game`, not a table of record — a live score is still ultimately backed by the same `Game` row once the game is final. See [[0x00-architecture]].

### AWS mapping
RDS Postgres table (system of record), per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]. DynamoDB's only role here is `CachedEventProxy`'s short-TTL live-score cache and the ingestion idempotency table — neither is a table of record for `Game` data, per [[0x00-architecture]]'s "Data" section.

### Security
Not PII, not user-generated content — the general [[wiki/CodeContext/Standards/security|Security]]/[[wiki/CodeContext/Standards/aws-stack|AWS Stack]] requirement that applies is that the API-SPORTS key used for ingestion is a shared secret in Secrets Manager, scoped to the ingestion Lambda's role only, never reachable from client-facing code. No per-row access control is needed: `Game` and its embedded `player_stats` are public read data served by the events API.

### API routes (Phase 2a)
"Create an API to serve the data of these game from the database to the website" (`wiki/GeneralContext/Architecture/business-rules.md` "Events") was unimplemented through Phase 1 — Phase 2a (`wiki/GeneralContext/Prompts/phase-2-manager-agent.md`) closed it. Routes live in `app.events.routes` (`APIRouter(prefix="/events")`), public, no auth (sports data is public read, matching the guest-feed requirement):
- `GET /events/teams`, `GET /events/teams/{team_id}`
- `GET /events/games` (optional `team_id`/`season` filters, ordered by `date` descending), `GET /events/games/{game_id}` — this is the read side `posts/`'s `EventMention.game_id` links to (a post's game-result attachment resolves here; not built yet — `posts/` is Phase 2 proper).

No pagination on either list endpoint (YAGNI — `Team` is a small, static ~30-row table). Flagged, not resolved: `Game` grows every day of every season indefinitely, unlike `Team` — of the two, `/events/games` is the one most likely to need pagination first once real ingestion volume accumulates. Not added preemptively.

### Resolved decisions
- **`player_stats` shape — settled as JSONB.** Implemented in `app.events.models.Game.player_stats` (a Postgres `JSONB` column, not null, defaulting to `[]`) — the recommendation above is now the built schema. Revisit only if query patterns on individual player fields (e.g. filtering by points threshold across games) turn out to need indexed columns rather than JSONB containment queries; no such need exists yet (YAGNI).
- **Season format — settled as text, `"YYYY-YY"`** (e.g. `"2025-26"`). Implemented in `app.events.models.Game.season` (`Text`, not null) and in `ApiSportsAdapter._normalize_season` (`app/events/adapters.py`), which converts the adapter's illustrative vendor shape (`"2025-2026"`) into this stored format. Caveat: the adapter's vendor-shape parsing is illustrative/unverified against a live API-SPORTS response (see `app/events/adapters.py`'s module docstring) — the *stored* format (`"YYYY-YY"`) is settled, but the exact vendor field this is derived from still needs reconciling against real API-SPORTS docs before the real ingestion Lambda goes live.
