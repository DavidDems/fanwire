# POSTS-009: a reply carries its parent

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

The human (2026-11-05): opening a reply shows only the reply, never what it
answers. `FRONTEND-034` puts the parent inside the reply's card, the way a quote
shows its original. `PostView` has `parent_post_id` but no parent, so without
this field every reply card would ask for its parent's thread separately.

## Decided

- **Mirror `reposted_post`.** Same shape, same one-level cut, same
  deleted/hidden split (`reposted_post_deleted`), so the card can reuse its
  `MissingOriginal` box and the reader learns one rule.
- **A plain repost as parent stands for its original**, as it does on the card
  (UI-009). Showing the repost itself would be an empty box, because the depth
  cut nulls its `reposted_post`.
- **Search gets it for free** through `assemble_post_views`; no `search/` change.
- **Liked replies join the feed (the human, 2026-11-05).** For now, a reply is
  in the feed when it has at least one like. The site has no users yet, so there
  is no signal to rank by. A smarter suggestion feed comes later, and this rule
  is a placeholder for it, not a design.
- **At its own id, not when it was liked.** The cursor is the post id.
  Ordering by like time would need a second cursor and would let one like move
  an old reply to the top.
- **Any like counts, the author's own included**, because that is what
  `like_count` shows. It means an author can surface their own reply by liking
  it. That is accepted while there are no users; the later feed replaces the
  rule.

## Why a migration

`post_likes`' primary key is `(user_id, post_id)` and its other index leads with
`user_id`, so "does this post have a like" has no index to use and would scan
the table on every feed read. An index on `post_id` alone serves the existence
check and `like_counts`.

## Reuse

`assemble_post_views` already gathers reposted originals into the batch set
before every batched read. Add parents to the same set in the same pass.

## Traps

- A reply whose parent is in the same page: build the parent's view once and
  reuse it, but give the copy inside `replied_post` its own one-level cut.
- Fixtures: `frontend/src/test/feed.ts` builds most `PostView`s; search and
  history tests have their own builders. Missing fields fail `tsc`, not a test.
