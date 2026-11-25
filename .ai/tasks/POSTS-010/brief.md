# POSTS-010: per-user rate limits on reports and media uploads

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`Standards/security.md` "User-generated content" requires per-user limits on reporting
and uploads. Only posting has one (`POSTS-002`); `0x00b-architecture-iam-gaps.md` "Known
gaps", `0x03d-posts-reports.md` and `0x04-media.md` all record the hole. Today only the
edge bounds them (WAF per-IP rule, API stage throttle), and an open upload endpoint is a
storage-cost vector on its own.

## Decided by the human (2026-11-24)

- App-level, the `PostCountRateLimiter` pattern: counted in Postgres, refused with 429,
  limits in `Settings` as `PositiveInt`. Not API Gateway: HTTP APIs have no usage plans.
- Reports: 5 per minute and 10 per hour per user.
- Media uploads: 5 per minute and 20 per hour per user.
- A friendlier 429 message in the UI is track 5's. No frontend change here beyond the
  regenerated `schema.d.ts`.

## What exists

- `app/posts/moderation.py`: `RateLimiter` (abstract `is_allowed(user_id)`),
  `FakeRateLimiter`, and `PostCountRateLimiter` with its one-statement count
  (`count(*) FILTER (WHERE created_at > now() - interval '1 minute'), count(*)` over the
  last hour). Copy that query shape; do not reuse the class for reports, since it counts
  `posts`. The existing `RateLimiter` interface may be reused inside `app/posts` for the
  report limiter if it fits; it is not available to `app/media`.
- `app/posts/service.py` `report_post`: fences the reporter, 404s an unknown or deleted
  post, returns `None` on a repeat, otherwise inserts and publishes. The limit check
  belongs after the repeat check (a repeat stays 204 at the limit) and after the 404,
  and before the insert. Raise a dedicated exception and map it to 429 in the route.
- `app/posts/routes.py`: `_RATE_LIMITED` is the 429 responses dict for the two publish
  routes; its description says "Post rate limit exceeded", so give the report route its
  own description rather than reusing it verbatim.
- `app/media/routes.py` `create_upload`: mime check (400) first, then `fence_users`, then
  the Media insert and `generate_presigned_post`. The limit check goes after the mime
  check and before the insert. `app/media/dependencies.py` is where the limiter's
  provider goes, built from `Settings` and the request session.
- Neither `reports` nor `media` has an index on (user, created_at) today; `reports` has
  only `uq_reports_post_reporter` (post_id first, so useless here).

## Traps

- Commit by role: tests (`test_agent`), implementation (`code_agent`), wiki
  (`context_maintainer`). The migration test is a test-role commit; the migration and the
  `__table_args__` indexes are code.
- The migration test names its parent revision explicitly (the head when the branch is
  cut), as `test_migrations_post_rate_limit_index.py` explains.
- `app/media` must not import `app.posts`; the upload limiter is its own interface.
- Every Media row counts, whatever its status: a rejected or never-uploaded row still cost
  a presign. Counting only `Uploaded` would let a user bypass the limit by abandoning rows.
- Route tests that hit the limit should use the fakes; the window boundaries are proved
  once per limiter against real Postgres.
- Local testcontainers cannot start the Reaper on the Director's machine; CI's
  `backend-test` is the proof.
- Regenerate `openapi.json` and `schema.d.ts` after the routes change, or openapi-drift
  goes red.
