# USERS-008: delete my data

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Decided: other people's posts survive

The human asked for "the account and all data tied to it". A reply someone else
wrote to your post is that person's data, and deleting it would remove their words
because of your choice. So:

- Your posts with nothing depending on them are row-deleted.
- A post someone else's post depends on stays only as an anonymous tombstone: no
  author, no text, no links, no media. It keeps a primary key and a timestamp so
  the other posts' foreign keys hold (`ck_posts_reply_requires_parent`,
  `ck_posts_repost_requires_original`).
- The reads already handle this: a tombstone is `deleted_at` set, the same as
  `POSTS-004`, so `root_deleted` and "Post deleted" work unchanged.

A chain needs a closure: A (yours) ← B (your reply) ← C (someone else's reply)
tombstones both A and B. Compute it with a recursive CTE walking up from other
users' dependants.

## Why this order

S3 delete is idempotent and first, so failing there loses nothing and retrying is
clean. The database is one transaction. Cognito is last, since a Cognito failure
leaves an identity with no profile row, which retrying finishes, and that retry is
why the route is on the identity path. The reverse order could strand personal rows
with no credentials left to retry with.

## Traps

- `users.profile_picture_media_id` → `media.id` and `media.uploader_id` → `users.id`
  are a cycle: null the first, delete media, then the user.
- `notifications.reference_id` has no FK and is polymorphic (`users.id` for `follow`,
  `posts.id` for `reply` and `repost`). Clear by type.
- `Post.author_id: Mapped[int]` becomes `int | None`, so mypy will walk the readers.
  Feed read assembly in `backend/app/feed/views.py` filters anonymous/deleted
  tombstones before profile reads and narrows author ids before profile lookup.
  Keep the existing `root_deleted` and deleted-original repost contracts. Do not
  use casts to hide a nullable-author invariant; record the read rule in the Feed
  module reference alongside the Users and Posts references.
- API Gateway's limit is 30 s. Batch the S3 deletes (`delete_objects`, 1,000 a call).
- `test_route_auth.py` allowlists named routes. The new entry is deliberate.
- Backups are 7 days (`infra/lib/data-stack.ts`), hence the dialog's wording. If
  retention changes, the copy changes.

## Success announcement and exact scope

After deletion succeeds, sign out and clear the account cache before navigating
to `/`. The shell in `frontend/src/routes/AppLayout.tsx` owns the accessible
`StatusLine` announcing "Your account and data have been deleted.", using router
state passed with that navigation. It survives the settings page unmounting;
do not append or mutate a status element imperatively in the document.

Only that exact shell file is added to the route scope. Other route files remain
outside `allowed_paths`. The existing entry growth limits remain 2 KiB raw and
1 KiB gzip; this scope clarification does not increase any bundle allowance.

## Not in this unit

CloudFront may serve a deleted public image until its cache expires, and revoking
an obtained media URL is already recorded as not built (`human-decisions.md`).

## The permissions boundary comes first

`infra/iam/fanwire-role-boundary-policy.json` allows only
`cognito-idp:AdminGetUser`, so `AdminDeleteUser` is refused in production even
with the function's own grant, and only at the last step. No unit role can write
`infra/iam/`, and the deploy role cannot change the boundary. `deploy.yml` compares
the live policy to the repository's, so the repository file and AWS must change
together. That is one Director PR and one manual step by the human
(`infra/iam/README.md`), before this unit starts. The thread's brief lists it.

## Deploy

A migration (`author_id` nullable), an IAM change, and code that needs both. The
human approves the deploy and runs `Migration` straight after. This is a privileged
route, so run `/security-review` before the PR opens.
