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
    "position": "SF",
    "...": "whatever fields API-SPORTS' box score endpoint returns for that sport"
  }
]
```
`team_id` inside each entry references `Team.id`, but this is data, not an enforced FK — Postgres can't FK into elements of a JSONB array. Integrity here relies on the ingestion pipeline validating each embedded `team_id` against `Team` at import time (fail fast, same as `home_team_id`/`away_team_id`), not on the database schema.

`player_stats` also has a `GIN` index using the `jsonb_path_ops` opclass (`ix_games_player_stats_gin`, Phase 3 `search/` unit) — the right fit for the `@>` containment queries `filter_games`'s position filter runs, see [[0x07-search]].

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
- **`player_stats` position field name — settled as `"position"`.** Implemented in `ApiSportsAdapter._to_normalized_game` (`app/events/adapters.py`) as `stat["player"].get("position")`, same illustrative/unverified-vendor-shape caveat as the rest of this adapter. Resolves [[0x07-search]]'s previously open "exact `player_stats` position field name" question, which the sports-data filter's position query depends on.
- **Live-score capability — `SportsDataSource.fetch_live_score` + `CachedEventProxy` implemented.** `app.events.interfaces.NormalizedLiveScore` and `SportsDataSource.fetch_live_score(api_sports_game_id) -> NormalizedLiveScore | None` exist, implemented in `ApiSportsAdapter` (same illustrative/unverified vendor-shape caveat, guessed `/games?id=...` endpoint and `status.short` field). `app.events.proxy.CachedEventProxy` (Proxy, see [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]) sits in front of it. **Real DynamoDB adapter implemented (Phase 4 Lambda-handlers unit):** `app.events.proxy.DynamoDbLiveScoreCache` — table `LIVE_SCORE_CACHE_TABLE_NAME` (infra's `liveScoreCacheTable`), partition key `pk` = `"game#<api_sports_game_id>"`, TTL attribute `expires_at` (epoch seconds). `get()` treats an expired-but-not-yet-reaped item as a miss without deleting it (the granted IAM actions are `GetItem`/`PutItem`/`UpdateItem` only, no `DeleteItem` — DynamoDB's own TTL sweep is the intended cleanup, not this code). `app.events.dependencies.get_live_score_proxy` wires this in once `Settings.live_score_cache_table_name` is set, else keeps `InMemoryLiveScoreCache` for local dev/tests — same "real adapter once the table/bus name is known" precedent as `app.eventbus.EventPublisher`. `feed/`/`search/` (later Phase 3 units) call `CachedEventProxy.get_live_score()` directly; wiring it into a route/DI stays out of scope here.
- **API-SPORTS key resolution — Secrets Manager fallback implemented (Phase 4 Lambda-handlers unit).** `app.events.dependencies.resolve_api_sports_key(settings)`: `Settings.api_sports_key` (an env var) always wins when set; otherwise, when `Settings.api_sports_secret_arn` is set (`API_SPORTS_SECRET_ARN`, the ingestion Lambda only), the real key is read from Secrets Manager once per cold start and cached (keyed by secret ARN) for the life of the process. Neither set → `""`, `get_live_score_proxy`'s existing "no real key configured" signal. `Settings.api_sports_base_url` now defaults to `https://v1.basketball.api-sports.io` (previously empty) since infra never sets `API_SPORTS_BASE_URL` — it's non-secret config with one sensible fixed value, defaulted in code rather than plumbed through infra.
- **Ingestion idempotency table — aligned to the settled DynamoDB schema (Phase 4 Lambda-handlers unit).** The dedupe step in `app.events.ingestion.FinalScoreIngestion` previously used a hard-coded table name (`fanwire-ingestion-idempotency`) and a bespoke `event_id` key that never matched the infra-provisioned table. It now takes `idempotency_table_name` as an explicit constructor argument (wired from `Settings.idempotency_table_name` / `IDEMPOTENCY_TABLE_NAME`) and writes `id` (partition key) + `expiration` (TTL, epoch seconds, 24h window — `FinalScoreIngestion.IDEMPOTENCY_TTL_SECONDS`), matching the real `IDEMPOTENCY_TABLE_NAME` table's schema. **Judgment call, hand-rolled conditional get/put kept, not aws-lambda-powertools' `Idempotency` utility**, even though the schema was deliberately chosen to match that utility's `DynamoDBPersistenceLayer` defaults (`key_attr="id"`, `expiry_attr="expiration"`) in case a future change adopts it: (1) the utility's idempotency key is derived by hashing a JSON-serialized payload argument, and `NormalizedGame` is a frozen dataclass with a `datetime` field — not JSON-serializable without a conversion step the utility doesn't expose a hook for; (2) `UnrecognizedTeamError` must fail fast without ever recording the item as processed, which a bare exception from inside the existing hand-rolled step already gives for free; (3) the Template Method's `dedupe()` step already reads once/writes once per game — what the utility would provide here regardless. The 24h TTL is a judgment call too: Postgres's own unique constraint on `Game.api_sports_game_id` is the real permanent duplicate backstop, so this table only needs to survive the retry/DLQ window, not dedupe forever.
- **Ingestion Lambda handler implemented (Phase 4 Lambda-handlers unit).** `app.events.lambda_handler.handler` (infra's `Ingestion` function, command `app.events.lambda_handler.handler`) dispatches on two trigger shapes: a direct EventBridge Scheduler invocation (the event IS the Scheduler's configured `input` JSON, no envelope — exceptions propagate uncaught so Lambda's own async on-failure destination routes the failed invocation to the ingestion-retry SQS queue), and that same retry queue (batch size 1, `reportBatchItemFailures: true` — each record's `body` is the JSON Lambda's destination delivers on failure, `requestPayload` is the original invocation's event, and the handler re-runs the same pipeline that payload would have triggered; a per-record failure is reported via `batchItemFailures` rather than raised). Both paths build a real `ApiSportsAdapter` (via `resolve_api_sports_key`) and run `FinalScoreIngestion` against a plain `app.dependencies.open_session()` — a new non-FastAPI counterpart to `get_session` for callers with no request/response lifecycle (all three Lambda handlers use it).
- **`feed/`'s read interface — implemented (Phase 3, feed/ unit).** `app.events.service.game_ids_for_team(session, team_id) -> list[int]` and `games_by_ids(session, ids) -> dict[int, GameRef]` (a narrow `id`/`api_sports_game_id`/`date` projection), plus the FastAPI dependency `app.events.dependencies.get_live_score_proxy() -> CachedEventProxy | None` (`None` when `Settings.api_sports_key` is empty) — see [[0x06-feed]] for what calls these and why.
- **`search/`'s sports-data filter — implemented (Phase 3, search/ unit).** `app.events.service.filter_games(session, *, season, team_id, position, limit, offset) -> list[Game]` (plain `WHERE`-clause filtering, all filters optional and AND'd, `team_id` matches home or away, `position` via JSONB containment on `player_stats`) and `distinct_seasons(session) -> list[str]` (for the year dropdown). `ALLOWED_POSITIONS` (`PG, SG, SF, PF, C, G, F` — the standard basketball set, unverified against a live API-SPORTS payload like the rest of this adapter) is the allow-list `GET /search/games`' `position` query param is validated against at the boundary. See [[0x07-search]].
