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

## Open decisions

- **Whether `User.description` is included in the indexed text alongside `username`.** [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] only names the `search/` module's use of `tsvector` in general terms; this doc's inclusion of `description` is a reasonable extension, not a settled requirement — confirm before implementation.
- **`tsvector` index maintenance strategy** — a `GENERATED ALWAYS AS (...) STORED` `tsvector` column with a `GIN` index (kept current automatically on every write) vs. a trigger-maintained column. Not decided; either satisfies the requirement, pick one and stay consistent per [[wiki/CodeContext/Standards/design-principles|Design principles]].
- **Exact `player_stats` field name for "position"** — depends on what API-SPORTS' NBA box score payload actually calls it; confirm against the vendor response when the `ApiSportsAdapter` ([[0x02-events]]) is implemented, since the filter query's JSONB path depends on it.
- **Pagination/result-count contract for "accounts first, posts second"** — not specified whether the UI shows a fixed top-N accounts before posts, a "show more accounts" affordance, or two independently paginated sections. Needs a decision before the search endpoint's response schema is finalized.
