---
type: reference
---

# 0x03a — Posts: Post

**Agent-facing.** Part of [[0x03-posts]] (index: module scope, the facade, moderation chain and event bus).

## Post
Covers original posts, replies, and reposts as **one** table, distinguished by flags — not three tables or a subclass per kind.

**Schema**
- `id` — PK, bigint identity (see [[0x00-architecture]] Conventions).
- `author_id` is a nullable FK to `users.User`; `ck_posts_anonymous_requires_deleted` requires `deleted_at` when author is null.
- `text` — text, nullable (empty for a plain/un-quoted repost; required for original posts and replies).
- `is_reply` — boolean, default false. `parent_post_id` — FK → `posts.Post`, nullable, required when `is_reply`.
- `is_repost` — boolean, default false. `original_post_id` — FK → `posts.Post`, nullable, required when `is_repost`.
- `reported` — boolean, default false. Set true only as a side effect of the first `Report` row for this post ([[0x03d-posts-reports]]) — never set directly by a client request.
- `created_at` — timestamptz.
- `search_vector` — `TSVECTOR`, generated/persisted, GIN-indexed: `to_tsvector('english', coalesce(text, ''))` — backs `search/`'s post search, see [[0x07-search]].
- No `moderationStatus` / State-pattern field. [[0x00-architecture]] already establishes there's no moderation workflow for v1; `reported` is a plain flag, not a status machine.
- `deleted_at` — timestamptz, nullable (`POSTS-004`, revision `b2d6f9a3c8e5`): the owner's soft delete. No index: deleted rows are rare and every read already narrows on indexed columns.
- `linked_game_id` (FK → `games.id`), `linked_player_game_stats_id` (FK → `player_game_stats.id`), `linked_player_id` (FK → `players.id`), all bigint and nullable, and `linked_player_scope` (text, nullable): the post's one sports-data attachment (`POSTS-005`, revision `c7e3a5d9f1b4`). Four CHECKs: `ck_posts_one_data_link` (at most one id), `ck_posts_no_data_link_on_reply`, `ck_posts_player_scope_pairing` (the scope is set exactly with `linked_player_id`) and `ck_posts_player_scope_values` (`regular` | `playoffs`). The FKs name `events/` tables by string, a schema fact rather than a read. `linked_line_game_id` (FK → `games.id`, nullable, revision `d4f8b2e6a1c3`) stores a `player_game` link's line's game, set at create from `events/`' `player_game_previews` (that revision backfilled existing rows). `ck_posts_line_game_pairing` makes it set exactly with `linked_player_game_stats_id`. Partial indexes `ix_posts_linked_game_id` and `ix_posts_linked_line_game_id` back preferred-team relevance. [[0x03b-posts-actions]] "Sports-data attachments".
- No `updated_at` or ordinary editing ([[wiki/GeneralContext/Architecture/business-rules|Projects]]). Owner deletion is soft (`POSTS-004`); un-repost removes plain reposts. Permanent account removal is the content-erasure exception below.

**Design principles** ([[wiki/CodeContext/Standards/design-principles|Design principles]])
- **Single source of truth / DRY** — one table for post/reply/repost instead of duplicating schema three ways; flags encode the variant.
- **KISS** — flags over inheritance/subclassing for a distinction that's purely data (reply vs. repost vs. original).
- **Fail fast** — `is_reply` implies non-null `parent_post_id` (and same for `is_repost`/`original_post_id`), enforced by DB `CHECK` constraints (`ck_posts_reply_requires_parent`, `ck_posts_repost_requires_original`), not an application-only assumption.
- **Immutability by default**: ordinary content never changes; soft-delete and report markers are one-way. Permanent removal may erase content into an anonymous tombstone.

**Pattern tie-in** ([[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]])
- **Composite** — `Post`/`Thread` share one interface; a thread's replies are themselves `Post` rows via `parent_post_id`. `feed/` can render/count recursively without type-checking reply vs. original.
- Post creation itself goes through `PublishPostFacade` (validation → media-`Processed` check → persist → fan-out) — see [[0x00-architecture]], not redefined here.

**AWS mapping** ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]])
- RDS Postgres, table `posts`. Self-referential FKs (`parent_post_id`, `original_post_id`) both indexed for thread-traversal reads. `(author_id, created_at)` indexed for the post rate limit (`POSTS-002`, revision `a8c4e1f7b3d9`).

**Security** ([[wiki/CodeContext/Standards/security|Security]])
- **Code injection**: `text` is validated/sanitized at the boundary only — Pydantic schema on the create-post request, then SQLAlchemy parameterized queries for persistence. Never string-concatenate post content into SQL or any executed context. Matches [[wiki/CodeContext/Standards/design-principles|Design principles]] "Validate at boundaries only."
- **Rate limiting** (`POSTS-002`): `app.posts.moderation.PostCountRateLimiter` counts the author's own posts, every kind (originals, replies, quote and plain reposts), in one statement over the `ix_posts_author_id_created_at` index: allowed while fewer than `POST_RATE_LIMIT_PER_MINUTE` (default 10) in the last minute **and** fewer than `POST_RATE_LIMIT_PER_HOUR` (default 100) in the last hour. The limits are the human's; `PositiveInt` in `Settings`, so a bad value fails at startup. The windows slide against Postgres `now()`, the clock `created_at` defaults to, and are strict (a post exactly 60 s old no longer counts). A refusal raises `RateLimitExceeded(PostRejected)`, and `POST /posts` and `POST /posts/{post_id}/repost` answer **429** for it, 400 for every other refusal. Count-then-insert is not atomic, so posts racing at the limit can overshoot by a few: accepted for a spam limit, deliberately no lock. No DynamoDB cache check is built: the count needs no new infrastructure, and the edge (the WAF's per-IP rule, the API stage throttle) bounds per-IP and global load.
- **Spam score** (`POSTS-003`, deterministic heuristics, no model call: [[wiki/GeneralContext/Decisions/0028-improvement-roadmap-answers|ADR 0028]]): `app.posts.moderation.HeuristicSpamScorer` scores the whole `ModerationContext` as the sum of three parts, capped at 1.0. Links score 0.3 for one, 0.5 for two and 0.8 for three or more (a link is a case-insensitive `http://`, `https://` or `www.` followed by non-whitespace, matched non-overlapping; a bare `example.com` is not one). A run of 20 or more of the same non-whitespace character adds 0.5, once. An account younger than `SPAM_NEW_ACCOUNT_HOURS` (default 24) posting at least one link adds 0.5. `SpamScoreCheck` refuses at or above `SPAM_SCORE_THRESHOLD` (default 0.8, in (0, 1]), so three links refuse on their own, a run alone never does, a run with a link does, and a new account cannot post a link in its first day. The weights are constants in the scorer, and only the threshold and the age are settings. The account's creation time comes from `app.users.service.account_created_at`, injected as a callable bound to the request's session (the connection rule). An unknown author counts as new, failing safe. The clock is injected too (`datetime.now(UTC)` in production). A refusal is a plain `PostRejected` and answers **400** with `"spam score at or above threshold"`. `POST /posts/{post_id}/repost` always makes a plain repost with no text, which scores 0.0, so the scorer never refuses it. A quote repost with text goes through `POST /posts` and is scored there.

**Account fences.** Mutations use `users.lifecycle.fence_users` ([[0x01b-users-auth]]). Publish gathers actor, referenced authors and media owners before its first ordered authority lock, then holds the fences through commit. Deletion accepted earlier wins over stale request authorization; unrelated owners remain independent.

**Open decisions** — none open. Settled:
- **No quote-repost flag.** `is_repost=true` with non-empty `text` *is* a quote-repost; `is_repost=true` with null/empty `text` is a plain repost — the simplest reading of "repost" per [[wiki/GeneralContext/Architecture/business-rules|Projects]], which doesn't distinguish. Implemented in `app.posts.models.Post` and enforced (both directions) via `ck_posts_repost_requires_original`.
- **`Post`↔`Media` attachment** is `Media.post_id`, a nullable FK set once an uploaded image is attached to a post (no join table, no array column; [[0x04-media]]). `posts/` doesn't own this column; `PublishPostFacade` requires every `Media.id` it's given to already be `Processed` before allowing publish.
- **Deletion:** owner delete stays soft (`POSTS-004`, [[wiki/GeneralContext/Decisions/0030-post-deletion-deactivation-and-attachments|ADR 0030]], [[0x03b-posts-actions]] "Post deletion"); plain repost undo is hard (`POSTS-001`). Permanent removal calls `remove_account_posts` in the shared runner's local transaction: remove account likes/reports, owned-post likes/reports/mentions and unneeded owned rows. A recursive CTE preserves owned ancestors of others' dependants, erasing author/text/`linked_*` and setting `deleted_at`. Media: [[0x04-media]]; retained ids/timestamps/edges preserve others' words and [[0x06-feed]] placeholders. Deletion stages/status: [[0x01a-users-schema]], [[0x01c-users-routes]].
- **A repost notification after an un-repost is hidden** (the human's decision, `POSTS-007`): `GET /notifications` leaves it out through `existing_post_ids` (`app.posts.service`, beside `deleted_post_ids`). See [[0x05-notifications]] "Undone reposts".
- **No thread-depth or repost-of-repost limits.** Not specified by any business rule; YAGNI cuts against inventing one preemptively.

**Implemented** (`app.posts.models`): `Post`, `PostLike`, `EventMention`, `Report` — bigint identity PKs throughout, `ck_posts_reply_requires_parent`/`ck_posts_repost_requires_original` CHECK constraints (DB-level fail-fast, not just an application-layer assumption), `parent_post_id`/`original_post_id` both indexed for thread-traversal, `PostLike`'s composite PK on `(user_id, post_id)` doubling as its uniqueness constraint (same pattern as `users/`'s `Follow`), `uq_reports_post_reporter` unique constraint. `EventMention.game_id` is a real `ForeignKey("games.id")`. Migration `d1c029a3faee` (`down_revision = '532f6a3d06fd'`).

**`feed/`'s public reads.** `app.posts.service.query_feed_posts`, `query_history_posts`, `like_counts`, `liked_post_ids`, `mentioned_game_ids_by_post` and `replies_to` expose posts without cross-module table queries; [[0x06-feed]] documents the routes. `replies_to` returns direct replies, oldest first, excluding soft-deleted authors; `GET /posts/{id}/replies` also uses it ([[0x03b-posts-actions]] "Post deletion"). History selects own top-level originals, replies, plain/quote reposts or liked posts, applying `_visible()` before limiting. Posts/replies/reposts order by descending id using `ix_posts_author_id_id(author_id, id DESC)`; likes by descending `(created_at, post_id)` using `ix_post_likes_user_created_post(user_id, created_at DESC, post_id DESC)`. Index-only migration `e8a6d4c2b901` adds both.

**`search/`'s read interface.** `app.posts.service.search_posts(session, query, *, limit, offset) -> list[Post]` — full-text search over `Post.search_vector` via `websearch_to_tsquery('english', :q)`, replies included, posts whose author is soft-deleted excluded, ordered by rank desc then newest — backs `GET /search/posts`. See [[0x07-search]].
