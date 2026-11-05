# FRONTEND-036: the home page's right column

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-05, revised the same day)

- "Remove the search [bar] that is placed at the top of the feed, at all widths:
  it is not user friendly and takes up too much space at the centre of
  attention."
- From 1152 px, a right column with the search bar, and a search's results
  shown there beside the posts. Under it a small recent-games section, which is
  `EVENTS-013`'s. This unit leaves it an empty slot.
- Below 1152 px there is no right column. Search is the Search icon
  (`FRONTEND-035`), which opens `/search`.

The reference image is the human's `landing_page.jpg`, whose right column is a
search box with lists under it.

## Decided

- **The rail is on `/` only.** The ask was about the landing page.
- **Mounted, not hidden, below 1152 px.** A hidden rail would still read search
  results and recent games on every phone. A rail that exists only on wide
  screens is not a second copy of anything, so `layout.md` §1's "move it by CSS"
  rule does not apply. The hook is the one place width reaches JavaScript.
- **Search on submit, not as you type.** Typeahead wasn't asked for, and it
  would cost a request per pause.
- **A preview, not a second results page.** Five accounts and five posts, each
  with Show all to `/search?q=`. Full post cards don't fit in 18rem, so post
  rows are compact.
- **`/?q=` is the rail's address**, so a search can be shared and reloaded, and
  Back clears it.

## Reuse

- `SearchBar`: let it submit to the current path on `/`, keyed to the address's
  `q` as now.
- `accountsKey`, `postsKey`, `fetchAccountsPage`, `fetchPostsPage`.
- `Avatar`, `StatusLine`, `InlineAlert`, `EmptyState`, `Button`.

## Traps

- `FeedPage` must not remount when `?q=` changes, or it refetches and loses the
  reader's place.
- `home-search.test.tsx` pins today's bar above the feed. It changes on purpose,
  in the test commit.
- jsdom has no `matchMedia`; stub it in the tests, never in the hook.
- The rail's sticky `top` is the header's height, as the sidebar's is.

## Later Director PR, not this spec

`FrontendUI/layout.md` §2 and `FrontendUI/layout.md` §3 for the rail and the home template.
