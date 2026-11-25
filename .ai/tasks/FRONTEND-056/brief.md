# FRONTEND-056: Skip to search

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5, deliverable 6 (`Prompts/34`, ADR 0035), "Home rail order", and the
backlog row "**The home rail after the feed in DOM order**" (origin
`FRONTEND-036`). From 76.0625em the home page is the feed, then the rail
(`SearchRail`, then `RecentGames`) in an `<aside>` after it. A keyboard reader
going from the top of `main` to the rail's search box Tabs through every card
of the feed's first page: about 150 stops at 1280 px.

## Decision: a skip link (fewer changes)

The human's rule for this deliverable is to take whichever option needs fewer
changes. The Director counted both against the tip `3084e22`:

| | Skip link | Rail before the feed |
|---|---|---|
| Source files | `HomeView.tsx` | `HomeView.tsx`, `HomeView.module.css` (`.home > :first-child` is the feed's rule, plus an `order` so the rail still shows on the right) |
| Existing tests changed | none | `home-rail.test.tsx`'s four "the rail follows the feed" cases, and its doc comment |
| CSS added | none (the shell's `skipLink` class is reused) | the reorder rules |
| Side effects | one more Tab stop in `main`, wide screens only | the rail's box, any results (up to ~12 links) and the recent games come before the feed for every keyboard reader, and the visual order (feed left, rail right) no longer matches the focus order (WCAG 2.4.3, 1.3.2) |

So: **a skip link.** The Director's lean agreed.

- **Rendered by `HomeView`, only while the rail is mounted.** Below 76.0625em
  there is no rail, so there is nothing to skip to, and the link isn't rendered.
- **Before the `.home` container, not inside it.** `HomeView.module.css`'s
  `.home > :first-child` is the feed's flex rule. A link as `.home`'s first
  child would take that rule and leave the feed unsized. A fragment around the
  link and `.home` keeps `.home`'s children exactly as they are.
- **The shell's look, by its class.** `HomeView` imports
  `./AppLayout.module.css` and uses `skipLink`: visually hidden until focused,
  then fixed at the top left above everything, where Skip to content shows.
  Both are in `routes/`, the shell owns the look, and nothing is copied.
- **It works the way the shell's does.** `href="#search-bar-q"` (the box's id,
  `SearchBar`'s exported `BOX_ID`) plus an `onClick` that focuses the box,
  because a hash link doesn't move focus in every browser (nor in jsdom).
- **The feed's `h1` stays first and only.** The link isn't a heading, and the
  rail's order is untouched, so `home-rail.test.tsx` keeps passing as written.

## The unit

- **Red first, one commit** (`test_agent`): `routes/home-rail-skip.test.tsx`
  (new), tests (a) to (e) in `task.json`, and
  `test/bundle-budgets/FRONTEND-056.ts`. Red: no "Skip to search" link
  exists. (e) and the narrow half of (d) pass today and are there to guard
  the implementation.
- **Implementation** (`code_agent`): `HomeView.tsx` only.
- **Docs** (`context_maintainer`): the "No search bar above the feed" bullet in
  `0x08h-frontend-search-games.md`.

The Director ran a prototype of tests (a) to (e) against a prototype
`HomeView` in jsdom, and it passed. One thing it showed: with an empty feed
there is no control in the feed, so the Tab after the link goes straight into
the rail. The test therefore stubs the feed with one post.

## Bundle

`HomeView` is in the entry. This spec PR refolds `BASE` at `3084e22` first.
The entry had drifted 80 B raw under the old base, and that slack would have
hidden most of this unit's growth. The Director's prototype then measured the
entry JS at +171 B raw (465,831 B) and +13 B gzip. The raw growth is past the
100 B tolerance, so the unit declares `entryJsRawGrowth: 200` and nothing else.
The prototype included FRONTEND-057's one CSS value, which moved the entry CSS
by +7 B gzip and the JS not at all.

## Traps

- **The shell's skip link first.** In (a), get to `main` the way a reader
  does: focus Skip to content, press Enter (focus is on `main`), then Tab once.
  Don't count Tabs from the body. The nav's length isn't this unit's.
- `getByRole("link", { name: "Skip to search" })` is exact. Keep it exact.
- `stubViewport` once per test, restored in `afterEach`. jsdom has no
  `matchMedia`.
- `prettier --write` on named files only: a glob also matches committed tests.
- Run the frontend suite alone, in the foreground, sharded. A killed suite
  proves nothing.

## For the Director after merge (not unit-writable)

- **`TODO/02-backlog.md`**: delete the "home rail after the feed in DOM order"
  row.
- **FrontendUI** (deliverable 8's PR): `layout.md` §2 "Skip link first" and
  `layout.md` §3 (the home page) gain the second skip link: "Skip to search", first in
  `main` on `/` from 76.0625em, the shell's look, focus to the rail's box.
  `accessibility.md`: A11 stays "Skip to content, first in the tab order";
  add a line (or a note on A11) that the home rail has its own skip link
  (2.4.1, T).
- **Browser check**, the last criterion: the Tab count before and after at
  1280 px.
