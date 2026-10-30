# POSTS-007: an undone repost must not reach the DLQ

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`0x03-posts.md` "Open decisions", from `POSTS-001`. `unrepost_post` hard-deletes
a plain repost. If that happens before the consumer runs, `_resolve_post_created`
raises `MissingReferenceError` from `_require(session, Post, detail["post_id"])`,
SQS retries, and the record lands in the DLQ for a human who has nothing to do.
It is named `POSTS-` for the decision's home; the code is in `notifications/`.

## The change

Two parts. The list hides an undone repost's notification (see "The decision").
In `_resolve_post_created`, a missing **new post** returns the same shape as a
plain post (`recipient_id` None). The parent and original
lookups keep `_require`: the FK on `parent_post_id` and `original_post_id` means
a row that exists always has them, and `unrepost_post` answers 409 instead of
deleting a repost that has a reply or is itself reposted.

## The decision: settled

The human decided on 2026-10-30: when a repost is undone, the original author's
REPOST notification is hidden. The row stays and `GET /notifications` leaves it
out, the same way `POSTS-004` handles deleted posts. `human-decisions.md` does
not record this yet; that file is the Director's.

`deleted_post_ids` cannot serve as it stands: it finds soft-deleted rows, and a
hard-deleted row is simply absent. So `posts/` gains
`existing_post_ids(session, post_ids) -> set[int]` beside it, and
`list_notifications` drops a REPOST whose `reference_id` is not in the result.
It is one more query per list. `reference_id` on a REPOST is the repost's own
id, so an undo removes exactly that row, and a repeat repost gets a new id and a
new notification. Identity ids are not reused, so an old row cannot reappear.

The filter is REPOST only. Only a plain repost is hard-deleted, and
`test_list_notifications_returns_only_own_active_notifications_most_recent_first`
lists a REPLY whose `reference_id` 999 has no row; it must keep passing unchanged.
Its REPOST row is already cleared, so the new filter does not affect it.

An email already sent for the repost cannot be recalled. This decision covers
only the list.

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

The `TODO/02-backlog.md` row and the `human-decisions.md` entry (Director);
deleting the notification row; recalling a sent email.
