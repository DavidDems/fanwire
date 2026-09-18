# 0x03 — Posts

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized.

## Module scope
`posts/` owns four tables: `Post`, `PostLike`, `EventMention`, `Report`. Covers every "Posts" business rule in [[wiki/GeneralContext/Architecture/business-rules|Projects]]: create/reply/repost, like, image attachment, game-result attachment, report (flag only), copy-link (client-side, no schema impact), and code-injection safety.

Post creation, mention resolution, the media-`Processed` gate, and cross-module fan-out are the `PublishPostFacade`/`PostEventBus`, both defined in [[0x00-architecture]] — not repeated here. That file also already states the "no moderation chain for v1" rule; this file only adds what's specific to the `Report` table.

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
- Whether a "quote repost" (repost + own commentary) needs its own flag, or is just `is_repost=true` with non-empty `text` — [[wiki/GeneralContext/Architecture/business-rules|Projects]] only says "repost," doesn't distinguish.
- ~~How `Post`↔`Media` attachment is modeled~~ — resolved in [[0x04-media]]: `Media.post_id` is a nullable FK set once an uploaded image is attached to a post (no join table, no array column). `posts/` doesn't own this column; `PublishPostFacade` just requires every `Media.id` it's given to already be `Processed` before allowing publish.
- Whether posts are ever deletable/soft-deletable — no such business rule exists for posts (unlike `users/`'s soft-delete), and `moderation/`'s `DeletePostCommand` isn't built for v1.
- Any thread-depth or repost-of-repost limits — not specified.

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

**Pattern tie-in** — none of Composite/Interpreter/Facade apply; a like is a pure fact table, not a domain object needing a structural or behavioral pattern.

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
- What happens when `MentionParser` extracts a token that doesn't resolve to any known `Game`/team (game not yet ingested, typo, etc.) — silently dropped, stored as an unresolved placeholder, or rejects the whole post? Not specified in [[wiki/GeneralContext/Architecture/business-rules|Projects]].
- Whether there's a per-post cap on mention count (spam/abuse vector via mention flooding) — not specified.

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
- None of Composite/Interpreter/Facade apply. Note explicitly: [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]'s `ReportPostCommand` (with `execute()`/`undo()` for a moderation audit trail) is **not implemented** — there's no moderation flow for it to undo into. `posts/` still publishes `PostReported` on the `PostEventBus` per [[0x00-architecture]]'s connection rule, but for v1 no `moderation/`/`reporting/` subscriber exists to consume it.

**AWS mapping** — RDS Postgres, table `reports`.

**Security**
- **Rate limiting** — reporting is rate-limited per user via API Gateway usage plan + DynamoDB cache check, same mechanism and same wiki/CodeContext/Standards/security.md line as post rate limiting.
- **No moderation workflow, by design** — this is a v1 scope boundary, not an oversight; re-confirm against [[wiki/GeneralContext/Architecture/business-rules|Projects]] before adding any status/review field.

**Open decisions**
- No admin/query surface is defined yet for anyone to actually look at accumulated `reports` rows — the table exists per the business rule, but nothing in [[wiki/GeneralContext/Architecture/business-rules|Projects]] or this wiki specifies who reads it or how.
