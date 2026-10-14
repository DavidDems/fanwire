# POSTS-001 — counts, a one-click repost, and the reposted post

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

The human's post redesign (2026-10-14, `UI-009`) has the card show "x likes",
"x replies" and "x reposts". Likes and reposts update the moment the button is
pressed, and repost becomes a one-click toggle (the human's decision): press to
repost, press again to undo. Today `PostView` carries `like_count` and
`liked_by_viewer` only. There is no way to undo a repost, because posts cannot
be deleted. And a plain repost reaches the client as a post with no text, so
it renders as an empty card. This unit is the backend all three need.

## Things to get right

- **Counts are batched like `like_counts`.** Add `reply_counts`,
  `repost_counts` and `reposted_post_ids` to `app.posts.service` next to
  `like_counts`/`liked_post_ids`, one `GROUP BY` each, and call them from
  `app.feed.views.assemble_post_views` (the shared view builder; search uses
  it too, so search gets the fields for free). Exclude soft-deleted authors
  the way `replies_to` does, so a count matches what the thread shows.
- **`reposted_post` without N+1.** Collect the reposts' `original_post_id`s,
  fetch those posts in one query, and build their views in the same batched
  pass, with no recursion beyond one level. The statement-count test compares
  2 posts against 20. Use SQLAlchemy's `before_cursor_execute`, as
  `EVENTS-005`'s detail test does.
- **One publish path.** The new `POST /posts/{id}/repost` builds a
  `CreatePostRequest(is_repost=True, original_post_id=...)` and goes through
  `PublishPostFacade.publish`. The moderation chain, the `POST_CREATED` event
  and whatever consumes it then behave exactly as for `/compose`. Do not write
  a second insert.
- **Idempotent, and race-free.** A double click must not make two reposts.
  Existing data may already hold duplicates (`/compose` never prevented
  them), so a unique index would need a migration that fails or deletes
  rows. Prefer a transaction-scoped advisory lock keyed on (user, post),
  `pg_advisory_xact_lock`, taken before the existence check. If the unit
  chooses a migration instead, it must not delete or refuse existing rows,
  and its PR says the Migration Lambda must be invoked right after the
  deploy.
- **Un-repost is the first delete of a post.** `0x03-posts.md` treats posts
  as immutable, and no moderation delete exists. A plain repost is a share
  with no content of its own, so removing it is the undo the human asked for,
  not an edit. Delete the rows that reference it first (`PostLike`, `Report`,
  `EventMention`; check `notifications` and `media` for anything keyed on a
  post id), all in one transaction. A plain repost with replies is refused
  with 409: re-parenting someone else's reply is not this unit's call. Once
  `UI-009` renders a plain repost as its original, nobody can reply to or
  like the repost row from the UI, so this stays rare. Record the decision in
  `0x03-posts.md` "Open decisions" (posts deletable: now, plain reposts only,
  by their author).
- **Repost of a repost.** Point at the original when the target is a plain
  repost. A quote repost has content of its own, so it can be reposted as
  itself.
- **The frontend test kit.** New required fields on `PostView` break every
  TypeScript literal that builds one: `frontend/src/test/**` and the feature
  test files. Update them in a separate, named commit, after the contract
  regeneration (`python scripts/export_openapi.py`, then
  `npm run gen:api-types`). Change nothing else in the frontend; the UI is
  `UI-009`.

## Not in this task

Any post card change (`UI-009`), the thread modal (`FRONTEND-010`), deleting
original posts or replies, and notifications for reposts beyond what
`POST_CREATED` already triggers.
