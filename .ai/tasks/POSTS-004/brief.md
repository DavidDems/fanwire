# POSTS-004 — post soft delete

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 2 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9). An owner can delete their own post.
This **reverses `0x03-posts.md`'s "a published post is immutable"**: update
that file, and `Post`'s model docstring, which says the same.

## The design

- **`Post.deleted_at`**, nullable. A post is visible when it is not deleted
  **and** its author is active (`USERS-003`'s rule, already applied through
  `User.deleted_at` / `_live_author()`). Add one shared predicate next to
  `_live_author()` (for example `_visible()`, or `_live_post()` combined with
  it) and use it in every read: `query_feed_posts`, `search_posts`,
  `replies_to`, `reply_counts`, `repost_counts`, `posts_by_ids`, and the two
  direct-read routes in `app/posts/routes.py`. One rule, one place (DRY).
- **`DELETE /posts/{id}`**, owner only, on `get_current_user`. Idempotent:
  a repeat keeps the first timestamp. 403 for someone else's post (the post
  is public, so there is nothing to hide by answering 404).
- **The plain-repost hard delete is a separate operation and stays one.**
  `DELETE /posts/{id}` on a plain repost answers 409 and points at
  `DELETE /posts/{original}/repost`. `_repost_target`, `_plain_reposts_by` and
  `unrepost_post` keep reading rows unfiltered: un-reposting a deleted
  original must still work, so the shared visibility predicate must **not**
  be applied there. A test pins it.
- **Nothing cascades.** Likes, reports, mentions, media and replies stay. A
  reply to a deleted post stays visible on its own; a repost of one shows a
  placeholder.
- **No new interaction with a deleted post.** Like, unlike, repost, report:
  404. Creating a reply or quote repost whose parent or original is deleted:
  404, checked in `PublishPostFacade.publish` before the insert (a
  `PostNotFoundError` the route maps to 404). Today the facade lets the FK
  catch an unknown id as a 400 `IntegrityError`; leave that path as it is.
- **Placeholders, as additive fields** so the frontend keeps compiling:
  - `PostView.reposted_post_deleted: bool`: true when the view's original
    is soft-deleted (its `reposted_post` is then null). An original hidden
    only by a deactivated author keeps today's behaviour, `reposted_post`
    null and the flag false. `FRONTEND-012` renders the text.
  - **A thread whose root is deleted** (the human's decision, 2026-10-21):
    `ThreadView.root` becomes `PostView | None`, plus `root_deleted: bool`.
    It answers 200 with the surviving direct replies, so the conversation
    stays readable under a "Post deleted" card. This is the one place
    `root` can be null, so this unit makes the minimal frontend change for
    it: `ThreadModal.tsx` renders a plain `Post deleted` line instead of the
    root card, and `features/feed/api.ts`'s cache helpers tolerate a null
    root. `FRONTEND-012` owns its styling.
- **Notifications.** `GET /notifications` filters out reply and repost
  notifications whose `reference_id` is a deleted post, through a new
  `app.posts.service` batch function (for example
  `deleted_post_ids(session, ids) -> set[int]`), one query per page.
  `notifications/consumer.py` already imports `Post` for lookups; don't
  widen that.
- **Media limitation, documented not solved.** A CloudFront URL someone
  already has still works after the post is deleted. Write it in
  `0x03-posts.md`.
- **Migration.** One nullable column, no index: deleted rows will be rare,
  and every read already filters through a join or `IN` on indexed columns.
  `alembic revision` with a hand-written body, like the existing ones.

## Traps

- **`tests/feed/test_post_view_queries.py`** pins query counts. The new
  predicate must not add a query per post.
- **`posts_by_ids`** is how a repost finds its original. It must now also
  report *which* requested originals are deleted, so the view can set
  `reposted_post_deleted` without another round trip. Change its return, or
  add a sibling batch read used in the same pass.
- **Frontend fixtures.** `frontend/src/test/feed.ts`'s `testPostView` and
  `frontend/src/test/thread.ts` build typed `PostView`/`ThreadView`: give
  them the new fields' defaults in the test commit.
- **Overlap with `PERF-001`** (`agent/PERF-001`, PR #200): its perf seed
  writes posts. A nullable column with no default doesn't break an INSERT
  that omits it, but run the combination on a merged preview if #200 is
  still open when this PR is ready.
- **Overlap with `FRONTEND-011`**, which rewrites `ThreadModal.tsx`'s
  navigation in parallel. Keep this unit's change there to the root
  rendering. The second PR to merge resolves the conflict.

## Not in this task

Restoring a deleted post, revoking media URLs, the post menu and its
Delete control (`FRONTEND-012`), the "Post deleted" styling, and any
attachment work (`POSTS-005`).
