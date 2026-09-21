# 0x07 — Search

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized and [[0x00-architecture]] for module boundaries/connection rule (not repeated here).

`search/` **owns no tables**. It is a query layer over data owned by other modules:
- Full-text search reads `User` (`users/`, see [[0x01-users]]) and `Post` (`posts/`, see [[0x03-posts]]).
- Plain filtering reads `Team`/`Game` (`events/`, see [[0x02-events]]).

Schemas are not redefined here — this file documents only how `search/` queries them.

## Two distinct mechanisms — do not conflate them

Per [[wiki/GeneralContext/Architecture/business-rules|Projects]] "Search", these are deliberately different implementations, not one unified search system:

| | Full-text search (accounts/posts) | Sports data filter (`Game`/`Team`) |
|---|---|---|
| Trigger | search bar (home page + dedicated search tab) | year/team/position filter controls, **no search bar** |
| Technique | Postgres `tsvector` full-text search | plain indexed-column `WHERE` filtering |
| Business rule | "searches for accounts first and posts secondly" | "no search bar for anything sports data, that will be too complex" ([[wiki/GeneralContext/Architecture/business-rules|Projects]]) |

## Accounts-first, posts-second full-text search

- Two sequential queries, not a unified ranked index: query `User` first (`tsvector` match against `username`, and by judgment `description`/bio — see Open decisions), return those results; then query `Post` (`tsvector` match against `content`), return those second. A `UNION` with a type-discriminator column is an acceptable equivalent implementation, but the ordering contract (all matching accounts before any matching posts) is fixed either way.
- No external search service (Elasticsearch/OpenSearch, etc.). [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] already justifies RDS Postgres for this domain and explicitly calls out "`tsvector` for the `search/` module" — nothing in that doc calls for dedicated search infrastructure at this scale, and [[wiki/CodeContext/Standards/design-principles|Design principles]]'s **KISS**/**YAGNI** rules mean one is not added speculatively.
- Runs as ordinary SQLAlchemy queries inside the same FastAPI app as every other endpoint — no separate service, no separate deploy unit.

## Sports data filter (year / team / position)

- **Not full-text search.** [[wiki/GeneralContext/Architecture/business-rules|Projects]] explicitly rejects a search bar for sports data ("that will be too complex") — this is plain `WHERE`-clause filtering on indexed columns of `Game`/`Team`, selected via UI filter controls (dropdowns/pickers), not a free-text query.
- **Year** and **team** filter directly against `Game` columns (`date`/`season`, `home_team_id`/`away_team_id`) and `Team` columns, as documented in [[0x02-events]].
- **Position** does **not** join to a `Player` table — [[0x02-events]] is explicit that no standalone `Player`/`PlayerSeasonStat` table exists for v1. A position filter queries into `Game.player_stats`, the embedded JSONB per-game box score, via a JSONB containment/path query (e.g. matching a `position` field inside each `player_stats` array entry, if API-SPORTS' box score payload carries one — confirm field name at ingestion-adapter implementation time). This is consistent with [[0x02-events]]'s existing open decision flagging that indexed-column queries over individual `player_stats` fields may eventually justify normalizing out of JSONB — that decision is not re-litigated here, just inherited.
- `search/` may query `events/` data through the same `CachedEventProxy` that `feed/` uses for live-score reads ([[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] Proxy section: "`feed/` and `search/` query the proxy") when a filter result includes in-progress games; completed-game filtering reads `Game` directly since there's nothing live to cache.

## Design principles tie-ins

- **KISS** ([[wiki/CodeContext/Standards/design-principles|Design principles]]) — two straightforward queries (or one `UNION`) beat a unified ranked/scored search index for a requirement that only asks for "accounts first, posts second." No relevance scoring, no merged ranking model.
- **YAGNI** ([[wiki/CodeContext/Standards/design-principles|Design principles]]) — no external search service, no speculative sports-data search bar the business rule explicitly rejects as unneeded complexity.
- **Validate at boundaries only** ([[wiki/CodeContext/Standards/design-principles|Design principles]]) — the search bar's raw text and the sports-data filter's year/team/position selections are both untrusted user input, validated once at the Pydantic request-schema boundary (type, length, allow-listed filter values); everything downstream (SQLAlchemy query construction) trusts that validated, typed input.

## GoF pattern tie-in

No GoF pattern in [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] cleanly describes a Postgres `tsvector` query layer or plain column filtering — say so plainly rather than forcing a fit. The one genuine, already-documented connection is **Proxy** (`CachedEventProxy`): that doc lists `search/` as a consumer of the same proxy `feed/` uses for live event data, which is why the sports-data filter section above routes in-progress-game reads through it. Beyond that, `search/` is plumbing, not a pattern participant.

## AWS mapping

- **RDS Postgres** — `tsvector` full-text search and the plain `Game`/`Team` filters both run as SQL against the same Postgres instance that is the system of record for every table in this wiki ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]], [[0x00-architecture]]).
- Runs inside the same **Lambda (via Mangum-wrapped FastAPI)** behind **API Gateway HTTP API** as the rest of the app — no dedicated search infrastructure, no separate compute or datastore.
- **DynamoDB** involvement is limited to `CachedEventProxy`'s existing short-TTL live-score cache (per [[0x00-architecture]]) — `search/` never gets its own DynamoDB table.

## Security

- **Code injection is impossible in the search bar** ([[wiki/GeneralContext/Architecture/business-rules|Projects]]): enforced by SQLAlchemy parameterized queries only — search terms are never string-concatenated into SQL, per [[wiki/CodeContext/Standards/design-principles|Design principles]] "Validate at boundaries only" and the OWASP ASVS baseline in [[wiki/CodeContext/Standards/security|Security]] ("All input validated at the boundary ... never trust client input"). Pydantic validates the raw search-term and filter-value shapes at the API boundary before any query is built.
- Same requirement applies to the sports-data filter inputs (year/team/position) even though they're not free text — filter values are validated/allow-listed at the boundary, never interpolated directly into a query string.
- No search-specific rate limiting is called out in [[wiki/CodeContext/Standards/security|Security]] beyond what already applies to every endpoint: **API Gateway usage-plan throttling** (see [[wiki/CodeContext/Standards/security|Security]] "Edge / application protection" — rate limiting/request validation enforced at API Gateway as a second layer behind WAF). No additional search-specific security control is invented beyond that.

## Implemented (Phase 3, `search/` unit)

`search/` is now a real module (`app/search/`) — it still owns no tables, only routes/schemas/orchestration, exactly as designed above. Cross-module reads go through each owning module's tested public search/filter function, never through `search/` querying `User`/`Post`/`Game` directly:
- `app.users.service.search_users(session, query, *, limit, offset) -> list[User]` reads `app.users.models.User.search_vector`.
- `app.posts.service.search_posts(session, query, *, limit, offset) -> list[Post]` reads `app.posts.models.Post.search_vector`.
- `app.events.service.filter_games(session, *, season, team_id, position, limit, offset) -> list[Game]` and `distinct_seasons(session) -> list[str]`.

This is the concrete shape of "each owning module exposes a tested public search/filter function" from the top of this file — `search/`'s own module (`app/search/routes.py`) is thin orchestration + response-schema mapping only, per [[0x00-architecture]]'s Connection rule.

### Routes (`app.search.routes`, `APIRouter(prefix="/search")`)
- `GET /search/accounts?q=&limit=&offset=` → `{items: AccountResult[], next_offset: int | None}`. `AccountResult` = `{id, username, description, profile_picture_media_id}` — never `date_of_birth` (see [[0x01-users]]'s DOB-privacy rule).
- `GET /search/posts?q=&limit=&offset=` → `{items: PostView[], next_offset}`, built with `app.feed.views.assemble_post_views` (viewer via `get_optional_current_user`, live scores via `get_live_score_proxy`) — the same cross-module view-assembly `feed/`'s own routes use, per this file's original design ("`search/` is plumbing, not a pattern participant" beyond Proxy).
- `GET /search/games?season=&team_id=&position=&limit=&offset=` → `{items: GameOut[], next_offset}`, reusing `events/`'s own `GameOut` schema.
- `GET /search/games/filters` → `{seasons: [str], positions: [str]}`. Teams are **not** duplicated here — the frontend calls the existing `GET /events/teams`.
- Every route validates at the boundary: `q` is 1–100 chars (Pydantic/Query `min_length`/`max_length`) and stripped before use; `limit` is 1–50 (default 20); `offset` ≥ 0; `position` is checked against `ALLOWED_POSITIONS` and returns **422** on an unknown value, never silently ignored or passed through to a query that would just match nothing.
- `next_offset = offset + limit` when a full page (`len(items) == limit`) came back, else `null` — same contract `feed/` uses for `next_before_id`, adapted to offset pagination since full-text search results aren't naturally cursor-ordered by id.

### Resolved decisions
- ~~Whether `User.description` is included in the indexed text alongside `username`~~ — **resolved: yes.** `User.search_vector` is `to_tsvector('simple', username || ' ' || coalesce(description, ''))`.
- ~~`tsvector` index maintenance strategy~~ — **resolved: `GENERATED ALWAYS AS (...) STORED` + `GIN`, not a trigger.** Both `User.search_vector` and `Post.search_vector` are Postgres generated, persisted columns — kept current automatically on every `INSERT`/`UPDATE`, no application code or trigger needed to maintain them. `Post.search_vector` is `to_tsvector('english', coalesce(text, ''))`. Both are `GIN`-indexed (`ix_users_search_vector`, `ix_posts_search_vector`).
- ~~Exact `player_stats` field name for "position"~~ — resolved as `"position"` in [[0x02-events]] (unchanged by this unit). `Game.player_stats` also now has a `GIN` index with the `jsonb_path_ops` opclass (`ix_games_player_stats_gin`), the right fit for the `@>` containment queries `filter_games`'s position filter runs.
- ~~Pagination/result-count contract for "accounts first, posts second"~~ — **resolved: two independently paginated sections**, per the Routes section above. `GET /search/accounts` and `GET /search/posts` each have their own `limit`/`offset`/`next_offset` — "accounts first" is purely a frontend rendering order (it shows the accounts section before the posts section), not a combined backend cursor or a fixed top-N cutoff.

### Security — injection safety, concretely
- `search_users` builds its tsquery by tokenizing the raw input (splitting on whitespace, keeping only `[A-Za-z0-9_]` per token, dropping empties) and joining survivors as `"tok1:* & tok2:* ..."` for prefix matching. That string is passed to `to_tsquery('simple', :q)` as a bound parameter (`func.to_tsquery("simple", tsquery_str)`), never string-interpolated into SQL text. If no token survives tokenization, `search_users` returns `[]` without ever querying the database.
- `search_posts` queries with `websearch_to_tsquery('english', :q)`, `query` bound as a parameter — `websearch_to_tsquery` is designed to tolerate arbitrary user text (quotes, operators, punctuation) without raising, so no pre-tokenization is needed on the posts side.
- `filter_games`'s position filter uses SQLAlchemy's JSONB `.contains()` comparator (`Game.player_stats.contains([{"position": position}])`), which compiles to `player_stats @> :param` with the value bound, never string-built SQL.
- Verified in `tests/users/test_search.py`, `tests/posts/test_search.py`, and `tests/search/test_routes.py`: queries containing `'`, `;`, `--`, `:*`, `&|!()`, and `%` all return normally (200, empty or unaffected results), never a 500 or a raised SQL error.
