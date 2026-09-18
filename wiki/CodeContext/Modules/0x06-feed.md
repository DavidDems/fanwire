# 0x06 — Feed

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized and [[0x00-architecture]] for module boundaries/connection rule (not repeated here).

`feed/` **owns no tables.** It is a computation layer, not a data owner: it assembles a timeline by querying other modules' data through the module boundary and ranking the result. There is no `Feed` schema to document here — see [[0x01-users]] for `User`/`Follow` and [[0x03-posts]] for `Post`/`PostLike`.

## What it computes, and from where
Per [[wiki/GeneralContext/Architecture/business-rules|Projects]] ("Feed": "the feed should draw from user likes, user follows and things like preferred team"), `feed/` reads:
- `Post` — owned by `posts/`, see [[0x03-posts]].
- `Follow` — owned by `users/`, see [[0x01-users]].
- `PostLike` — owned by `posts/`, see [[0x03-posts]].
- `User.preferred_team_id` — column on `User`, owned by `users/`, see [[0x01-users]].

All four are queried through the module boundary (typed interfaces / read APIs), not by `feed/` reaching into another module's tables directly — this is the same connection rule as everywhere else in the app ([[0x00-architecture]] "Connection rule").

## Ranking strategy
[[wiki/GeneralContext/Architecture/business-rules|Projects]] is explicit: "the feed can be simple." Per [[wiki/CodeContext/Standards/design-principles|Design principles]] **YAGNI** ("do not build for hypothetical future requirements") and **KISS** ("the simplest design that meets the actual requirement wins"), `feed/` ships one simple default strategy per surface, not a scored/tuned ranking algorithm.

- **Authenticated default** — reverse-chronological `Post` feed drawn from: users the viewer follows (`Follow`), plus posts mentioning the viewer's `preferred_team_id` (via `EventMention`, see [[0x03-posts]]). `PostLike` is read as a lightweight signal (e.g. surfacing posts a followed user liked) rather than as an input to a weighted score.
- **Guest default** — for unauthenticated visitors there is no `Follow`/`PostLike`/`preferred_team` to personalize from, so this is necessarily a different, simpler strategy: most-recent public posts globally. See Open decisions below — this exact choice is not yet confirmed.

Engagement-weighted ranking (scoring by likes/reposts/recency decay) is **not built now**. It is the documented extension point, not a requirement — see GoF tie-in.

## Design principles tie-ins
- **YAGNI** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): no scored/weighted ranking algorithm, no denormalized feed table — both would be building for a scale/complexity this project doesn't have yet.
- **KISS** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): reverse-chronological-from-follows-and-preferred-team is the simplest design that satisfies [[wiki/GeneralContext/Architecture/business-rules|Projects]]'s literal feed requirement.
- **Stateless services** ([[wiki/CodeContext/Standards/design-principles|Design principles]] "12-factor app" / "Stateless services"): feed computation happens per-request against `RDS Postgres` via the other modules' read APIs. `feed/` holds no session-held feed state on the server — a page-2 request recomputes from current data, it does not resume from a stored feed.
- **Single source of truth** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): `Post`, `Follow`, `PostLike`, and `preferred_team_id` each have exactly one owner (`posts/`, `users/`); `feed/` reads, it never copies or duplicates that state.

## GoF tie-in
`FeedRankingStrategy` (Strategy pattern, [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] "Behavioral patterns") is the extension point: chronological, engagement-weighted, and following-only variants are swappable at runtime without branching in `feed/`. Per the business rule and YAGNI above, only the chronological/follows-and-preferred-team variant is implemented now; engagement-weighted is a strategy that **can** be swapped in later without a rewrite of `feed/` — it is deliberately not built today.

[[0x00-architecture]] also lists `feed/` as a `PostEventBus` subscriber ([[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] "Observer"). Given the stateless, no-owned-table design above, `feed/` has no current material use for that subscription — there is no cache or materialized view to invalidate yet. This only becomes load-bearing if/when a materialized feed table is introduced (see Open decisions).

## AWS mapping
Per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] and [[0x00-architecture]] "AWS topology": `feed/` runs as part of the same Mangum-wrapped FastAPI app on **Lambda**, behind **API Gateway HTTP API** — no dedicated infrastructure of its own at this scale. Reads go straight to **RDS Postgres** (the system of record for `Post`, `Follow`, `PostLike`, `User`) through the owning modules' read paths. If a feed item includes a live score (a post mentioning an in-progress `Game`), `feed/` queries `CachedEventProxy` — the DynamoDB-backed short-TTL cache in front of the live sports API ([[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] "Proxy": "`feed/` and `search/` query the proxy") — indirectly, through `events/`'s interface, not DynamoDB directly.

## Security
Minimal, not invented: the guest feed must not surface anything gated behind auth, but since [[wiki/GeneralContext/Architecture/business-rules|Projects]] and [[0x01-users]] already establish that viewing posts and account pages is a read path reachable without authentication (only writes are gated — [[0x01-users]] Security), the guest feed's "most-recent public posts" default draws from data that is already unauthenticated-readable elsewhere in the app. It introduces no new exposure surface. No additional feed-specific security requirement is stated in [[wiki/CodeContext/Standards/security|Security]] or [[wiki/GeneralContext/Architecture/business-rules|Projects]] — this section intentionally has little to document.

## Open decisions
- **Exact guest-feed algorithm**: "most-recent posts globally" is the default assumed here per KISS; a "most-engaged-with-recently" variant is a reasonable alternative. [[wiki/GeneralContext/Architecture/business-rules|Projects]] only requires that a guest feed exists, not which heuristic it uses — needs confirmation from the vault owner before implementation.
- **Materialized feed table**: not built now (YAGNI, no owned table per [[0x00-architecture]]'s connection rule). If per-request computation over `Post`/`Follow`/`PostLike` stops performing at RDS Postgres scale, a denormalized/precomputed feed table is the deferred option — this would also be the point at which `feed/`'s currently-unused `PostEventBus` subscription (see GoF tie-in) becomes necessary, to keep that table invalidated/updated on `PostCreated`/`PostMentionedEvent`. Not needed at current expected scale ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]] "Cheap & Low-Traffic").
