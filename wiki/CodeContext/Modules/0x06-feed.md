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

## Read interface (implemented, Phase 3)
Per the connection rule, `feed/` never queries another module's tables directly. Each read it needs is a small, typed, tested public function added to the owning module instead:
- `app.posts.service.query_feed_posts(session, *, author_ids, mentioned_game_ids, before_id, limit) -> list[Post]` — top-level posts only (`is_reply=False`; reposts included, since a repost row also has `is_reply=False`), newest first by id, `id < before_id` when given. `author_ids`/`mentioned_game_ids` are OR'd without duplicates (the mention side is a `Post.id.in_(subquery)`, not a join, specifically to avoid row multiplication from a post with several `EventMention` rows); both `None` means no filter at all (the guest feed: every post). Posts whose author is soft-deleted are excluded.
- `app.posts.service.like_counts(session, post_ids) -> dict[int, int]`, `app.posts.service.liked_post_ids(session, user_id, post_ids) -> set[int]`, `app.posts.service.mentioned_game_ids_by_post(session, post_ids) -> dict[int, list[int]]` — batch lookups keyed by post id (absent means zero/none), one call per page rather than one per post.
- `app.posts.service.replies_to(session, post_id) -> list[Post]` — direct replies only, oldest first, excluding soft-deleted authors. **Not** wired into `GET /posts/{id}/replies`: that route's existing behaviour doesn't exclude soft-deleted authors, so reusing `replies_to` there would be a behaviour change, not the pure refactor the task brief required.
- `app.media.service.processed_media_for_posts(session, post_ids) -> dict[int, list[MediaView]]` — `MediaView` (frozen dataclass: `id`, `s3_key_public`, `s3_key_thumbnail`) is media/'s own narrow projection, same shape/reasoning as `app.users.service.PublicProfile`. `Processed` status only.
- `app.events.service.game_ids_for_team(session, team_id) -> list[int]` (home or away) and `app.events.service.games_by_ids(session, ids) -> dict[int, GameRef]` — `GameRef` (frozen dataclass: `id`, `api_sports_game_id`, `date`) is events/'s narrow projection for feed/'s live-score-window heuristic (below).
- `app.events.dependencies.get_live_score_proxy() -> CachedEventProxy | None` — a FastAPI dependency, not a plain function, since it needs `Settings`. `Settings.api_sports_base_url`/`api_sports_key` are empty-string defaults; an empty `api_sports_key` (no real vendor key configured) makes this return `None`, and `feed/`'s view assembly treats a `None` proxy identically to any other live-score-unavailable case. Otherwise returns a process-level `CachedEventProxy(ApiSportsAdapter(...), InMemoryLiveScoreCache())` — no real DynamoDB cache adapter yet, same "wire the in-process one as the production default" precedent as `app.dependencies.get_event_bus`. Uses a minimal stdlib `urllib`-based `HttpClient` rather than adding `httpx` as a runtime dependency (it's `[project.optional-dependencies].dev`-only in `pyproject.toml`, for `TestClient`, not part of the Lambda image).

## Ranking strategy (implemented, Phase 3)
[[wiki/GeneralContext/Architecture/business-rules|Projects]] is explicit: "the feed can be simple." Per [[wiki/CodeContext/Standards/design-principles|Design principles]] **YAGNI** ("do not build for hypothetical future requirements") and **KISS** ("the simplest design that meets the actual requirement wins"), `feed/` ships one simple default strategy per surface, not a scored/tuned ranking algorithm. Both live in `app.feed.strategies`, built entirely on the read interface above:

- **Authenticated default** — `FollowsAndPreferredTeamStrategy(viewer_id, preferred_team_id)`: reverse-chronological `Post` feed. `author_ids` = the viewer's followed ids (`app.users.service.followed_user_ids`) **plus the viewer themself** — a judgment call: a viewer sees their own posts in their own feed, since excluding them isn't specified anywhere and would be a surprising default. `mentioned_game_ids` = `game_ids_for_team(preferred_team_id)` when one is set, else `None` (mentions aren't filtered on at all, not "match nothing"). `PostLike` is not read by this strategy directly — see PostView below for where like data actually surfaces.
- **Guest default — `GuestRecentStrategy`, resolved.** Most-recent top-level posts globally (`query_feed_posts(author_ids=None, mentioned_game_ids=None, ...)`). This was this file's one open decision (below); confirmed as the KISS reading of "a guest feed must exist" per Projects, since there's no `Follow`/`PostLike`/`preferred_team` to personalize from for an unauthenticated visitor.
- `app.feed.strategies.strategy_for(viewer: User | None) -> FeedRankingStrategy` picks between them — callers (feed/'s routes) never branch on the concrete type themselves.

Engagement-weighted ranking (scoring by likes/reposts/recency decay) is **not built now**. It is the documented extension point, not a requirement — see GoF tie-in.

## View assembly (implemented, Phase 3)
`app.feed.views.assemble_post_views(session, posts, *, viewer_id, live_scores) -> list[PostView]` is the shared function both of `feed/`'s routes call — and that `search/` (a later unit) is expected to reuse as-is, so it's public and module-level rather than a route-local helper. It batches every cross-module read into exactly one call per read function per page (no N+1).

**`PostView`** (Pydantic, `app.feed.views`):
```
id, text, is_reply, parent_post_id, is_repost, original_post_id, created_at
author: { id, username, profile_picture_media_id }
like_count, liked_by_viewer   # liked_by_viewer is always false for a guest
media: [ { id, s3_key_public, s3_key_thumbnail } ]
mentioned_game_ids: [int]
live_scores: [ { game_id, home_score, away_score, status } ]
```
A post whose author can't be resolved (soft-deleted) is silently dropped from the result rather than raised on — normally already excluded upstream by `query_feed_posts`/`replies_to`, but handled defensively here too against a soft-delete racing the call.

**Live-score window heuristic.** `Game` (`app.events.models`) has no status column — there's no "is this actually in progress" flag to check. `assemble_post_views` fills `live_scores` only for a mentioned game whose `date` falls within the last 4 hours (`now - 4h <= date <= now`); anything older, or any game in the future, gets no live score regardless of what the proxy would return. This is a documented heuristic standing in for real game state, not derived from one — revisit if `Game` ever gains a real status field. Any exception raised by, or a `None` returned from, `CachedEventProxy.get_live_score` is treated identically: no score for that game, a warning logged (the internal game id only — never PII), and the feed/thread request itself never fails because of it (tested directly against a `SportsDataSource` fake that raises).

**Replies excluded from the feed, viewer's own posts included — resolved.** `query_feed_posts` only ever returns `is_reply=False` rows, so a reply never appears as a top-level feed item (it's only reachable via `GET /feed/thread/{post_id}`); a repost does appear, since it's also `is_reply=False`. Separately, `FollowsAndPreferredTeamStrategy` folds the viewer's own id into `author_ids` (see Ranking strategy above) — both are judgment calls made in this unit, not independently specified by Projects, but the more natural reading of "feed" in each case.

## Routes (implemented, Phase 3)
`app.feed.routes` (`APIRouter(prefix="/feed")`), wired into `app.main`. Both use `get_optional_current_user` (`users/`'s dependency): no `Authorization` header is a guest request, a valid token personalizes, and a *present but invalid* token still 401s (inherited, not re-implemented here) — matching the guest-read precedent already established for posts/events.
- `GET /feed?before_id=&limit=` → `FeedPage { items: [PostView], next_before_id: int | None }`. `limit` defaults to 20, max 50, validated by FastAPI's `Query(ge=1, le=50)`. `next_before_id` is the last *queried* post's id when a full page came back (`len(posts) == limit`), else `null` — the cursor is keyed off the underlying query page, not however many `PostView`s survived view assembly, so it stays correct even if a soft-delete race silently drops one.
- `GET /feed/thread/{post_id}` → `ThreadView { root: PostView, replies: [PostView] }` — direct replies only (`replies_to`), 404 if the post doesn't exist. The frontend renders `Post`/`Thread` via one Composite interface (see GoF tie-in) and lazily expands deeper replies by calling this endpoint again on a reply's id.

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
- ~~Exact guest-feed algorithm~~ — **resolved**: most-recent top-level posts globally, `GuestRecentStrategy` (see Ranking strategy above). [[wiki/GeneralContext/Architecture/business-rules|Projects]] only required that a guest feed exist, not which heuristic it uses; a "most-engaged-with-recently" variant remains a reasonable future alternative but isn't built (YAGNI).
- **Live-score window heuristic (4 hours) is a placeholder for real game state.** `Game` has no status column, so "is this game live" is approximated from `date` alone (see View assembly above). Revisit if `events/` ever ingests a real in-progress/final status.
- **Materialized feed table**: not built now (YAGNI, no owned table per [[0x00-architecture]]'s connection rule). If per-request computation over `Post`/`Follow`/`PostLike` stops performing at RDS Postgres scale, a denormalized/precomputed feed table is the deferred option — this would also be the point at which `feed/`'s currently-unused `PostEventBus` subscription (see GoF tie-in) becomes necessary, to keep that table invalidated/updated on `PostCreated`/`PostMentionedEvent`. Not needed at current expected scale ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]] "Cheap & Low-Traffic").
