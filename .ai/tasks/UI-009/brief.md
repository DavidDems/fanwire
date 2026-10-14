# UI-009 — the post card

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

The human (2026-10-14): "right now the post component is horrible, its just
the text of the post with buttons that either redirect you or change the
button state visually only." What they asked for:

- The like button is just the like icon, with "x likes" ("1 like") next to
  it. The same for replies ("x replies", "1 reply") and reposts ("x reposts",
  "1 repost").
- Like and repost counters update in real time when pressed. Replies do not:
  the reply count changes once a reply exists.
- Repost is a one-click toggle (the human's decision): press to repost, press
  again to undo.

A plain repost reaches the client today with `text: null`, so it renders as
an empty card. With `POSTS-001`'s `reposted_post`, it renders as the post it
reposts.

## Runs after

`POSTS-001` (counts, `reposted_by_viewer`, `reposted_post`, the repost
routes), merged, with `schema.d.ts` regenerated there.

`FRONTEND-010` (the thread modal and inline reply) runs after this unit. It
replaces the reply link and the "Show replies" disclosure. So in this unit,
**reply keeps going where it goes today** (`/compose?reply_to=`) and the
disclosure stays as it is. Only their look changes. Do not build the modal
here.

## Things to get right

- **One optimistic pattern.** `LikeButton` already does it: `onMutate` patches
  every cached copy through `mapCachedPosts`, and `onError` restores the
  snapshot (`features/feed/api.ts`). Repost uses the same machinery: a
  `withRepost(post, reposted)` next to `withLike`. Extend `mapCachedPosts`
  so it also reaches `reposted_post` inside a repost's view. That nested copy
  is the fourth place a post can be cached. A test liking the original
  through its repost card must see the original's own card update too.
- **A shared control.** Like, reply and repost are one `PostAction` shape:
  an icon button, its count text, a pressed state. Write it once in
  `features/feed/`.
- **Counts are text, not badges.** "12 likes" is read by a screen reader as
  it reads. Use `Intl.NumberFormat` for the number, and an explicit
  singular/plural function for the noun (no `Intl.PluralRules` cleverness for
  one English noun), tested at 0, 1, 2 and 1000.
- **Accessible names.** The button's name is the action ("Like", "Unlike",
  "Repost", "Undo repost"), and the count stays outside the button, visible
  and in the reading order. Do not put the count inside `aria-label`, where
  it would be read twice.
- **A plain repost is the original.** The header line reads
  "↻ `username` reposted" (repost icon, the reposter's name linking to their
  profile), then the original's card. Every action on it targets
  `reposted_post.id`. When `reposted_post` is null (original unavailable),
  show "This post is unavailable" in the card, not an empty one.
- **A quote repost** shows its own text and controls. Its embedded original
  is a compact card (author, time, text clamped to a few lines, no controls)
  that links to the original. Until `FRONTEND-010` adds `/posts/:id`, link
  to the original author's profile, and say so in a code comment that
  `FRONTEND-010` will replace.
- **Filled icons for pressed.** The pressed like is a filled heart and the
  pressed repost a filled or heavier repeat icon. Add the filled variants to
  `icons/index.tsx` in the lucide shape. Pressed state must not rely on
  colour alone (`FrontendUI/accessibility.md`).
- **Look and feel** follows `FrontendUI/decisions.md` "Look and feel"
  (2026-10-06) and the tokens in `src/styles/` (read only). The action row
  sits under the content, left-aligned, evenly spaced, and the counts use
  the muted text token.
- **The existing tests** in `features/feed/` that assert the old labels
  ("Like", the visible "Reply"/"Repost" words) are updated in this unit's
  tests commit, not in the implementation commit.

## Not in this task

The thread modal, the inline reply composer, and clicking a post to open it
(`FRONTEND-010`); any backend change; notifications for reposts.
