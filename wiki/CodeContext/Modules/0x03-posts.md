# 0x03 — Posts

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized.

## Module scope
`posts/` owns four tables: `Post`, `PostLike`, `EventMention`, `Report`. Covers every "Posts" business rule in [[wiki/GeneralContext/Architecture/business-rules|Projects]]: create/reply/repost, like, image attachment, game-result attachment, report (flag only), copy-link (client-side, no schema impact), and code-injection safety.

Post creation, mention resolution, the media-`Processed` gate, and cross-module fan-out are the `PublishPostFacade`/`PostEventBus`, both defined in [[0x00-architecture]] — not repeated here. That file also already states the "no moderation chain for v1" rule; this file only adds what's specific to the `Report` table.

**Implemented (Phase 2)**: `app.posts.facade.PublishPostFacade` (Facade — the single entry point, sequencing the pre-publish moderation chain → confirm attached `Media` are `Processed` → persist → attach media → resolve mentions → commit → fan-out), `app.posts.mentions` (Interpreter, `#GameId<digits>` only — see `EventMention`'s Open decisions below for the `@user`/`$TEAM` scoping call), `app.posts.moderation` (Chain of Responsibility: `ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck`, each injected against a narrow interface with no real production adapter yet — same "future work" precedent as `media/`'s `MalwareScanner`/`GuardDutyMalwareScanner`), `app.eventbus.PostEventBus` (Observer — publishes `PostCreated`/`PostMentionedEvent`/`PostReported`; deliberately **not** placed inside `app.posts` despite the name, since `users/` publishes `UserFollowed` onto the same bus — see [[0x00-architecture]] "Cross-cutting FastAPI DI" for the same top-level-not-module-owned reasoning applied here), `app.posts.service` (`report_post`/`like_post`/`unlike_post`, plain functions matching `app.users.service`'s style).

**Judgment call — `PostEventBus`'s default production wiring is currently a no-op.** `app.dependencies.get_event_bus()` constructs `PostEventBus(InMemoryEventPublisher())` as the *default*, not just a test double — no real `EventPublisher` (EventBridge `PutEvents`) adapter exists yet, so every event published through the real dependency today goes nowhere outside the process. This is consistent with Phase 2's known blockers (no `notifications/`/`feed/`/`search/` subscriber exists until Phase 3 — there is genuinely nothing to deliver to yet), but differs from the `MalwareScanner`/`RateLimiter`/`SpamScorer` precedent where only *tests* use a fake, never the real dependency wiring. Revisit once Phase 3 gives `PostEventBus` an actual subscriber — that's the natural trigger to build a real `EventBridgePublisher` adapter, not before.

## Post
Covers original posts, replies, and reposts as **one** table, distinguished by flags — not three tables or a subclass per kind.

**Schema**
- `id` — PK, bigint identity (see [[0x00-architecture]] Conventions).
- `author_id` — FK → `users.User`, not null.
- `text` — text, nullable (empty for a plain/un-quoted repost; required for original posts and replies).
- `is_reply` — boolean, default false. `parent_post_id` — FK → `posts.Post`, nullable, required when `is_reply`.
- `is_repost` — boolean, default false. `original_post_id` — FK → `posts.Post`, nullable, required when `is_repost`.
- `reported` — boolean, default false. Set true only as a side effect of the first `Report` row for this post (see below) — never set directly by a client request.
- `created_at` — timestamptz.
- `search_vector` — `TSVECTOR`, generated/persisted, GIN-indexed: `to_tsvector('english', coalesce(text, ''))` (Phase 3, `search/` unit) — backs `search/`'s post search, see [[0x07-search]].
- No `moderationStatus` / State-pattern field. [[0x00-architecture]] already establishes there's no moderation workflow for v1; `reported` is a plain flag, not a status machine.
- No `updated_at` / edit support — no "edit a post" business rule exists in [[wiki/GeneralContext/Architecture/business-rules|Projects]], so a published `Post` is treated as immutable (see Design principles below).

**Design principles** ([[wiki/CodeContext/Standards/design-principles|Design principles]])
- **Single source of truth / DRY** — one table for post/reply/repost instead of duplicating schema three ways; flags encode the variant.
- **KISS** — flags over inheritance/subclassing for a distinction that's purely data (reply vs. repost vs. original).
- **Fail fast** — `is_reply` implies non-null `parent_post_id` (and same for `is_repost`/`original_post_id`) should be a DB `CHECK` constraint, not an application-only assumption.
- **Immutability by default** — post content doesn't mutate after publish; `reported` is the one documented exception, and it's a one-way flip (see Security below), which is exactly the "mutate only for a measured reason" carve-out.

**Pattern tie-in** ([[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]])
- **Composite** — `Post`/`Thread` share one interface; a thread's replies are themselves `Post` rows via `parent_post_id`. `feed/` can render/count recursively without type-checking reply vs. original.
- Post creation itself goes through `PublishPostFacade` (validation → mention resolution → media-`Processed` check → persist → fan-out) — see [[0x00-architecture]], not redefined here.

**AWS mapping** ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]])
- RDS Postgres, table `posts`. Self-referential FKs (`parent_post_id`, `original_post_id`) both indexed for thread-traversal reads.

**Security** ([[wiki/CodeContext/Standards/security|Security]])
- **Code injection**: `text` is validated/sanitized at the boundary only — Pydantic schema on the create-post request, then SQLAlchemy parameterized queries for persistence. Never string-concatenate post content into SQL or any executed context. Matches [[wiki/CodeContext/Standards/design-principles|Design principles]] "Validate at boundaries only."
- **Rate limiting**: posting is rate-limited per user via API Gateway usage plan + a DynamoDB cache check, per wiki/CodeContext/Standards/security.md's user-generated-content section.

**Open decisions**
- ~~Whether a "quote repost" needs its own flag~~ — **resolved**: no separate flag. `is_repost=true` with non-empty `text` *is* a quote-repost; `is_repost=true` with null/empty `text` is a plain repost. Simplest defensible reading of "repost" per [[wiki/GeneralContext/Architecture/business-rules|Projects]], which doesn't distinguish. Implemented in `app.posts.models.Post` and enforced (both directions) via `ck_posts_repost_requires_original`.
- ~~How `Post`↔`Media` attachment is modeled~~ — resolved in [[0x04-media]]: `Media.post_id` is a nullable FK set once an uploaded image is attached to a post (no join table, no array column). `posts/` doesn't own this column; `PublishPostFacade` just requires every `Media.id` it's given to already be `Processed` before allowing publish.
- Whether posts are ever deletable/soft-deletable — no such business rule exists for posts (unlike `users/`'s soft-delete), and `moderation/`'s `DeletePostCommand` isn't built for v1.
- ~~Any thread-depth or repost-of-repost limits~~ — **resolved**: none. Not specified by any business rule; YAGNI cuts against inventing one preemptively.

**Implemented** (`app.posts.models`): `Post`, `PostLike`, `EventMention`, `Report` — bigint identity PKs throughout, `ck_posts_reply_requires_parent`/`ck_posts_repost_requires_original` CHECK constraints (DB-level fail-fast, not just an application-layer assumption), `parent_post_id`/`original_post_id` both indexed for thread-traversal, `PostLike`'s composite PK on `(user_id, post_id)` doubling as its uniqueness constraint (same pattern as `users/`'s `Follow`), `uq_reports_post_reporter` unique constraint. `EventMention.game_id` is a real `ForeignKey("games.id")` — unlike Phase 1's deferred-FK cases, `events/` already existed when this was built, so no plain-column workaround was needed. Migration `d1c029a3faee` (head, `down_revision = '532f6a3d06fd'`). No service logic, `PublishPostFacade`, `MentionParser`, moderation chain, or routes yet — models/migration only, a separate unit each.

**`feed/`'s read interface — implemented (Phase 3, feed/ unit).** `app.posts.service.query_feed_posts`, `like_counts`, `liked_post_ids`, `mentioned_game_ids_by_post`, and `replies_to` (direct replies, oldest first, excluding soft-deleted authors — deliberately not reused by `GET /posts/{id}/replies` above, since that would change that route's existing behaviour) are `posts/`'s public read functions for `feed/` (and later `search/`) to call instead of querying `Post`/`PostLike`/`EventMention` directly — see [[0x06-feed]] for the full contract.

**`search/`'s read interface — implemented (Phase 3, search/ unit).** `app.posts.service.search_posts(session, query, *, limit, offset) -> list[Post]` — full-text search over `Post.search_vector` via `websearch_to_tsquery('english', :q)`, replies included, posts whose author is soft-deleted excluded, ordered by rank desc then newest — backs `GET /search/posts`. See [[0x07-search]].

## PostLike
**Schema**
- `user_id` — FK → `users.User`.
- `post_id` — FK → `posts.Post`.
- `created_at` — timestamptz.
- Unique constraint on `(user_id, post_id)` — one like per user per post.
- No `like_count` column on `Post` — count is derived from this table, not duplicated.

**Design principles**
- **Single source of truth** — like counts are computed from `PostLike` rows, never cached on `Post` itself, until/unless a real read-performance problem justifies a denormalized counter (see Open decisions).
- **KISS/YAGNI** — plain join table, no extra fields speculatively added.

**Pattern tie-in** — none of Composite/Interpreter/Facade apply; a like is a pure fact table, not a domain object needing a structural or behavioral pattern. **Implemented**: `app.posts.service.like_post`/`unlike_post`, same fail-fast-on-duplicate shape as `app.users.service.follow`/`unfollow`. No `PostEventBus` publish — liking isn't in [[0x00-architecture]]'s list of published events, not invented here.

**AWS mapping** — RDS Postgres, table `post_likes`, unique index on `(user_id, post_id)`.

**Security** — no free-text input, so no injection surface. [[wiki/CodeContext/Standards/security|Security]] only explicitly calls out rate-limiting for posting and reporting, not liking — see Open decisions.

**Open decisions**
- Whether `Post` needs a denormalized `like_count` for feed-rendering performance (would need an explicit invalidation/update path to stay a single source of truth).
- Whether like-spam needs its own rate limit — wiki/CodeContext/Standards/security.md doesn't mention it explicitly; flagging rather than assuming it's out of scope.

## EventMention
Join table linking a `Post` to a `Game` row. `Game` is owned by `events/` — see [[0x02-events]], not redefined here. This is the schema behind "have a sports game result as a part of a post/reply" in [[wiki/GeneralContext/Architecture/business-rules|Projects]].

**Schema**
- `id` — PK.
- `post_id` — FK → `posts.Post`.
- `game_id` — FK → `events.Game`.
- `raw_token` — the matched text as authored (e.g. `#GameId123`, `$LAL`), kept for display/audit.
- `created_at` — timestamptz.
- A `Post` may have zero or more `EventMention` rows (multiple `$TEAM`/`#GameId` tokens in one post are not disallowed).

**Design principles**
- **Dependency Inversion / connection rule** — `posts/` references `events.Game` only by FK/ID, never by importing `events/`'s internal classes, matching [[0x00-architecture]]'s connection rule and [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]'s module boundary.

**Pattern tie-in**
- **Interpreter** — `MentionParser` parses `@user`/`#GameId`/`$TEAM` tokens out of raw post text into a mention AST (data-driven grammar, not code). `EventMention` rows are created from the AST entries that resolve to an actual `Game` row.
- This is also the mechanism for the "code injection must be impossible" rule as it applies to mentions specifically: parsed tokens are treated strictly as data used for a lookup (parameterized query against `events.Game`) — never `eval`/`exec`'d, never used to build dynamic SQL or templates.

**AWS mapping** — RDS Postgres, table `event_mentions`, FK to `events.games`.

**Security**
- Injection prevention as above (data-only tokens, parameterized lookups).
- No separate rate limit — mention resolution happens inside `PublishPostFacade` during post creation, so it's covered by the post-creation rate limit, not a second one.

**Open decisions**
- ~~What happens when `MentionParser` extracts a token that doesn't resolve to any known `Game`~~ — **resolved**: silently dropped from `EventMention` creation, post `text` kept as-authored regardless (`app.posts.mentions.resolve_mentions`).
- ~~Whether there's a per-post cap on mention count~~ — **resolved**: none. Not specified anywhere; YAGNI cuts against inventing one.
- **Scope note, also a judgment call**: `MentionParser` (`app.posts.mentions`) implements only `#GameId<digits>` tokens. The GoF reference doc's illustrative example also names `@user` and `$TEAM` tokens; neither is implemented — `@user` because no business rule calls for in-text @mentions and no schema table exists to store one (unlike `EventMention`), `$TEAM` because a bare team abbreviation doesn't identify one specific `Game` row and `EventMention.game_id` is `NOT NULL` (inventing a resolution rule like "most recent game" would be undocumented guesswork, not implementation). The literal business rule — "a sports game result" (singular, specific) — is satisfied by `#GameId` alone.

## Report
The **only** reporting-related table for v1, per [[wiki/GeneralContext/Architecture/business-rules|Projects]]'s closing line ("no moderation or reporting for now, only a reported flag on posts with a table for all reported cases"). No justification text field, no status/workflow field — see [[0x00-architecture]] for the broader "moderation chain not built for v1" statement.

**Schema**
- `id` — PK.
- `post_id` — FK → `posts.Post`.
- `reporter_id` — FK → `users.User`.
- `created_at` — timestamptz.
- Unique constraint on `(post_id, reporter_id)` — one report per user per post; re-submitting is a no-op, not a duplicate row.
- `Post.reported` is set true on the **first** `Report` row for that post and is never unset — there's no review step for it to be cleared by, by design (no moderation workflow).

**Design principles**
- **Idempotency** — the unique `(post_id, reporter_id)` constraint makes reporting the same post twice safe to retry, matching [[wiki/CodeContext/Standards/design-principles|Design principles]]'s idempotency rule.
- **KISS/YAGNI** — no status enum, no justification field, no assignee/reviewer field: none of that is called for by the current business rule, and adding it would be speculative.

**Pattern tie-in**
- None of Composite/Interpreter/Facade apply. Note explicitly: [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]'s `ReportPostCommand` (with `execute()`/`undo()` for a moderation audit trail) is **not implemented** — there's no moderation flow for it to undo into. `posts/` still publishes `PostReported` on the `PostEventBus` per [[0x00-architecture]]'s connection rule, but for v1 no `moderation/`/`reporting/` subscriber exists to consume it. **Implemented**: `app.posts.service.report_post` (plain function, matching `ReportPostCommand`'s absence — no Command object). Idempotent per the unique constraint above (a repeat `(post_id, reporter_id)` is a no-op, returns `None`, doesn't republish). **Judgment call**: publishes `PostReported` on every new, non-duplicate `Report` row — not only the post's very first report — since each new report is itself meaningful (e.g. a future consumer counting report volume), even though `Post.reported` itself only flips once and is never unset.

**AWS mapping** — RDS Postgres, table `reports`.

**Security**
- **Rate limiting** — reporting is rate-limited per user via API Gateway usage plan + DynamoDB cache check, same mechanism and same wiki/CodeContext/Standards/security.md line as post rate limiting.
- **No moderation workflow, by design** — this is a v1 scope boundary, not an oversight; re-confirm against [[wiki/GeneralContext/Architecture/business-rules|Projects]] before adding any status/review field.

**Open decisions**
- No admin/query surface is defined yet for anyone to actually look at accumulated `reports` rows — the table exists per the business rule, but nothing in [[wiki/GeneralContext/Architecture/business-rules|Projects]] or this wiki specifies who reads it or how.
