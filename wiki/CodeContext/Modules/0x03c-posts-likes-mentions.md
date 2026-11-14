---
type: reference
---

# 0x03c — Posts: PostLike and EventMention

**Agent-facing.** Part of [[0x03-posts]] (index: module scope, the facade, moderation chain and event bus).

## PostLike
**Schema**
- `user_id` — FK → `users.User`.
- `post_id` — FK → `posts.Post`.
- `created_at` — timestamptz.
- Unique constraint on `(user_id, post_id)` — one like per user per post.
- `ix_post_likes_post_id(post_id)` (`POSTS-009`, revision `e6d7328e8881`): the primary key and `ix_post_likes_user_created_post` both lead with `user_id`, so a lookup by post alone (`GET /feed`'s "reply has a like" `EXISTS`, `like_counts`) needs this index.
- No `like_count` column on `Post` — count is derived from this table, not duplicated.

**Design principles**
- **Single source of truth** — like counts are computed from `PostLike` rows, never cached on `Post` itself, until/unless a real read-performance problem justifies a denormalized counter (see Open decisions).
- **KISS/YAGNI** — plain join table, no extra fields speculatively added.

**Pattern tie-in** — none of Composite/Interpreter/Facade apply; a like is a pure fact table, not a domain object needing a structural or behavioral pattern. **Implemented**: `app.posts.service.like_post`/`unlike_post`, same fail-fast-on-duplicate shape as `app.users.service.follow`/`unfollow`. No `PostEventBus` publish — liking isn't in [[0x00-architecture]]'s list of published events, not invented here.

**AWS mapping** — RDS Postgres, table `post_likes`, unique index on `(user_id, post_id)`, plus `ix_post_likes_user_created_post` and `ix_post_likes_post_id`.

**Security** — no free-text input, so no injection surface. [[wiki/CodeContext/Standards/security|Security]] only explicitly calls out rate-limiting for posting and reporting, not liking — see Open decisions.

**Open decisions**
- Whether `Post` needs a denormalized `like_count` for feed-rendering performance (would need an explicit invalidation/update path to stay a single source of truth).
- Whether like-spam needs its own rate limit — wiki/CodeContext/Standards/security.md doesn't mention it explicitly; flagging rather than assuming it's out of scope.

## EventMention
**Legacy, read-only:** no code creates `EventMention` rows, `PostMentionedEvent` is retired, and a `#GameId` token in post text is just text. Existing rows stay, are still read by `mentioned_game_ids_by_post` (feed, search, thread) and still count for preferred-team relevance; an old multi-game post is never collapsed into one link. Join table linking a `Post` to a `Game` row. `Game` is owned by `events/` — see [[0x02-events]], not redefined here. This is the legacy schema behind "have a sports game result as a part of a post/reply" in [[wiki/GeneralContext/Architecture/business-rules|Projects]]; new posts use a structured link ([[0x03b-posts-actions]] "Sports-data attachments").

**Schema**
- `id` — PK.
- `post_id` — FK → `posts.Post`.
- `game_id` — FK → `events.Game`.
- `raw_token` — the matched text as authored (e.g. `#GameId123`), kept for display/audit.
- `created_at` — timestamptz.
- A `Post` may have zero or more `EventMention` rows.

**Design principles**
- **Dependency Inversion / connection rule** — `posts/` references `events.Game` only by FK/ID, never by importing `events/`'s internal classes, matching [[0x00-architecture]]'s connection rule and [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]'s module boundary.

**Pattern tie-in** — None: rows are legacy and nothing creates them.

**AWS mapping** — RDS Postgres, table `event_mentions`, FK to `events.games`.

**Security**
- Injection prevention: `raw_token` is data only, never `eval`/`exec`'d or used to build dynamic SQL or templates — no executed context.
