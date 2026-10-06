# FrontendUI — layout

**Agent-facing.** The app shell, the content column, how it changes at each
breakpoint, and one template per route. Mobile-first: everything below is the
phone layout unless a breakpoint says otherwise. Breakpoint and size values are
in `tokens.md` §8–§9.

## 1. The rule that keeps the tests green

**Layout is CSS only. The DOM the tests see doesn't change shape between
breakpoints.** There is one `<nav aria-label="Primary">`, rendered once in
`AppLayout` and moved by CSS: fixed to the bottom on phones, inside the header
from 640 px. Never render a second nav for desktop and hide one. jsdom applies
no media queries, so both copies would be "visible" to every test, and every
`getByRole("link", { name: "Feed" })` would find two.

Link names are pinned by tests (`routes.test.tsx`, `nav-link.test.tsx`), so a
styling unit keeps every existing link and button's **accessible name**
exactly. An icon may be added beside the text, but the text isn't replaced.

## 2. The shell (`src/routes/AppLayout.tsx`, `UI-003`)

```
phone (< 640 px)                          ≥ 640 px
┌─────────────────────────────┐           ┌──────────────────────────────────────────────┐
│ [f] fanwire          Sign in │ header    │ [f] fanwire   Feed Compose Notif. Search You │
├─────────────────────────────┤           ├──────────────────────────────────────────────┤
│                             │           │          ┌──────────── 640 ────────────┐     │
│   content column            │           │          │  content column              │     │
│   (full width − 16 px       │           │          │                              │     │
│    gutters)                 │           │          └──────────────────────────────┘     │
├─────────────────────────────┤           └──────────────────────────────────────────────┘
│ Feed Compose Notif. Search You│ nav (fixed bottom)
└─────────────────────────────┘
```

- **Skip link first.** "Skip to content" as the first focusable element,
  visually hidden until focused, targeting `<main id="main" tabindex="-1">`.
- **Header** (`<header>`, sticky top, `--color-surface`, `--shadow-1` in
  light / `--color-border` bottom edge in dark, `--z-sticky`):
  - **Left: the brand, as one link to `/`** whose accessible name is exactly
    `fanwire`. It holds the symbol at 28 px (`src/assets/brand/symbol.svg`,
    `alt=""`, decorative because the link is named by the wordmark) and the
    wordmark at 20 px high, about 93 px wide (aspect 4.66:1):
    ```html
    <picture>
      <source srcset="{wordmarkDark}" media="(prefers-color-scheme: dark)">
      <img src="{wordmarkLight}" alt="fanwire" width="93" height="20">
    </picture>
    ```
    The SVGs' own `role`/`aria-label` are ignored inside `<img>`. The `alt` is
    what names the link.
  - **Below 360 px, the symbol alone.** The wordmark's `<picture>` gets a
    visually-hidden treatment (not `display: none`, which would also remove
    the name), so the link is still named `fanwire`.
  - **The files are bundled, not served:** `UI-003` copies `brand/out/`'s two
    wordmarks and `favicon.svg` (as `symbol.svg`) into `src/assets/brand/`, so
    Vite fingerprints them. `brand/` itself never reaches the bundle or the test
    container.
  - **Right: "Sign in"** (a link styled as a secondary button) **for an
    anonymous visitor only**. A signed-in visitor has nothing here on phones,
    because everything is in the bottom bar.
- **Primary nav** (the existing `<nav aria-label="Primary">`):
  - Phone: `position: fixed; bottom: 0`, full width, five equal cells, each at
    least `--target-min` (44 px) tall, an icon above a `--font-size-xs` label,
    `padding-bottom: env(safe-area-inset-bottom)`. `<main>` gets bottom
    padding equal to the bar's height, so the last post isn't hidden.
  - ≥ 640 px: static, inline in the header after the brand, labels only
    (`--font-size-sm`, 600), no icons.
  - **Current page:** react-router's `NavLink` sets `aria-current="page"`. The
    style is a 3 px `--color-action` bar (above the label on phones, under it in
    the header) **plus** weight 600 and `--color-text`, so colour is never the
    only signal. Non-current items are `--color-text-muted`.
  - Items in the existing order (Feed, Compose, Notifications, Search, Your
    profile). "Your profile" stays conditional exactly as it is now.
- **`<main>`**: the content column, `max-width: --content-max` (640 px),
  centred, side padding `--space-4` (16 px) on phones and `--space-5` (24 px)
  from 960 px. Vertical padding `--space-5`.

**One column at every width.** A right rail (live games, trending) would be a
new feature with no data behind it today. YAGNI. The 640 px column is what a
feed reads best at, and wide screens get calm margins.

## 3. Page templates

Each view keeps its one `h1`, which is its identity in the route sweep.
"Template" here means the arrangement inside `<main>`.

| Route | View | Template |
|---|---|---|
| `/` | `FeedPage` | **Stream.** `h1` "Feed", then the post list as a stack of cards with `--space-3` between them. Each `PostNode` is a card; replies nest inside their parent card (§4). "Load more" is a full-width secondary button after the list. |
| `/compose` | `ComposePage` | **Single form card.** `h1`, one card holding the text box, mention suggestions (dropdown under the text box), image field and its preview, then a footer row: "Undo mention" (ghost) on the left, "Post" (primary) on the right. "Quick posts" is a second, quieter section below: a row of secondary buttons that wraps. |
| `/notifications` | `NotificationsPage` | **Settings strip plus list.** `h1`, then the email preference as a one-row card (checkbox and label), then the list as a single card with dividers between rows (not a card per row: rows are short, and dividers keep the list dense). |
| `/profile/:userId` | `ProfilePage` | **Identity header plus body.** A header card: avatar initial, username as `h1`, follower and following counts on one line, then Follow/Unfollow (public) on the right, wrapping under the name on phones. The description below it. On the own profile, the date of birth row ("Only you can see this") and the Settings card after it. |
| `/search` | `SearchView` (placeholder) → `FRONTEND-007` | **Search bar plus result sections.** Placeholder now: `h1` plus one muted line. `FRONTEND-007` brings a search field card, then "Accounts" and "Posts" sections, each its own list with its own "Load more", then the filter panel (`components.md` §5). |
| `/sign-in`, `/sign-up`, `/confirm`, `/forgot-password`, `/create-profile` | the five auth pages | **Narrow form card.** One card, `max-width: 25rem` (400 px), centred in the column. `h1` inside the card, the request alert at the top of the card, fields stacked, primary button full width, secondary links (e.g. "Forgotten your password?") as plain links below the card. |
| `*` | `NotFoundView` | **Message.** `h1` "Not found", the existing line, and a link back to the feed. |
| guard states | `Resolving`, `Unavailable` | **Centred status line** in the column (`StatusLine` and `InlineAlert`, `components.md`). No full-page spinner. |

## 4. Threads (the `PostNode` Composite)

Replies are `PostNode`s in an `<ol>` inside the parent's `<article>`, so
nesting comes for free from the markup and the CSS only adds indentation:

- each nested level is indented `--space-4` (16 px), with a 2 px
  `--color-border` rule on the left, so the thread line is visible without a
  card-in-card box;
- **indentation stops growing after the third level** (selector depth caps at
  48 px), so a deep thread on a 360 px phone still leaves room for the text. The
  structure still nests; only the visual indent is capped;
- a nested reply has no card background of its own: it sits on the parent
  card's surface, as part of the same card.

## 5. Stacking and scrolling

- Sticky header and fixed bottom bar: `--z-sticky`. Mention suggestions:
  `--z-dropdown`. Nothing else is positioned.
- `scroll-padding-top` equals the header height, so focusing an element or
  following a skip link never hides it under the sticky header (WCAG 2.2 SC
  2.4.11 "Focus not obscured"). On phones, `scroll-padding-bottom` clears the
  bottom bar. Both are set by the shell in `AppLayout.module.css` through
  `:global(html)`, because they are sized from the header and bar, which the
  shell owns. That is the one global rule outside `base.css`; don't add more.
- No horizontal scroll at 320 px wide. Long words and URLs wrap
  (`typography.md` §2), and media is `max-width: 100%`.
