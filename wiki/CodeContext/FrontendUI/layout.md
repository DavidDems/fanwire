---
type: reference
---

# FrontendUI — layout

**Agent-facing.** The app shell, the content column, how it changes at each
breakpoint, and one template per route. Mobile-first: everything below is the
phone layout unless a breakpoint says otherwise. Breakpoint and size values are
in `tokens.md` §8 and `tokens.md` §9.

## 1. The rule that keeps the tests green

**Layout is CSS only. The DOM the tests see doesn't change shape between
breakpoints.** There is one `<nav aria-label="Primary">`, rendered once in
`AppLayout` and moved by CSS: an icon bar fixed to the bottom on phones, a left
sidebar from 640 px (§2). Never render a second nav for desktop and hide one.
jsdom applies no media queries, so both copies would be "visible" to every
test, and every `getByRole("link", { name: "Home" })` would find two.

**One exception: Search** ([ADR 0017](../../GeneralContext/Decisions/0017-navigation-and-home-rail.md); `FRONTEND-035`). The
phone bar has no room for it, so on phones Search is an icon link in the header
and the nav's own Search item is `display: none`; from 640 px the reverse. A
hidden link leaves the accessibility tree, so a reader meets exactly one. Tests
scope Search queries with `within()` to the header or the nav. Don't copy this
pattern for anything else.

**Not an exception: the home rail** (`FRONTEND-036`, `FRONTEND-039`). It exists only
from 76.0625em (1217 px) and is *mounted*, not hidden, below that (`useMediaQuery`), so it is not
a second copy of anything and a phone makes none of its requests. That hook is
the one place width reaches JavaScript.

Link names are pinned by tests (`routes.test.tsx`, `routes/sidebar-nav.test.tsx`,
`routes/AppLayout.test.tsx`), so a
styling unit keeps every existing link and button's **accessible name**
exactly. An icon may be added beside the text, but the text isn't replaced.

## 2. The shell (`src/routes/AppLayout.tsx`, `UI-003`, `FRONTEND-035`)

```
phone (< 640 px)              640-859 px                      >= 860 px (on / from 1217 px: + rail)
+------------------------+    +----------------------------+  +---------------------------------------------+
| fanwire    [S]  [av]   |    | fanwire              [av]  |  | fanwire                               [av]  |
+------------------------+    +----------------------------+  +---------------------------------------------+
|                        |    | [H]  +---- 640 ----+       |  | H Home      +---- 640 ----+  +- rail 288 -+ |
|   content column       |    | [St] | content     |       |  | St Stats    | content     |  | search     | |
|                        |    | [S]  | column      |       |  | S Search    | column      |  | results    | |
+------------------------+    | [N]  |             |       |  | N Notif.    |             |  | recent     | |
| [H]  [St]  [N]  [Out]  |    | [Out]+-------------+       |  | Out Sign out+-------------+  +------------+ |
+------------------------+    +----------------------------+  +---------------------------------------------+
  bottom icon bar               compact sidebar (72 px)          labelled sidebar (192 px)
```

- **Skip link first.** "Skip to content" as the first focusable element,
  visually hidden until focused, targeting `<main id="main" tabindex="-1">`.
- **Header** (`<header>`, sticky top, `--color-surface`, `--shadow-1` in
  light / `--color-border` bottom edge in dark, `--z-sticky`), one row of
  `--target-min` plus `--space-2` above and below (60 px):
  - **Start: the brand, as one link to `/`** whose accessible name is exactly
    `fanwire`. It holds **the cursive wordmark alone**, no symbol ([ADR 0013](../../GeneralContext/Decisions/0013-brand-mark-and-assets.md)), 28 px high and about 105 px wide (aspect 3.76:1)
    at every width:
    ```html
    <picture>
      <source srcset="{wordmarkDark}" media="(prefers-color-scheme: dark)">
      <img src="{wordmarkLight}" alt="fanwire" width="105" height="28">
    </picture>
    ```
    The `alt` is what names the link.
  - **The files are bundled, not served:** `src/assets/brand/wordmark-light.png`
    (Jet Black) and `wordmark-dark.png` (Pale Sky) are transparent 316x84 PNGs
    (3x the 28 px height), copies of `brand/out/`, so Vite fingerprints them.
    `brand/` itself never reaches the bundle or the test container.
  - **End (`.headerEnd`, pushed right with `margin-left: auto`):** on phones a
    Search icon link (24 px icon, 44 px target, `aria-current` on `/search`),
    then the **Account menu** (the avatar) for an active account, or **Sign in**
    (a secondary button link) for an anonymous visitor not on `/sign-in`. From
    640 px the header's Search is `display: none`.
  - **Large text on phones:** below 640 px the header may wrap, the end group
    on a second row, still at the right. From 640 px it stays one row, which the
    sidebar's sticky `top` relies on.
- **Primary nav** (`<nav aria-label="Primary">`, a sibling after the header,
  sharing a parent `.body` with `<main>`). Items in order: **Home** (`/`),
  **Stats** (also current on `/players/*`), **Schedule** (`FRONTEND-044`),
  **Search**, **Notifications**, then
  **Sign out**, a `<button>` as the list's last item, shown for a restored
  session that is not deactivated (its banner offers Sign out instead). Each
  item is a 24 px `aria-hidden` icon and its label in the shared
  `.visually-hidden` class, so the accessible name is always the word.
  - **Phone (< 640 px):** `position: fixed; bottom: 0`, full width, Home,
    Stats, Schedule, Notifications, Sign out (the nav's Search is hidden; five
    1fr cells are about 64 px at 320 px), icons only,
    cells at least `--target-min` tall, `padding-bottom:
    env(safe-area-inset-bottom)`. `<main>`'s bottom padding clears the bar and
    the floating buttons.
  - **640 px to 859 px:** a sticky left sidebar under the header (`top` = the
    header's height), `--sidebar-width-compact` (72 px) wide, icon only, every
    item at least `--target-min` square, transparent, with `padding-top:
    --space-5` so the first item lines up with main's top.
  - **From 53.75em (860 px, `FRONTEND-039`):** `--sidebar-width` (192 px), each
    item an icon then its visible label at `--font-size-md` on one row. Up to
    78em the sidebar and `<main>` start `--space-4` from the viewport's left
    edge, and `<main>` keeps a 36rem minimum only while it fits, so 200% text
    never overflows.
  - **The sidebar and `<main>` are one group**, `--space-5` apart; from 78em
    (1248 px) the group is centred, as before `FRONTEND-039`.
  - **Current page:** `NavLink`'s `aria-current="page"`. Weight 600 and
    `--color-text`, plus a 3 px `--color-action` bar drawn as a border on a
    `::after` (top edge in the bar, inset `--space-3`; inline-start edge in the
    sidebar, inset `--space-2`), so forced colours keep it and colour is never
    the only signal. Others are `--color-text-muted` at regular weight. Sign
    out is never current. Hover: `--color-text`, plus a `--color-surface-muted`
    fill from 640 px. Focus ring offset `-2px`, since cells touch.
- **`<main>`**: the content column, `max-width: --content-max` (640 px), side
  padding `--space-4` (16 px) on phones and `--space-5` (24 px) from 960 px.
  Vertical padding `--space-5`. **Two exceptions:**
  - `/stats/records` (`FRONTEND-030`) and `/schedule` (`FRONTEND-044`):
    `--content-max-wide` (1024 px), chosen by `AppLayout` from the route
    (`useMatch`). On `/schedule` it keeps five day cells about 190 px wide;
    at `--content-max` they were 112 px and team names broke mid-word.
  - `/` from 76.0625em (`FRONTEND-036`, `FRONTEND-039`): `.main:has(aside)` widens it to
    `--content-max` + `--space-5` + `--rail-width`, so the feed keeps its 640 px
    beside the rail. Every other route keeps `--content-max`.

**One column, except the home rail.** The only second column is the home
page's right rail from 76.0625em (1217 px, §3; [ADR 0017](../../GeneralContext/Decisions/0017-navigation-and-home-rail.md)). Every other
route stays one column.

## 3. Page templates

Each view keeps its one `h1`, which is its identity in the route sweep.
"Template" here means the arrangement inside `<main>`.

| Route | View | Template |
|---|---|---|
| `/` | `routes/HomeView`: `FeedPage`, then the rail | **Stream.** `h1` "Feed", then the post list as a stack of cards with `--space-3` between them. Each `PostNode` is a card (§4); a reply's card shows its parent in a compact box (`FRONTEND-034`, `components-map-posts.md` §5). "Load more" is a full-width secondary button after the list. **Then, from 76.0625em (1217 px), the rail** (`FRONTEND-036`, `FRONTEND-039`). No search bar above the feed at any width. From 76.0625em `HomeView` mounts an `<aside>` after the feed, `--space-5` from it: sticky at the header's height, `--rail-width` (288 px), scrolling on its own (`max-height` from `100dvh`, `overflow-y: auto`). It holds the search bar (submits to `/?q=`, a new history entry, staying on `/`), then with `?q=` a "Results for “q”" section (`h2`, Clear search beside it) with Accounts then Posts (`h3`, at most five rows each from the first page of `/search`'s own queries, each ending with Show all to `/search?q=`), then "Recent games" (`EVENTS-013`, lazy; compact cards per `FRONTEND-037`, `components-map-pages.md` §5). Post rows are compact (author, a time link opening the thread over home, three-line text). Below 76.0625em the rail isn't mounted; Search is the Search icon (§2). Composed in `routes/` so the features stay independent; the feed's `h1` is the page's only one. |
| `/compose` | `ComposePage`, in the compose modal (`routes/ComposeModal`) | **Single form card.** The dialog's title, "Compose", is its heading. One card holding the text box, then the attach row (the media paperclip, and Attach stats), then a footer row: "Undo" (ghost, walks back the last stats attach) on the left, "Post" (primary) on the right, with the failure line just above Post. |
| `/notifications` | `NotificationsPage` | **Settings strip plus list.** `h1`, then the email preference as a one-row card (checkbox and label), then the list as a single card with dividers between rows (not a card per row: rows are short, and dividers keep the list dense). |
| `/profile/:userId` | `ProfilePage` | **Identity header plus body.** A header card: avatar initial, username as `h1`, follower and following counts on one line, then Follow/Unfollow (public) on the right, wrapping under the name on phones. The description below it. On the own profile, the date of birth row ("Only you can see this") and the Settings card after it. |
| `/search` | `SearchPage` (`FRONTEND-007`) | **Search bar plus result sections.** `h1` "Search", the search bar card, then (only when `?q=` is set) "Accounts" as one list card with dividers and "Posts" as a stack of post cards, each section with its own full-width "Load more". The search box and its button are **stacked at every width**: a row would need a rule on `Field`'s wrapper, which `components-map-posts.md` §5 forbids (a `Field` row layout is in `TODO/02-backlog.md`). |
| `/sign-in`, `/sign-up`, `/confirm`, `/forgot-password`, `/create-profile` | the five auth pages | **Narrow form card.** One card, `max-width: 25rem` (400 px), centred in the column. `h1` inside the card, the request alert at the top of the card, fields stacked, primary button full width, secondary links (e.g. "Forgotten your password?") as plain links below the card. |
| `/stats/records` | `StatsNav` records home (`FRONTEND-030`) | **Card grid in the wide column** (`layout.md` §2), under one title: no one-item breadcrumb. The Historical / Seasonal view bar sits at the end of the Top records / Team / Player bar's row; on a phone the row wraps and the view bar takes its own line at the end. On Seasonal it ends the season picker's row; on a record's page it has a row of its own above the breadcrumb. The record cards are 1 column on phones, 2 from 40rem (640 px), 3 from 64rem (1024 px), `--space-3` apart. Each card's holder space is a fixed room (four body lines and the gaps, in em) with clamped lines, so an answer that lands moves nothing; the human decided to keep it (2026-11-04, `FRONTEND-030` review). At 200% text on a 360 px viewport the shell header now wraps instead of overflowing (`FRONTEND-035`, §2). |
| `/schedule` | `SchedulePage` (`FRONTEND-044`) | **Day cells in the wide column.** `h1` "Schedule", then a row with "Previous day" at the start, "Today" (only off today) and "Next day" at the end, then the day cells side by side in equal columns: 5 from 78em (1248 px), 3 from 53.75em (860 px), 1 below, the centre cell marked by an action-coloured top rule. Each cell's heading (a button) is the day; its games stack as `GameCard`s with quiet dividers. No horizontal scrolling at any width; no animated slide. |
| `*` | `NotFoundView` | **Message.** `h1` "Not found", the existing line, and a link back to the feed. |
| guard states | `Resolving`, `Unavailable` | **Centred status line** in the column (`StatusLine` and `InlineAlert`, `components.md`). No full-page spinner. |

The game page, the player page and the Stats tabs have no row here: their arrangement is in their `components-map-pages.md` §5 rows, and their behaviour in [`0x08h-frontend-search-games.md`](../Modules/0x08h-frontend-search-games.md) "Game page" and [`0x08i-frontend-stats.md`](../Modules/0x08i-frontend-stats.md) "Stats and player pages".

## 4. Threads (the `PostNode` Composite)

The thread modal (`features/thread/ThreadModal`) shows the root post's card,
then its **direct replies only**, oldest first, each its own
`PreparedPostNode` card with `showParent={false}`, in an
`<ol aria-label="Replies">`:

- the list has a `--space-3` gap and `--space-3` of left padding behind a 2 px
  `--color-border` rule on the left, so the replies read as the root's without
  a card-in-card box;
- there is no nesting, so there is no depth cap.

## 5. Stacking and scrolling

- Sticky header, fixed bottom bar and sticky sidebar: `--z-sticky`, as are
  `Dialog`'s sticky header, `FloatingButton` and the stats picker's sticky
  footer. The home rail is sticky in flow and needs no layer. The Stats team
  search's suggestions: `--z-dropdown`.
- `scroll-padding-top` equals the header height, so focusing an element or
  following a skip link never hides it under the sticky header (WCAG 2.2 SC
  2.4.11 "Focus not obscured"). On phones, `scroll-padding-bottom` clears the
  bottom bar. Both are set by the shell in `AppLayout.module.css` through
  `:global(html)`, because they are sized from the header and bar, which the
  shell owns. That is the one global rule outside `base.css`; don't add more.
- No horizontal scroll at 320 px wide. Long words and URLs wrap
  (`typography.md` §2), and media is `max-width: 100%`.
