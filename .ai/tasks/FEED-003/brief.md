# FEED-003: deactivated-only follows get the guest selection

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 4, deliverable 3 (`Prompts/33`, ADR 0035; backlog row "Deactivated-only follows
still get the thin follows feed"). FEED-001 gave a viewer who follows nobody the guest
selection. `FollowsAndPreferredTeamStrategy` decides "nobody" from
`app.users.service.followed_user_ids`, which returns every `Follow` row, including those
naming a deactivated (soft-deleted) user. `query_feed_posts` then hides those authors'
posts, so a viewer whose follows are all deactivated sees only their own posts and their
team's: the thin feed FEED-001 was meant to remove.

## The unit

- **Red first, in `backend/tests/feed/`:** beside `test_feed_new_account.py`. A viewer
  follows two users, both deactivated; other users have posts. Assert the strategy's
  selection, and `GET /feed`'s ids, equal `GuestRecentStrategy`'s. Add the control: one
  active followee plus one deactivated keeps the follows feed (no unrelated author). Add
  recovery: clear `deleted_at` and the follows feed returns.
- **Implementation:** a new public read in `app.users.service` (the ids of the active
  users a viewer follows: `Follow` joined to `User` on `followed_user_id`,
  `deleted_at IS NULL`, the same shape as `following_count`), and the strategy uses it
  for both the emptiness check and `author_ids`. Leave `followed_user_ids` alone:
  `GET /users/me/following` feeds the follow button, which must still know about a
  deactivated followee.

## Traps

- Deactivate through `app.users.service.soft_delete_user` (or set `deleted_at` the way
  the existing feed tests do), not by deleting the row: a deleted row takes its `Follow`
  with it, and the test would pass for the wrong reason.
- `app/users/service.py` is shared with other units: this one runs alone (track 4 runs
  its units one at a time).
- Backend proof is CI's backend-test.
