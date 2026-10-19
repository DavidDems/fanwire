# POSTS-002 — a real per-user post rate limiter

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

`app.posts.dependencies.get_moderation_chain` wires `RateLimitCheck` against
`FakeRateLimiter(True)` as the production default, so the check can never
refuse anything. The edge controls (the CloudFront WAF's per-IP rate rule and
the API stage throttle of 50 rps) bound one IP and the whole API. They do
not bound one signed-in account posting from rotating IPs. This unit is
deliverable 1 of `wiki/GeneralContext/Prompts/08-production-hardening.md`.

**The limits are the human's (2026-10-19): 10 posts per minute and 100 per
hour, per account.** Every kind of post counts.

## The design

- **Count the author's own posts.** A `PostCountRateLimiter` in
  `app.posts.moderation`, implementing the existing `RateLimiter` interface,
  holding the `Session` and the two limits. `is_allowed(user_id)` runs
  **one** query: `count(*) FILTER (WHERE created_at > now() - interval '1
  minute')` and `count(*)` over `posts WHERE author_id = :id AND created_at >
  now() - interval '1 hour'`. It allows the post when the minute count is
  below the per-minute limit **and** the hour count is below the per-hour
  limit. No new infrastructure: `DuplicateContentCheck` already reads the
  database the same way. The DynamoDB "cache check" `security.md` and the
  `RateLimiter` docstring mention is not built; update that docstring and the
  0x03 Security bullets, which describe it as the mechanism.
- **The database clock, not Python's.** `Post.created_at` is
  `server_default=now()`, so compare against `now()` too. Clock skew between
  the Lambda and RDS then cannot open or close a window, and tests can place
  a post exactly with `created_at = now() - interval '59 seconds'` in the
  same transaction. The window boundary is strict: a post exactly 60 seconds
  old no longer counts.
- **An index.** `posts` has no index on `author_id`. Add
  `ix_posts_author_id_created_at` on `(author_id, created_at)` in the model's
  `__table_args__` and in a new Alembic revision whose `down_revision` is the
  current head. **The Migration Lambda must be invoked after the deploy**: say
  so in the PR body. The index is not required for correctness, so the app
  works in the window between the deploy and the migration.
- **429, not 400.** Add `RateLimitExceeded(PostRejected)` and raise it from
  `RateLimitCheck`. Both routes that catch `PostRejected` (`POST /posts` and
  `POST /posts/{post_id}/repost`) map it to 429 first, then keep 400 for every
  other rejection. Document the 429 in each route's `responses=` so the
  contract shows it, then regenerate (`python scripts/export_openapi.py`,
  then `npm run gen:api-types`). The frontend's `createPost` already treats
  every non-2xx as a failure, so no UI change is needed; a friendlier message
  is a follow-up, not this unit.
- **Settings, validated at the boundary.** `post_rate_limit_per_minute` and
  `post_rate_limit_per_hour`, typed as pydantic `PositiveInt`, defaults 10 and
  100. A bad environment then fails when `Settings` is built, not at the first
  post. `16-performance-tests` will loosen them per environment through
  these variables.
- **The fake stays a test double.** `FakeRateLimiter` keeps living in
  `app.posts.moderation` (same precedent as `FakeMalwareScanner`), but
  `get_moderation_chain` no longer constructs it. Update the module docstring
  of `app.posts.dependencies`, which explains why the fakes are wired today.
  `FakeSpamScorer` stays wired: that is `POSTS-003`.

## Traps

- **Existing tests may publish more than 10 posts as one author through the
  route or the facade.** Find them before writing new tests (grep the
  `backend/tests/` tree for loops that publish). Give them a loose limit (a
  `get_settings` override, or a chain override as
  `tests/feed/test_repost_roundtrip.py` already does) rather than raising the
  default. Do that in the test commit.
- **Concurrent posts may overshoot by a few.** Count-then-insert is not
  atomic, so two posts racing at the limit can both pass. That is acceptable
  for a spam limit and simpler than a lock; say so in a comment. Do not add
  an advisory lock.
- `test_get_moderation_chain_default_spam_and_rate_limit_never_reject` in
  `tests/posts/test_dependencies.py` pins today's fake wiring. Replace it in
  the test commit, keeping its spam half until `POSTS-003`.
- The statement-count test: SQLAlchemy's `before_cursor_execute` event, as
  `EVENTS-005`'s detail test does.

## Not in this task

The spam score (`POSTS-003`), rate-limiting likes or reports, a per-IP or
global limit (the WAF and the stage throttle cover those), a user-facing
"slow down" message in the frontend, and any infra change.
