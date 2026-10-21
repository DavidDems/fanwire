# 0x03 — Posts

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized.

## Module scope
`posts/` owns four tables: `Post`, `PostLike`, `EventMention`, `Report`. Covers every "Posts" business rule in [[wiki/GeneralContext/Architecture/business-rules|Projects]]: create/reply/repost, like, image attachment, game-result attachment, report (flag only), copy-link (client-side, no schema impact), and code-injection safety.

Post creation, mention resolution, the media-`Processed` gate, and cross-module fan-out are the `PublishPostFacade`/`PostEventBus`, both defined in [[0x00-architecture]] — not repeated here. That file also already states the "no moderation chain for v1" rule; this file only adds what's specific to the `Report` table.

**Implemented (Phase 2)**: `app.posts.facade.PublishPostFacade` (Facade — the single entry point, sequencing the pre-publish moderation chain → confirm attached `Media` are `Processed` → persist → attach media → resolve mentions → commit → fan-out), `app.posts.mentions` (Interpreter, `#GameId<digits>` only — see `EventMention`'s Open decisions below for the `@user`/`$TEAM` scoping call), `app.posts.moderation` (Chain of Responsibility: `ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck`, each injected against a narrow interface; `RateLimitCheck` has a real adapter since `POSTS-002` and `SpamScoreCheck` since `POSTS-003` (Security below), so the chain `get_moderation_chain` builds holds no fake; `FakeSpamScorer`/`FakeRateLimiter` are test doubles only), `app.eventbus.PostEventBus` (Observer — publishes `PostCreated`/`PostMentionedEvent`/`PostReported`; deliberately **not** placed inside `app.posts` despite the name, since `users/` publishes `UserFollowed` onto the same bus — see [[0x00-architecture]] "Cross-cutting FastAPI DI" for the same top-level-not-module-owned reasoning applied here), `app.posts.service` (`report_post`/`like_post`/`unlike_post`, plain functions matching `app.users.service`'s style).

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
- `deleted_at` — timestamptz, nullable (`POSTS-004`, revision `b2d6f9a3c8e5`): the owner's soft delete. No index: deleted rows are rare and every read already narrows on indexed columns.
- `linked_game_id` (FK → `games.id`), `linked_player_game_stats_id` (FK → `player_game_stats.id`), `linked_player_id` (FK → `players.id`), all bigint and nullable, and `linked_player_scope` (text, nullable): the post's one sports-data attachment (`POSTS-005`, revision `c7e3a5d9f1b4`). Four CHECKs: `ck_posts_one_data_link` (at most one id), `ck_posts_no_data_link_on_reply`, `ck_posts_player_scope_pairing` (the scope is set exactly with `linked_player_id`) and `ck_posts_player_scope_values` (`regular` | `playoffs`). The FKs name `events/` tables by string, a schema fact rather than a read. No index yet; `POSTS-006` adds what preferred-team relevance needs. "Sports-data attachments" below.
- No `updated_at` / edit support — no "edit a post" business rule exists in [[wiki/GeneralContext/Architecture/business-rules|Projects]], so a published post's content is never edited. **It can be soft-deleted by its owner since `POSTS-004`** ("Post deletion" below, `human-decisions.md` §9); the hard delete stays the un-repost of a plain repost (`POSTS-001`, "The repost toggle" below).

**Design principles** ([[wiki/CodeContext/Standards/design-principles|Design principles]])
- **Single source of truth / DRY** — one table for post/reply/repost instead of duplicating schema three ways; flags encode the variant.
- **KISS** — flags over inheritance/subclassing for a distinction that's purely data (reply vs. repost vs. original).
- **Fail fast** — `is_reply` implies non-null `parent_post_id` (and same for `is_repost`/`original_post_id`) should be a DB `CHECK` constraint, not an application-only assumption.
- **Immutability by default** — post content doesn't mutate after publish; `deleted_at` (the owner's soft delete, `POSTS-004`) and `reported` are the two documented exceptions, both one-way markers; `reported` is and it's a one-way flip (see Security below), which is exactly the "mutate only for a measured reason" carve-out.

**Pattern tie-in** ([[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]])
- **Composite** — `Post`/`Thread` share one interface; a thread's replies are themselves `Post` rows via `parent_post_id`. `feed/` can render/count recursively without type-checking reply vs. original.
- Post creation itself goes through `PublishPostFacade` (validation → mention resolution → media-`Processed` check → persist → fan-out) — see [[0x00-architecture]], not redefined here.

**AWS mapping** ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]])
- RDS Postgres, table `posts`. Self-referential FKs (`parent_post_id`, `original_post_id`) both indexed for thread-traversal reads. `(author_id, created_at)` indexed for the post rate limit (`POSTS-002`, revision `a8c4e1f7b3d9`).

**Security** ([[wiki/CodeContext/Standards/security|Security]])
- **Code injection**: `text` is validated/sanitized at the boundary only — Pydantic schema on the create-post request, then SQLAlchemy parameterized queries for persistence. Never string-concatenate post content into SQL or any executed context. Matches [[wiki/CodeContext/Standards/design-principles|Design principles]] "Validate at boundaries only."
- **Rate limiting** (`POSTS-002`): `app.posts.moderation.PostCountRateLimiter` counts the author's own posts, every kind (originals, replies, quote and plain reposts), in one statement over the `ix_posts_author_id_created_at` index: allowed while fewer than `POST_RATE_LIMIT_PER_MINUTE` (default 10) in the last minute **and** fewer than `POST_RATE_LIMIT_PER_HOUR` (default 100) in the last hour. The limits are the human's (2026-10-19); `PositiveInt` in `Settings`, so a bad value fails at startup. The windows slide against Postgres `now()`, the clock `created_at` defaults to, and are strict (a post exactly 60 s old no longer counts). A refusal raises `RateLimitExceeded(PostRejected)`, and `POST /posts` and `POST /posts/{post_id}/repost` answer **429** for it, 400 for every other refusal. Count-then-insert is not atomic, so posts racing at the limit can overshoot by a few: accepted for a spam limit, deliberately no lock. The DynamoDB cache check security.md once named is not built: the count needs no new infrastructure, and the edge (the WAF's per-IP rule, the API stage throttle) bounds per-IP and global load.
- **Spam score** (`POSTS-003`, deterministic heuristics, no model call: `human-decisions.md` §8): `app.posts.moderation.HeuristicSpamScorer` scores the whole `ModerationContext` as the sum of three parts, capped at 1.0. Links score 0.3 for one, 0.5 for two and 0.8 for three or more (a link is a case-insensitive `http://`, `https://` or `www.` followed by non-whitespace, matched non-overlapping; a bare `example.com` is not one). A run of 20 or more of the same non-whitespace character adds 0.5, once. An account younger than `SPAM_NEW_ACCOUNT_HOURS` (default 24) posting at least one link adds 0.5. `SpamScoreCheck` refuses at or above `SPAM_SCORE_THRESHOLD` (default 0.8, in (0, 1]), so three links refuse on their own, a run alone never does, a run with a link does, and a new account cannot post a link in its first day. The weights are constants in the scorer, and only the threshold and the age are settings. The account's creation time comes from `app.users.service.account_created_at`, injected as a callable bound to the request's session (the connection rule). An unknown author counts as new, failing safe. The clock is injected too (`datetime.now(UTC)` in production). A refusal is a plain `PostRejected` and answers **400** with `"spam score at or above threshold"`. `POST /posts/{post_id}/repost` always makes a plain repost with no text, which scores 0.0, so the scorer never refuses it. A quote repost with text goes through `POST /posts` and is scored there.

**Open decisions**
- ~~Whether a "quote repost" needs its own flag~~ — **resolved**: no separate flag. `is_repost=true` with non-empty `text` *is* a quote-repost; `is_repost=true` with null/empty `text` is a plain repost. Simplest defensible reading of "repost" per [[wiki/GeneralContext/Architecture/business-rules|Projects]], which doesn't distinguish. Implemented in `app.posts.models.Post` and enforced (both directions) via `ck_posts_repost_requires_original`.
- ~~How `Post`↔`Media` attachment is modeled~~ — resolved in [[0x04-media]]: `Media.post_id` is a nullable FK set once an uploaded image is attached to a post (no join table, no array column). `posts/` doesn't own this column; `PublishPostFacade` just requires every `Media.id` it's given to already be `Processed` before allowing publish.
- ~~Whether posts are ever deletable/soft-deletable~~ — **resolved twice.** First (the human, 2026-10-14, `POSTS-001`): **plain reposts only, by their author**, hard deleted, as the undo of the one-click repost. A plain repost is a share with no content of its own, so removing it is an undo, not an edit. Originals, replies and quote reposts stay undeletable, and `moderation/`'s `DeletePostCommand` is still not built. Hard delete, not soft: nothing of the author's own is lost.
- **A repost notification after an un-repost.** `notifications/` keys a REPOST notification on the repost's own id, with no FK, so the notification outlives the undo. Its `PostCreated` consumer also treats a missing post as a malformed event (`MissingReferenceError`, retried then dead-lettered): a repost undone before the consumer runs lands in the DLQ. The fix belongs to `notifications/` (a missing post is a no-op; maybe remove the notification on undo), outside `POSTS-001`'s paths: a follow-up.
- ~~Any thread-depth or repost-of-repost limits~~ — **resolved**: none. Not specified by any business rule; YAGNI cuts against inventing one preemptively.

**Implemented** (`app.posts.models`): `Post`, `PostLike`, `EventMention`, `Report` — bigint identity PKs throughout, `ck_posts_reply_requires_parent`/`ck_posts_repost_requires_original` CHECK constraints (DB-level fail-fast, not just an application-layer assumption), `parent_post_id`/`original_post_id` both indexed for thread-traversal, `PostLike`'s composite PK on `(user_id, post_id)` doubling as its uniqueness constraint (same pattern as `users/`'s `Follow`), `uq_reports_post_reporter` unique constraint. `EventMention.game_id` is a real `ForeignKey("games.id")` — unlike Phase 1's deferred-FK cases, `events/` already existed when this was built, so no plain-column workaround was needed. Migration `d1c029a3faee` (head, `down_revision = '532f6a3d06fd'`). No service logic, `PublishPostFacade`, `MentionParser`, moderation chain, or routes yet — models/migration only, a separate unit each.

**`feed/`'s read interface — implemented (Phase 3, feed/ unit).** `app.posts.service.query_feed_posts`, `like_counts`, `liked_post_ids`, `mentioned_game_ids_by_post`, and `replies_to` (direct replies, oldest first, excluding soft-deleted authors — deliberately not reused by `GET /posts/{id}/replies` above, since that would change that route's existing behaviour) are `posts/`'s public read functions for `feed/` (and later `search/`) to call instead of querying `Post`/`PostLike`/`EventMention` directly — see [[0x06-feed]] for the full contract.

**The repost toggle — implemented (`POSTS-001`).** `app.posts.service.repost_post`/`unrepost_post`, behind `POST`/`DELETE /posts/{post_id}/repost` (signed in; anonymous is a 401).
- **A plain repost is `is_repost` with no text (null or empty) and no attached media.** A text-less repost with an image (`/compose` allows one) has content of its own, so it is neither toggled, nor deleted, nor counted in `reposted_by_viewer`. Media is read through `app.media.service.processed_media_for_posts` (media/'s public read; attached media is always `Processed`), never media/'s table. Without this rule the `media.post_id` FK would turn the undo into a 500.
- **The target.** Reposting a plain repost reposts its original (looping, since `/compose` rows may already chain plain reposts); a quote repost is reposted as itself. `DELETE` resolves the target the same way, so the toggle is symmetric. An unknown post is a 404 on `POST`, a 204 on `DELETE`.
- **`POST`: one publish path, idempotent, race-free.** A transaction-scoped `pg_advisory_xact_lock(hashtextextended('posts.repost:{user}:{target}', 0))`, taken before the existence check, serializes a pair. With an existing plain repost it answers 200 with it (the oldest, if `/compose` made duplicates); otherwise it calls `PublishPostFacade.publish(CreatePostRequest(is_repost=True, original_post_id=target))` and answers 201, so moderation, `PostCreated` and its consumers behave as for `/compose`. The facade's commit, or a rollback on every error path, releases the lock. **No unique index**: existing rows may hold duplicates, which a migration would have to refuse or delete. A collision of the 64-bit key only makes two unrelated pairs wait.
- **`DELETE`: the first delete of a post.** Under the same lock, every plain repost the caller has of the target goes, with the `PostLike`, `Report` and `EventMention` rows that reference it, in one transaction, then 204 (also when there was nothing to remove). It never touches a quote repost, a repost with media, or another user's repost. **409, removing nothing,** when one of those reposts has a reply (re-parenting someone else's reply is not this unit's call) or is itself reposted (the `original_post_id` FK would refuse the delete). `EventMention` is a posts/ table, so the delete reaches into no other module.

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
- **Rate limiting** — reporting has no per-user limit of its own: `POSTS-002` limits publishing only, and rate-limiting likes or reports was left out of it. Only the edge controls (WAF per-IP rule, API stage throttle) bound it today.
- **No moderation workflow, by design** — this is a v1 scope boundary, not an oversight; re-confirm against [[wiki/GeneralContext/Architecture/business-rules|Projects]] before adding any status/review field.

**Open decisions**
- No admin/query surface is defined yet for anyone to actually look at accumulated `reports` rows — the table exists per the business rule, but nothing in [[wiki/GeneralContext/Architecture/business-rules|Projects]] or this wiki specifies who reads it or how.

**Post deletion — implemented (`POSTS-004`, `human-decisions.md` §9).** Supersedes the "originals, replies and quote reposts stay undeletable" half of the open decision above.
- **`DELETE /posts/{post_id}`** (`app.posts.service.delete_post`), on `get_current_user`: the author soft-deletes an original, a reply or a quote repost. 204, and 204 again on a repeat, which keeps the first `deleted_at`. 403 for someone else's post (it is public, so 404 would hide nothing), 404 for an unknown id, **409 for a plain repost**: that stays the hard delete `DELETE /posts/{original}/repost`.
- **Nothing cascades.** Likes, reports, mentions, media links, replies and reposts all stay.
- **One visibility rule, `_visible()`**: not deleted, and the author not deactivated. Every read applies it: `query_feed_posts`, `search_posts`, `replies_to` (now also `GET /posts/{id}/replies`), `reply_counts`, `repost_counts`, `posts_by_ids`, and `visible_post` (`GET /posts/{id}`, so a deactivated author's post is now a 404 there too). Recovering an account lifts only the author half, so a post deleted before or during deactivation stays deleted.
- **The repost toggle reads unfiltered on purpose.** `_repost_target`, `_plain_reposts_by` and `unrepost_post` don't apply `_visible()`, so un-reposting a deleted original still works.
- **No new interaction.** Like, unlike, repost and report on a deleted post are 404 (`_undeleted_post`); `PublishPostFacade.publish` refuses a reply or quote whose parent or original is deleted with `PostNotFoundError` (404), before moderation and the insert. An unknown id still reaches the FK, a 400. Interacting with a deactivated author's post is unchanged.
- **Placeholders.** `deleted_post_ids(session, ids)` (one query) is how `feed/` and `notifications/` learn which posts are deleted: a repost of a deleted original gets `reposted_post_deleted` true, and a deleted thread root is `root` null with `root_deleted` true ([[0x06-feed]]).
- **Media limitation, documented and not solved.** A CloudFront URL someone already obtained still works after the post is deleted. Revoking it needs signed URLs or invalidation, a separate design.

**Sports-data attachments — create implemented (`POSTS-005`, `human-decisions.md` §9).** The "game-result attachment" business rule, as one structured link instead of a `#GameId` token. Previews in read responses are `POSTS-006`.
- **`POST /posts` takes an optional `data_link`**, a discriminated union on `type`: `{"type": "game_final", "ref_id": <games.id>}`, `{"type": "player_game", "ref_id": <player_game_stats.id>}` or `{"type": "player_career", "ref_id": <players.id>, "scope": "regular" | "playoffs"}`. Each member forbids extra keys and `ref_id` is positive, so a malformed link is Pydantic's own 422 (a `detail` list).
- **`app.posts.data_link.DataLink` is the one mapping** onto the four columns and back (`columns()`, `from_columns()`). `Post.data_link` reads it back, and `PostOut.data_link` is the request's shape, with `scope` null except for a career, or null with no attachment.
- **`PublishPostFacade.publish` refuses before moderation and before anything is written**, after the deleted-parent check. Each refusal is a 422 whose `detail` is a machine code. The post-level rules come first: `data_link_on_reply`, then `data_link_needs_quote_text` (a repost with null or empty text: a plain repost shows its original's attachment), then `data_link_with_game_mention` (any `#GameId` token, as `parse_mentions` finds them). The target comes next, through `events/`' `validate_game_final` / `validate_player_game` / `validate_player_career` ([[0x02-events]]): `link_target_not_found`, `game_not_completed`, `player_did_not_play`, `no_games_in_scope`. A quote repost may carry a link, and a link coexists with an image.
- **`#GameId` and a link never coexist on a new post.** That holds until `POSTS-006` ends token parsing for new posts, alongside `FRONTEND-013`'s pickers (the human, 2026-10-21). A post without a link still gets its `EventMention` rows exactly as before.
- **The boundary.** `data_link.py` is the only new `posts/` code that reaches `events/`, and only through `app.events.service` and `app.events.errors`. `tests/posts/test_data_link.py` scans `app/posts` and allows `app.events.models` in `mentions.py` (the resolver) and `models.py` (FK registration) only.
