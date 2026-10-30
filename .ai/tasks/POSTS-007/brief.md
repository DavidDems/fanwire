# POSTS-007: an undone repost must not reach the DLQ

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`0x03-posts.md` "Open decisions", from `POSTS-001`. `unrepost_post` hard-deletes
a plain repost. If that happens before the consumer runs, `_resolve_post_created`
raises `MissingReferenceError` from `_require(session, Post, detail["post_id"])`,
SQS retries, and the record lands in the DLQ for a human who has nothing to do.
It is named `POSTS-` for the decision's home; the code is in `notifications/`.

## The change

In `_resolve_post_created`, a missing **new post** returns the same shape as a
plain post (`recipient_id` None). Nothing else changes. The parent and original
lookups keep `_require`: the FK on `parent_post_id` and `original_post_id` means
a row that exists always has them, and `unrepost_post` answers 409 instead of
deleting a repost that has a reply or is itself reposted.

## The open decision: not settled, the Director decides

Should a REPOST notification survive the undo? `human-decisions.md` says nothing
about it, and `business-rules.md` only says a repost creates one. `POSTS-004`
("nothing cascades") covers soft deletes, not this hard delete.

**Recommendation: keep the row, hide it from `GET /notifications`.** `POSTS-004`
already treats a deleted post's notification that way, and today an undone
repost's entry links to `/posts/<id>`, whose id is gone (a 404, from reading the
code, not a browser check).

**This spec as written does not decide it.** It pins today's behaviour (the row
stays and is listed) and fixes only the DLQ. If the Director adopts the
recommendation, amend this spec before the unit starts: add an acceptance
criterion for the hidden entry, and add `backend/app/notifications/routes.py`,
`backend/app/posts/service.py` and `backend/tests/posts/**` to `allowed_paths`.
`deleted_post_ids` cannot serve as it stands: it finds soft-deleted rows, and a
hard-deleted row is simply absent.

## Traps

- **A missing post can't be told apart from a malformed id.** The row is gone and
  the payload is only `{post_id, author_id}`. The facade commits before it
  publishes, so a missing row means a later delete in practice. A wrong id
  becoming a silent no-op is the accepted cost. A record missing the key still
  fails.
- **Tests that pin the old rule, rewrite them in the test commit:**
  `test_post_created_for_a_nonexistent_post_fails_before_any_row` and its comment
  block in `test_consumer.py`, and
  `test_a_record_that_raises_is_reported_as_a_batch_item_failure` in
  `test_lambda_handler.py`, which uses a nonexistent post as its failing record.
- **The stale reasoning.** The consumer docstring and `0x05-notifications.md`
  (D5, 2026-10-09) both justify the old rule with "posts are never deleted".
- **Route-level test setup:** follow `tests/feed/test_repost_roundtrip.py`. Use a
  recording event bus and take the detail from it, rather than writing it by hand.

## Not in this task

The `TODO/02-backlog.md` row (Director); removing or hiding the notification.
