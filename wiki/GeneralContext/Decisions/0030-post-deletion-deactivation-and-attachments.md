---
type: decision
---

# 0030 - Post deletion, account deactivation and sports-data attachments

Decision: 2026-10-17, with follow-ups on 2026-10-20, 2026-10-21 and
2026-10-22, the human.

## Context

A repository review produced a feature set the human agreed: owners deleting
their posts, users deactivating their accounts, and posts carrying structured
sports data instead of `#GameId` tokens in their text. `0x03-posts.md` then
said a published post is immutable, and a sports-data reference was a token
that the composer's `#` autocomplete inserted.

## Choice

- **Posts are soft-deletable by their owner** (`Post.deleted_at`), reversing
  "a published post is immutable". A deleted post is hidden everywhere, and a
  reference left behind shows a "Post deleted" placeholder. Restoring an
  individual post is out of scope.
- **A deleted post's thread** shows a "Post deleted" card in the root's place
  with the surviving replies under it, rather than answering not found.
- **Account deactivation is `User.deleted_at` alone.** A post is visible only
  when the post *and* its author are active. Recovery clears only the account
  marker. A deactivated account gets guest behaviour and can recover, nothing
  else, enforced on every request.
- **A non-reply post may carry one sports-data attachment**: a game's final
  score, a player's line in one game, or a player's career averages (regular
  season or playoffs, computed live). It is stored as real nullable foreign
  keys with CHECK constraints, not a generic type-and-id pair, and it coexists
  with an image.
- **Preferred-team relevance for a player's game:** a post stores the line's
  game as `linked_line_game_id`, set at create and backfilled, rather than
  `posts/` querying `events/`' line table or `events/` handing `posts/` a
  subquery.
- **`#GameId` tokens are retired.** New posts no longer turn tokens into
  mentions (`POSTS-006`). Old posts keep their mentions, which stay readable.
- **The composer's mention dropdown is removed entirely** (`#`, `$` and Undo
  mention). The attachment picker is the one way to reference sports data in a
  new post.
- **Stats pages and compose are reworked together:** the game page, box score
  and player page get "Post about this" entry points beside the composer's
  pickers, shown to signed-in viewers only.
- **Modal navigation:** Back steps through modal details. X and Escape close
  the modal and return to the originating page and its scroll position. Each
  attachment type has its own preview linking to its detail. A post card
  appears complete, not piece by piece.
- **The router migrates first:** react-router v6 to v7 is its own unit
  (`FRONTEND-016`), before the modal navigation work, so navigation is written
  once, against v7.
- **Not built:** historical stat snapshots, and revoking a media URL someone
  already obtained. Each needs a separate design.

## Consequences

The units are `USERS-003`, `EVENTS-009`, `POSTS-004` to `POSTS-006` and
`FRONTEND-011` to `FRONTEND-017`. The design lives in the module references:

- Deactivation and the account dependency paths:
  [0x01a-users-schema.md](../../CodeContext/Modules/0x01a-users-schema.md) and
  [0x01b-users-auth.md](../../CodeContext/Modules/0x01b-users-auth.md).
- The attachment read interface:
  [0x02-events.md](../../CodeContext/Modules/0x02-events.md).
- Post deletion and the attachments:
  [0x03b-posts-actions.md](../../CodeContext/Modules/0x03b-posts-actions.md);
  the legacy mentions:
  [0x03c-posts-likes-mentions.md](../../CodeContext/Modules/0x03c-posts-likes-mentions.md).
- The frontend:
  [0x08c-frontend-compose.md](../../CodeContext/Modules/0x08c-frontend-compose.md)
  (attachment picker),
  [0x08g-frontend-thread.md](../../CodeContext/Modules/0x08g-frontend-thread.md)
  (modals, previews, complete cards) and
  [0x08i-frontend-stats.md](../../CodeContext/Modules/0x08i-frontend-stats.md)
  ("Post about this").
