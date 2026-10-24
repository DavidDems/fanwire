# FrontendUI — components

**Agent-facing.** The shared building blocks, their variants and states, the
sports-specific pieces, and a map from every existing component and view to the
ones it uses. Token names are from `tokens.md`. A styling unit is handed this
file, `tokens.md`, and the section of `layout.md` for its route.

## 1. Where styles live

| What | Where | Who writes it |
|---|---|---|
| Tokens | `src/styles/tokens.css` | `UI-001` only. Later changes go through the human (`decisions.md`) |
| Element defaults (reset, body, headings, links, native form controls, focus, `.visually-hidden`) | `src/styles/base.css` | `UI-001` |
| Shared components | `src/components/ui/<Name>.tsx` + `<Name>.module.css` | `UI-002`; later units may **add** one, never restyle another unit's |
| Feature styles | next to the component: `src/features/feed/PostNode.module.css` etc. | the feature's unit |

**Native controls are styled by `base.css`, keyed on attributes that already
exist.** Every form in the app uses plain `input`, `select`, `textarea` and
`button` inside `FormField`'s `Field`, which already sets `aria-invalid` and
`aria-describedby`. So the error ring is `[aria-invalid="true"]`, the disabled
look is `:disabled`, and the focus ring is `:focus-visible`, with no class on
any control. That's why most auth and settings forms need almost no
feature-level CSS. A native `<button>` (and a file input's
`::file-selector-button`) defaults to the **secondary** look, inside
`:where()` so any module class wins. Until each feature moves its buttons onto
`Button`, they are readable instead of the browser's grey button face, which
in dark mode put Pale Sky on `#6b6b6b` (`src/styles/native-buttons.test.ts`).

**Soft filled (`UI-010`, the human 2026-10-23).** Every text-like `input`,
`select` and `textarea`: no border at rest, a `--color-field` fill,
`--radius-lg`, `--space-4` either side, 48 px (`3rem`) tall for the
single-line ones, the label above (`Field`). The fill alone is under 3:1
(`tokens.md` §5), so a 1 px `--color-border-strong` bottom rule, drawn as an
inset box-shadow, stays in every state. Focus: the fill becomes
`--color-field-focus` and the `:focus-visible` ring appears; nothing moves (no
border, padding or size changes on focus). Invalid: a 2 px `--color-danger`
ring at rest, beside the rule, never a border. A `select` has
`appearance: none` and a chevron drawn with two `linear-gradient`s, with the
end padding widened so the text never runs under it. **No CSS file has a
`url(` or `@import`** (`src/styles/base.test.ts`): no styling makes a request.
**Under forced colors (`accessibility.md` A20)**, which drops shadows and
background images, the bottom rule is a real 1 px border, the invalid ring an
outline (the focus ring still wins), and the select gets its native arrow
back (`src/styles/forced-colors.test.ts`).

**Text that tests read stays one text node.** `"3 likes"`, `"12 followers"` and
`"8 following"` are matched exactly by `getByText` (`FeedPage.test.tsx`,
`ProfileSummary`). Style the whole node; don't split the number into its own
`<span>`. A unit that wants to split one changes the test first, in its own
red commit.

## 2. Shared components (`UI-002`, `src/components/ui/`)

| Component | Renders | Variants | States |
|---|---|---|---|
| `Button` | a native `<button>` (all props passed through) | `primary` (`--color-action` fill, `--color-on-action` label), `secondary` (surface fill, `--color-border-strong` 1 px edge, `--color-text`), `ghost` (no fill or edge, `--color-text-muted`; for in-card actions such as Clear, Show replies, Undo) | default, `:hover` (primary → `--color-action-hover`; others → `--color-surface-muted` fill), `:active`, `:focus-visible` (`--focus-ring`), `:disabled` (`--opacity-disabled`, `cursor: not-allowed`), `data-active` (Unfollow: secondary, with the icon filled; the attribute is for CSS only, because the label already carries the state). **A control is one or the other, never both:** either its label changes (Follow ↔ Unfollow, no `aria-pressed`), or its name stays fixed and `aria-pressed` carries the state (the post card's Like and Repost since `UI-009`, the human 2026-10-16). A changing label plus a pressed state is announced as "Unlike, pressed", a double signal |
| `buttonClass(variant, size)` | a class string, for a `Link` that should look like a button (header "Sign in", the not-found link back to the feed) | as `Button` | as `Button` |
| — sizes | | `md`: min-height 44 px (`--target-min`), padding `--space-2 --space-4`. `sm`: min-height 32 px, with a hit area padded to at least 24 × 24 (WCAG 2.5.8); for post footers and the notification Clear | |
| `Card` | a box with `--color-surface`, 1 px `--color-border`, `--radius-md`, padding `--space-4` | `as` prop: `article`, `section` or `div` (the element's role is the caller's choice; `PostNode` must stay an `article`) | — |
| `InlineAlert` | `<p role="alert">` with a leading icon | `danger` (default: `--color-danger` on `--color-danger-subtle`) | — |
| `StatusLine` | `<p role="status">` | `neutral` (`--color-text-muted`, for loading lines), `success` (`--color-success` on `--color-success-subtle`, for "Your profile has been saved.") | — |
| `EmptyState` | a muted paragraph, plus an optional action | — | — |
| `Skeleton` | `aria-hidden` blocks in `--color-surface-muted` | `post` (since `FRONTEND-015`: the post card's own box and column, so it is the card's height: `Card`'s border, padding and surface, a 32 px avatar row, one text line, the action row with the card's wrap rules; with `media`, a full-width 4:3 frame), `line` | static; **no shimmer animation** (direction: calm, and nothing to switch off for reduced motion) |
| `Avatar` | the first character of the username **as typed**, in a `--radius-full` circle, `--color-surface-muted` fill, `--color-text` | `sm` 32 px, `lg` 64 px | `aria-hidden="true"`: the username is always beside it. No hashed per-user colours, which would land near team colours |
| `Badge` | an inline label, `--font-size-xs`, 600 | `neutral` (`--color-surface-muted` / `--color-text`), `live` (`--color-live` / `--color-on-live`, with a dot), `outline` (team abbreviations: transparent, 1 px `--color-border-strong`) | — |
| `Icon` | one inline SVG, `aria-hidden="true"`, `currentColor`, 20 px (16 in `sm` buttons) | see §3 | — |
| `GameScore` | the score block (§4) | `compact` (one line, for the feed ticker), `row` (for search results) | **No caller since `FRONTEND-009`**: the ticker went with `EVENTS-003` and the search game filter with `FRONTEND-009`. Kept until a unit with `components/ui/` in scope deletes it or reuses it |
| `Tabs` (`FRONTEND-009`) | a `<nav aria-label>` of `NavLink`s styled as tabs, the current one `aria-current="page"` | — | default, `:hover`, `:focus-visible`, current (a bar and weight). **Deliberately not an ARIA `tablist`**: each tab is its own route, so the address decides the tab and Back moves between them |
| `VisuallyHidden` | text for screen readers only (the `.visually-hidden` class from `base.css`) | — | — |
| `Dialog` (`FRONTEND-010`) | a native `<dialog>` opened with `showModal()` (top layer, page inert, focus kept inside): a sticky header with the title as an `h2` (also the accessible name, `aria-labelledby`) and a Close button (`x` icon, 44 px), then the body. `--color-bg`, 1 px `--color-border`, `--radius-md`, `--shadow-2`, at most `--content-max` wide with a `--space-4` gutter. The backdrop is `--neutral-950` at 0.6 opacity: **there is no scrim token**, so a primitive is used; a styles unit may add one | — | open, closed (renders nothing). Escape is the prevented `cancel` event. The Back icon is `ChevronDownIcon` rotated 90° (no left chevron in `ui/icons/` yet). **A backdrop click is a click whose target, and whose mousedown's target, is the `<dialog>` itself**: the dialog has no padding and does not scroll (its content does), so a scrollbar click or a selection dragged out of the content never closes it. Focus returns to the opener. A `close` event arriving while the element is open again is ignored (StrictMode's re-run). **Since `FRONTEND-012`:** `role="alertdialog"` for confirms (no Close button), and a `<dialog>` inside another acts only on its own `cancel`/`close` events, so a confirm's Escape never closes the thread modal around it |
| `ConfirmDialog` (`FRONTEND-012`) | `Dialog role="alertdialog"`: the question as the title, one explaining paragraph, then Cancel (`Button secondary`, focused on open) and the action, right-aligned | the action `primary`, or `destructive` (Delete, Deactivate: `--color-danger` fill) | default; in flight (both disabled); failed (an `InlineAlert` inside, and it stays open) |
| `SearchInput` (`UI-010`) | `Field` around a wrapper holding an `aria-hidden` `SearchIcon` (`--color-text-muted`, inside the fill at the start) and an `input type="search"`, its text padded past the icon | — | as the soft-filled controls, plus `error` (from `Field`) |
| `SegmentedTabs` (`UI-010`) | an in-page ARIA `tablist` of `<button role="tab">`s and one `tabpanel` around its children. **Not `Tabs`**: it switches a panel on the same page, where `Tabs` is navigation | — | each tab ≥ 44 px (`--target-min`); selected: a `--radius-full` pill in `--color-action` with `--color-on-action` text; others `--color-text-muted`; `:focus-visible` ring. One tab stop (roving `tabindex`); arrows wrap, Home/End. Overflow at 360 scrolls the bar inside itself, never the page. Ids from `useId`, so two bars on one page never collide. Forced colors: the selected tab is underlined |
| `FloatingButton` (`UI-010`) | a 56 px round action, `position: fixed` bottom right: a `Link` (`to`) or a `<button type="button">` (`onClick`), named by a required `aria-label` | — | `--color-action` fill, `--color-on-action` icon, `--shadow-2`, `:focus-visible` ring, a 2 px edge under forced colors. Phones: above the bottom bar and clear of `env(safe-area-inset-bottom)`. From 40em: `--space-5` from the corner. **No caller in `UI-010`**: `FRONTEND-020` mounts it as the compose **+**. It must not cover a card's More options at 360 (a browser row there) |
| `Menu` (`FRONTEND-012`) | a button (`aria-haspopup="menu"`, `aria-expanded`) and a `role="menu"` list shown with `popover="manual"` + `showPopover()`, so it sits in the top layer over a modal and is never clipped. `--color-surface`, 1 px `--color-border`, `--radius-md`, `--shadow-2`; items 44 px (`--target-min`), hover `--color-surface-muted`, `:focus-visible` `--focus-ring`, disabled items muted | — | rendered only while open; placed under the button's end edge, flipped above near the viewport's bottom, following scroll. APG menu button keys: arrows, Home/End (roving tab stop), Escape closes it and only it (stopped and default-prevented), Tab or focus leaving closes it |

### As built (`UI-002`, merged 2026-10-06)

The props the tests pin. Each is a named export from `src/components/ui/<Name>.tsx`.

| Export | Props |
|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "ghost"` and `size: "md" \| "sm"`, both required; every other `<button>` prop is passed through, and `className` is appended |
| `buttonClass(variant, size)` | returns the same class string as `Button`, for a `Link` |
| `Card` | `as?: "article" \| "section" \| "div"` (default `div`), plus any HTML attribute; `className` appended |
| `InlineAlert` | `children` and `id?: string` (danger is the only variant). The `id` lands on the `<p role="alert">` itself, for a field whose error is this alert and whose control names it in `aria-describedby` (since 2026-10-07, `decisions.md`). **No `className` or other passthrough** |
| `StatusLine` | `variant?: "neutral" \| "success"` (default neutral) and `children`. No `id` or `className` |
| `EmptyState` | `children` (the muted line) and `action?: ReactNode` |
| `Skeleton` | `variant: "post" \| "line"`; `media?: boolean` on `post` (reserves the 4:3 frame, `FRONTEND-015`) |
| `Avatar` | `username: string` and `size: "sm" \| "lg"` |
| `Badge` | `variant: "neutral" \| "live" \| "outline"` and `children` |
| `GameScore` | `variant: "compact" \| "row"`, `homeScore`, `awayScore` and `status` (`LiveScoreView` in camelCase) |
| `VisuallyHidden` | `children` |
| `Tabs` | `label: string` (the `nav`'s name) and `items: TabItem[]` (each a route and its text) |
| `Dialog` | `open: boolean`, `onClose: () => void` (called once per way out; the dialog never closes itself, the caller turns `open` false or unmounts it), `title: string`, `children`, optional `onBack: () => void` (`FRONTEND-011`: a 44 px ghost icon button named "Back" leads the header while it is given; if it disappears while focused, focus moves to Close), optional `role?: "dialog" \| "alertdialog"` and `describedBy?: string` (`FRONTEND-012`) |
| `ConfirmDialog` | exported from `Dialog.tsx` (`FRONTEND-012`): the title, the explanation, the action's label and tone, `onConfirm`, `onCancel`, and its in-flight and error state |
| `SearchInput` | `id: string`, `label: string`, `error?: string`, and every other `<input>` prop passed through to the input (`type` is always `search`; no `className`) |
| `SegmentedTabs` | `label: string` (the tablist's name), `tabs: { id: string; label: string }[]`, `value: string` (the selected id), `onChange: (id: string) => void`, `children` (the panel). Controlled: the caller holds `value` |
| `FloatingButton` | `aria-label: string` (required, a type error without it), `children` (the icon), and either `to: string` or `onClick: () => void` |
| `Menu` | `label: string` (the button's and the menu's name), `items: MenuItem[]` (`{ label, onSelect, disabled? }`), `icon?: ReactNode` (shown in place of the label, which stays the name) |
| `icons/index.tsx` | `HouseIcon`, `SearchIcon`, `SquarePenIcon`, `BellIcon`, `UserIcon`, `ChartColumnIcon`, `HeartIcon`, `HeartFilledIcon`, `MessageCircleIcon`, `Repeat2Icon`, `Repeat2FilledIcon`, `ChevronDownIcon`, `XIcon`, `ImageIcon`, `CircleAlertIcon`, `CircleCheckIcon`, `EllipsisIcon` (`FRONTEND-012`), and `CirclePlusIcon`, `PaperclipIcon` and `CircleXIcon` (`UI-010`), each taking `size?: number` (default 20) and `className?` |

A feature unit that needs something not listed here (for example a
`className` on `InlineAlert`, or an `id` on `StatusLine`) can't edit
`src/components/ui/**`. It stops and reports, and the change is its own small
unit. Don't work around a missing prop with a wrapper element: that is how
`UI-006` first gave the media error its id, and it was replaced by
`InlineAlert`'s `id` prop.

**Deliberately not built** (no screen needs them; build when one does):

- ~~**Tabs.**~~ Built: `Tabs` (route tabs, `FRONTEND-009`) and `SegmentedTabs`
  (in-page, `UI-010`).
- **Toast.** Every failure in the app is already inline, beside the control it
  is about, with `role="alert"`. That is the better pattern, and a toast would
  move the message away from its cause.
- **A modal is `Dialog`, a menu is `Menu`.** Both are native (`<dialog>`,
  the Popover API), with no dependency, as this note asked. The post menu in
  `business-rules.md` (report, copy link) is `FRONTEND-012`'s `PostMenu`. A
  dependency such as Radix is still a Director PR (`implementation-plan.md`).

## 3. Icons

**Copied, not installed.** Eighteen Lucide icons plus two pressed variants (ISC licence, `branding.md` §5)
are copied as inline SVG React components into `src/components/ui/icons/`,
with Lucide's licence text in `src/components/ui/icons/LICENSE`. There is no
`lucide-react` dependency (so no `package.json` Director PR), no third-party
request, and only the glyphs in use.

| Icon | Lucide name | Used by |
|---|---|---|
| Feed | `house` | nav |
| Search | `search` | nav |
| Compose | `square-pen` | nav |
| Notifications | `bell` | nav |
| Your profile | `user` | nav |
| Stats | `chart-column` | nav (`FRONTEND-009`) |
| Like | `heart`; pressed: `HeartFilledIcon`, the same path filled with `currentColor` | `PostAction` (`UI-009`) |
| Reply | `message-circle` | `PostAction` |
| Repost | `repeat-2`, also the "↻ name reposted" line; pressed: `Repeat2FilledIcon`, the same paths at stroke width 3 (an outline has nothing to fill) | `PostAction`, `PostNode` |
| (unused) | `chevron-down` | no caller since `FRONTEND-010` removed Show replies; kept until a tidy-up deletes it |
| Clear, Close | `x` | `NotificationRow`, `Dialog` |
| Image | `image` | `MediaWidget` |
| Alert | `circle-alert` | `InlineAlert` |
| Success | `circle-check` | `StatusLine success` |
| More options | `ellipsis` | `PostMenu`'s `Menu` button (`FRONTEND-012`) |
| Compose (+) | `circle-plus` | `FloatingButton` in `FRONTEND-020` (added by `UI-010`, no caller yet) |
| Attach image | `paperclip` | the compose modal's attach button, `FRONTEND-020` (no caller yet) |
| Refused | `circle-x` | the compose modal's red refusal line, `FRONTEND-020` (no caller yet) |

**An icon never replaces a label, with one exception.** Every control keeps
its visible text, which is also its accessible name, and that is what the
tests find. **The exception is the post card's action row** (`UI-009`, the
human 2026-10-14): Like, Reply and Repost are icon-only, named by
`aria-label`, each followed by its count as visible text ("2 likes"); the card's "More options" menu button (`FRONTEND-012`) is icon-only in the same row. The
count stays outside the control's name.

## 4. Sports-specific

### Score block (`GameScore`, inside `LiveScoreTickerDecorator`)

**History, not current.** The ticker was removed with `EVENTS-003`
(2026-10-13) and the search game filter with `FRONTEND-009`, so nothing
renders `GameScore` now (§2). This section and "Game state" below are kept
as the design to reuse if a score block comes back.

```
┌ status region "Live score" ───────────────────────────────┐
│ (●Live) Q3 · Game 789                                     │
│ Home  95  –  99  Away                                     │
└───────────────────────────────────────────────────────────┘
```

- **The decorator adds a block below the post view and never restyles it.**
  It renders its children untouched and then the ticker, as now. The ticker is a
  `--color-surface-muted` band at the foot of the post's content, with
  `--radius-sm`.
- **Figures:** `--font-size-2xl`, 700, `tabular-nums`, home first, an en dash
  between. **Home and Away are words, not team names**, because
  `LiveScoreView` carries only `game_id`, the two scores and `status`. Naming
  teams needs the backend to add home and away abbreviations to `LiveScoreView`.
  That's a follow-up for `feed/`, not a styling unit; it is listed in the PR.
- One `GameScore` per game, in the existing `<ul>` (a post can mention
  several). The `role="status"` and `aria-label="Live score"` stay exactly as
  they are.

### Game state

`LiveScoreView.status` is the vendor's short code, passed through as text. The
vendor shape is **unverified** (`0x02-events.md`: the adapter's API-SPORTS
parsing is illustrative), and `Game` has no status column. So the mapping is a
small table with a safe default, and it never claims "Live" for a code it
doesn't know:

| `status` | Badge | Shown text |
|---|---|---|
| `Q1` `Q2` `Q3` `Q4` `OT` `BT` `HT` | `live`, with the word **Live** | the code, e.g. "Q3" |
| `FT` `AOT` | `neutral` | **Final** (and "Final (OT)" for `AOT`) |
| `NS` | `neutral` | **Scheduled** |
| `POST` `CANC` `SUSP` `AWD` `ABD` | `neutral` | Postponed / Cancelled / Suspended / Awarded / Abandoned |
| anything else | `neutral` | the code as given |

Search results (`GameOut`, `FRONTEND-007`) are historical games, so they are
**Final**: `GameFilter` passes status `FT` to `GameScore`. They have `home_team_id` and `away_team_id`, and
the filter control already loads `GET /events/teams`, so a search row can name
both teams by abbreviation.

### Team identity

- **Text only: the team name, or its abbreviation in an `outline` badge.** No
  logos in v1 (`decisions.md` 2026-10-06). `TeamOut.logo_url` points at
  API-SPORTS's media host. API-SPORTS says logos are provided *"solely for
  identification and descriptive purposes"*, that it owns no rights in them,
  and that users are responsible for their use (API-SPORTS documentation,
  read via search 2026-10-06). The marks belong to the leagues and clubs, who
  police them (`branding.md` §10). Hotlinking would also be a third-party
  request on every view.
- **No team colours anywhere**, not even as a small accent beside a team's
  name. A team colour pair is exactly what `branding.md` §10 says never to use.

### Mentions in posts

**`#GameId<n>` is a link since `FRONTEND-008`**, to `/games/<n>`, and only
when the server resolved it (`mentioned_game_ids`; `0x08-frontend.md` →
Game page). **As built it is a plain text link**, not the inline `neutral`
badge this section reserved; the badge style stays reserved if a later
unit wants it. `$TOR` is still rendered as typed and deliberately resolves
to nothing.

## 5. Map: every existing component and view

| Existing | Uses | Notes |
|---|---|---|
| `routes/AppLayout` | header, nav, `buttonClass` (Sign in), icons | `layout.md` §2. `Link` → `NavLink` for `aria-current`. Six items for a signed-in visitor since `FRONTEND-009` (Stats between Search and the profile item); `NavItem`'s `alsoCurrentOn` marks Stats current on `/players/*` too |
| `routes/guards` `Resolving` / `Unavailable` | `StatusLine` / `InlineAlert` | Same text. **`FRONTEND-012`:** a deactivated account gets `RecoveryScreen` in a `RequireAuth` route's place |
| `routes/Deactivated` `DeactivatedBanner`, `RecoveryScreen` (`FRONTEND-012`) | banner: a `section` (a named region, not a second `header`) between the header and `main`, `--color-warning-subtle` with a 1 px `--color-warning` edge, `--radius-md`; a 600 title, a muted `--font-size-sm` line, `Button primary` Recover account and `Button secondary` Sign out, wrapping at 360. Recovery screen: page template, `h1`, what recovery restores, the same two buttons | Every page while deactivated. Recover is disabled in flight; a failure is an `InlineAlert` beside it. The banner takes focus (`tabIndex={-1}`) after Deactivate |
| `routes/views` `NotFoundView` | page template, `EmptyState`, `buttonClass` | The only view left in `views.tsx` |
| `routes/HomeView` | `SearchBar` above `FeedPage` | `/`: composed in `routes/` because neither feature imports the other |
| `routes/BackgroundRoutes` (`FRONTEND-010`) | no styles of its own | Renders the page at one position against the real location or the modal's background, then the modal: the page underneath is never re-mounted, so it keeps its scroll. **`FRONTEND-015`:** the lazy pages wait behind one `Suspense` with a `StatusLine` "Loading…" around the page only |
| `features/search/SearchBar` | `Card`, `SearchInput` (`UI-010`), `Button primary` (Search) | `form role="search"`; box and button stacked at every width (`layout.md` §3) |
| `features/search/SearchPage` | `StatusLine`, `InlineAlert`, `EmptyState` per section; accounts as one list `Card` with dividers, `Avatar sm`, username link 600, description muted; posts as `PreparedPostNode` cards (`FRONTEND-015`); `Button secondary` full width (Load more accounts / posts) | Every empty state names the query. Accounts and posts only since `FRONTEND-009` (`GameFilter` removed) |
| `features/games/GamePage` (`FRONTEND-008`) | page template, `h1`, "Final: X won, 117–109" in words, `StatusLine`, `InlineAlert`, "Game not found" `EmptyState` with a link to the feed | Public. Reached from post mentions and Stats rows. **`FRONTEND-017`:** signed in, a completed game (not 0–0) gets "Post about this" (`SquarePenIcon` 16 + link text, hidden " game") under the score heading, to `/compose?link=game_final…`. **`FRONTEND-014`:** opened from a card, it renders inside `DetailModal` (title "Game"); loaded directly it is this page |
| `features/games/LineScore`, `BoxScore` | real tables (`caption`, `th scope`), each in a labelled, focusable `role="region"` with `overflow-x: auto`; `tabular-nums` | Box-score names link to `/players/<id>` (`FRONTEND-009`). Did-not-play players listed after the table. **`FRONTEND-014`:** `?line=<line_id>` marks that row `aria-current="true"` with an accent tint (`color-mix` 12%), a 0.25rem inset `--color-accent` rule on the row header and a bold name, never the tint alone, and scrolls only its own scroller to it. **`FRONTEND-017`:** signed in, a trailing column (hidden header "Post", `width: 1%`, `position: relative` so the hidden name stays inside the scrolling region) with a compact `SquarePenIcon` + "Post" link per played row (accessible name "Post about <name>’s game"), an empty cell for DNP rows and totals; a guest's table is unchanged |
| `features/stats/StatsPage` (`FRONTEND-009`) | page template, one `h1` "Stats", `Tabs` (Seasons, Players), the tab's route below | `/stats` redirects to `/stats/seasons` |
| `features/stats/SeasonsTab`, `LeagueView`, `TeamSeasonView` | native `select` season picker, `TeamSearch`, tables in `ScrollTable`, `Button secondary` (Load more) | Champion line, standings per conference, leaders with the API's rule text, the season's or a team's games |
| `features/stats/TeamSearch` | `Field` + input as an ARIA 1.2 combobox with a `listbox` panel | Arrow keys, Enter, Escape, click (options take `mousedown`) |
| `features/stats/PlayersTab` | `Field` + search input (debounced), result list, `EmptyState` naming the search, `Button secondary` (Load more) | |
| `features/players/PlayerPage` (`FRONTEND-009`) | page template, `h1` name, attributes as a `dl`, career, season and game-log tables in `ScrollTable` | "Player not found" for an unknown id. **`ScrollTable` is copied in `stats` and `players`** (features may not import each other); one shared table wrapper in `components/ui/` is the fix. **`FRONTEND-017`:** signed in, the career table gains the same trailing "Post" column ("Post about <name>’s regular season / playoffs"), empty for a scope with no games. **`FRONTEND-014`:** opened from a card, it renders inside `DetailModal` (title "Player") |
| `components/FormField` `Field` | `FormField.module.css` (`UI-004`): label 600 `--font-size-sm`; hint `--color-text-muted`; error `--color-danger` with an `aria-hidden` icon; label over control, and the space between consecutive fields | Markup and ids unchanged. **Field owns its own layout**: a feature's module CSS sets control widths and the space above its submit button, never the label or the gap between fields (`UI-008` nearly doubled it) |
| `auth/SignInPage`, `SignUpPage`, `ConfirmPage`, `ForgotPasswordPage`, `ProfileSetupPage` | narrow `Card`, `InlineAlert`, `StatusLine` (Confirm's notice), `Button primary` (submit), `Button secondary` (Resend code), base form controls | Forgot step two's "We have sent a code to …" is a `StatusLine` look, as a plain `<p>` (it isn't a live update) |
| `features/feed/FeedPage` | `StatusLine` + 3 × `Skeleton post` (loading), `InlineAlert` (error), `EmptyState` ("There is nothing here yet."), `Button secondary` full width (Load more); cards as `PreparedPostNode` (`FRONTEND-015`) | Load more's disabled-while-fetching state. The list is `aria-busy` only while the first page's in-view image cards are prepared |
| `features/feed/PreparedPostNode` (`FRONTEND-015`) | `Skeleton post` (with `media` when the card has images) until ready, then `PostNode` | Ready = every image loaded and `decode()` settled, bounded at 4 s; prepared only within one view of the nearest scroll container; a revealed card never returns to a skeleton. **No reveal animation** |
| `features/feed/PostNode` | `Card as="article"`, `Avatar sm`, author link 600, `<time>` muted tabular inside a link to `/posts/<id>` (24 px minimum), the action row (`PostAction` × 3) | **Since `FRONTEND-010` no Show replies, no inline thread and no `nested` prop**: a click on the card's own surface opens the thread modal (not a focus stop: no `tabindex`, no wrapping link; the timestamp link is the keyboard path), and replies are read only in the modal, where each is again a card. **Reposts (`UI-009`):** a plain repost is a muted "↻ name reposted" line over the original's content and controls; a quote repost embeds the original as a compact box (1 px `--color-border`, `--radius-md`, text clamped to 3 lines, no controls). "This post is unavailable" (muted, italic) for a missing original. **`FRONTEND-014`:** the data-link preview (below) sits after the text, in the original's box too. **`FRONTEND-012`:** `PostMenu` ends the action row; an original that is gone (`reposted_post_deleted`) is a muted, italic "Post deleted" box in its place (`--color-surface-muted`, `--radius-md`, no link, author or media) |
| `features/feed/PostMenu` (`FRONTEND-012`) | `Menu` with `EllipsisIcon` ("More options"), `ConfirmDialog` × 2 (Report; Delete, destructive), a "Link copied" `StatusLine`; the copy fallback a read-only input, selected | Items: Copy link; Report (another's post, active account; then "Reported", disabled) or Delete (own post, never a plain repost). Focus after a delete: the next card's menu, else the previous one's, else the list heading; Close when a thread root goes |
| `features/feed/PostAction` (`UI-009`) | `Button ghost sm` (or a `Link` with `buttonClass`, for Reply), icon only, square, named by `aria-label`; then its count, `--color-text-muted`, `--font-size-sm`, `tabular-nums` | Like and Repost carry `aria-pressed` and swap to the filled icon when pressed, plus `--color-action`. `TogglePostAction` is the one optimistic pattern for both; failure is an `InlineAlert` on its own row. Replaces `LikeButton`. Since `FRONTEND-010` Reply goes to `/posts/<id>?reply=1` and the reply count is a link (`.countLink`, 24 px minimum) to the thread |
| `features/thread/DetailModal` (`FRONTEND-014`) | the one `Dialog` of the modal flow, around an `Outlet`: Back at depth > 1, Close/Escape leave the flow | Stays mounted while thread, game and player details switch inside it, so it is one `<dialog>` element for the whole flow; each detail sets its title with `useDetailTitle` ("Thread", "Game", "Player") |
| `features/feed/previews/` `GamePreview`, `PlayerGamePreview`, `PlayerCareerPreview` (`FRONTEND-014`) | a box in `--color-surface-muted` with `--radius-md`: a muted kicker (Playoffs / the game's label), one 600 link as its headline (the detail), a muted meta line (team · W/L as an `abbr` · score · date), and a figures row (`dl`, labels muted 600 `abbr`s with the full name as title, values 600 `tabular-nums`) that wraps at 360 | Each has exactly one link, its own tab stop, never inside the timestamp or Reply. "Stats unavailable" (muted) for a link with no preview; "Did not play: <reason>" in place of figures; a null figure is an em dash. Shares no markup with the composer's attachment summary |
| `features/thread/ThreadModal` (`FRONTEND-010`; the thread body inside `DetailModal` since `FRONTEND-014`) | under the dialog titled "Thread": the root `PostNode` (each card a `PreparedPostNode` since `FRONTEND-015`; a deleted root is POSTS-004's "Post deleted" card), then `InlineComposer` or a "Sign in to reply" link (600, 44 px), then the direct replies as cards behind a 2 px `--color-border` rule (`--space-3` indent) | "Post not found" (`EmptyState`), "Loading the thread…" (`StatusLine`), failure as `InlineAlert` + `Button secondary` "Try again", "No replies yet." (`EmptyState`) |
| `features/compose/InlineComposer` (`FRONTEND-010`) | "Replying to @username" muted `--font-size-sm` (the text box's `aria-describedby`), `ComposeTextBox` labelled "Your reply", `MediaWidget` (no Attach stats: a reply carries no link, `FRONTEND-013`), `Button primary` (Reply, right-aligned), `InlineAlert` | The same colleagues as `ComposePage`, not a second text box. Reply disabled in flight |
| `features/feed/PostMedia` | since `FRONTEND-015` a fixed 4:3 frame (`aspect-ratio: 4 / 3`, `--radius-md`, letterbox `--color-surface-muted`) with the `img` inside at `object-fit: contain` | A failed, missing or late image is a muted "Image unavailable" line centred in the same frame, never dropped: dropping it was a layout shift. `MediaItemView` carries no dimensions, so the frame is the only size |
| `features/compose/ComposePage` | form `Card`, `Button primary` (Post), `Button ghost` (Undo attach), `Button secondary` × quick posts, `InlineAlert` (a specific message per POSTS-005 refusal code) | Post disabled until `canBuild()` |
| `features/compose/ComposeTextBox` | `Field` + textarea (base) | No standing hint since `FRONTEND-013` |
| `features/compose/AttachmentPicker` (`FRONTEND-013`) | `Button secondary` "Attach stats" (`aria-expanded`); a panel in the form's flow; three `Button secondary` choices with `aria-pressed`; native selects (`Field`) for Team and Season; games, box-score players and scopes as full-width `ghost` buttons, min 44 px; a `Field` search input; the summary as a `section` "Attached stats" with `Button ghost sm` "Remove attached stats" | `StatusLine` while reading, `InlineAlert` on a failed read, a `StatusLine` note for a refused pre-filled address. Escape closes and returns focus to Attach stats |
| `features/compose/MediaWidget` | `Field` + file input (base, `::file-selector-button` as secondary), preview `img` 96 px `--radius-sm`, `StatusLine` (preparing / ready), `InlineAlert` (wrong type, too large, `rejected`), `Button secondary sm` (Attach, disabled until `processed`) / `ghost sm` (Remove file) | States: chosen → `uploaded`/`scanning` (preparing) → `processed` (ready) or `rejected` (alert, no attach) |
| `features/notifications/NotificationsPage` | list `Card` with dividers, `StatusLine`, `InlineAlert`, `EmptyState` ("You have no notifications.") | |
| `features/notifications/NotificationRow` | actor link 600, sentence, `<time>` muted, `Button ghost sm` (Clear) with `x` icon | "Someone" placeholder is plain text |
| `features/notifications/EmailPreference` | one-row `Card`, native checkbox (base, `accent-color: var(--color-action)`, 20 px, label is the hit area) | Loading/error lines inside the same card. **The one recorded exception to "Field owns its own layout"**: `.preference > div` turns `Field` into a row so the box sits before its label (`UI-007`). Don't copy it; a checkbox layout in `Field` should replace it |
| `features/profile/ProfilePage` | `StatusLine` / `InlineAlert` | |
| `features/profile/ProfileSummary` | header `Card`, `Avatar lg`, `h1`, counts muted tabular; an optional `action` slot (Follow/Unfollow) on the right from 40em, under the name on phones (`UI-008`) | Counts stay single text nodes. Still three scalars plus a control slot, never a user object |
| `features/profile/OwnProfile` | description `<p>`, `<dl>` row (DOB with its privacy note), `ProfileSettings` | |
| `features/profile/PublicProfile` | `FollowButton` | |
| `features/profile/FollowButton` | `Button primary` (Follow) / `secondary` + `data-active` (Unfollow) | Failure: `InlineAlert` |
| `features/profile/ProfileSettings` | `Card` with `h2`, base controls, `Button primary` (Save), `StatusLine success` (saved, "nothing to save yet" as neutral); since `FRONTEND-012` a last "Account" section outside the form (1 px `--color-border` rule above, `h3`, a muted line, `Button secondary` "Deactivate account" in `--color-danger` text and edge) opening a destructive `ConfirmDialog` | Teams loading/error states |
