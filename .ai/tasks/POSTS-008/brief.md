# POSTS-008: the History page

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Decided

- **A quote repost is in Reposts, not Posts.** The human defined Reposts as posts
  they reposted, and the row is `is_repost`.
- **Likes order by when liked**, which is what "my likes" means. `post_likes` has
  no id column, so the cursor encodes `(created_at, post_id)`.
- **The route is `/feed/history`**, since `feed/` already assembles `PostView`
  from other modules' reads. `/users/me/history` would make `users/` import `feed/`.
- **It is an API-backed list rather than a filter on the feed**, so pagination is
  exact.

## Reuse

`features/feed` `PreparedPostNode`, its reveal and its `card-ready` behaviour. The
page keeps "a post card appears complete, not piece by piece"
(`human-decisions.md`). `components/ui/Tabs` are route tabs; `?tab=` makes them
query-driven, so check whether `Tabs` needs a small extension or `SegmentedTabs`
fits as `RecordsTab` uses it. Use the one that needs no change.

## Deploy

An index-only migration: code keeps working before it runs. Say so in the PR.

## Trap

A liked post from a soft-deleted author comes back from the query and is then
dropped by `assemble_post_views`, which can make a page short or empty while
`next_cursor` is set. Filter in the query, and test that the page is full.
