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
`aria-describedby`. So the error border is `[aria-invalid="true"]`, the disabled
look is `:disabled`, and the focus ring is `:focus-visible`, with no class on
any control. That's why most auth and settings forms need almost no
feature-level CSS. A native `<button>` (and a file input's
`::file-selector-button`) defaults to the **secondary** look, inside
`:where()` so any module class wins. Until each feature moves its buttons onto
`Button`, they are readable instead of the browser's grey button face, which
in dark mode put Pale Sky on `#6b6b6b` (`src/styles/native-buttons.test.ts`).

**Text that tests read stays one text node.** `"3 likes"`, `"12 followers"` and
`"8 following"` are matched exactly by `getByText` (`FeedPage.test.tsx`,
`ProfileSummary`). Style the whole node; don't split the number into its own
`<span>`. A unit that wants to split one changes the test first, in its own
red commit.

## 2. Shared components (`UI-002`, `src/components/ui/`)

| Component | Renders | Variants | States |
|---|---|---|---|
| `Button` | a native `<button>` (all props passed through) | `primary` (`--color-action` fill, `--color-on-action` label), `secondary` (surface fill, `--color-border-strong` 1 px edge, `--color-text`), `ghost` (no fill or edge, `--color-text-muted`; for in-card actions such as Clear, Show replies, Undo) | default, `:hover` (primary → `--color-action-hover`; others → `--color-surface-muted` fill), `:active`, `:focus-visible` (`--focus-ring`), `:disabled` (`--opacity-disabled`, `cursor: not-allowed`), `data-active` (Unlike, Unfollow: secondary, with the icon filled). **Not `aria-pressed`:** these buttons already change their label (Like ↔ Unlike), and a changing label plus a pressed state is announced as "Unlike, pressed", a double signal. The label stays the state; the attribute is for CSS only |
| `buttonClass(variant, size)` | a class string, for a `Link` that should look like a button (header "Sign in", the not-found link back to the feed) | as `Button` | as `Button` |
| — sizes | | `md`: min-height 44 px (`--target-min`), padding `--space-2 --space-4`. `sm`: min-height 32 px, with a hit area padded to at least 24 × 24 (WCAG 2.5.8); for post footers and the notification Clear | |
| `Card` | a box with `--color-surface`, 1 px `--color-border`, `--radius-md`, padding `--space-4` | `as` prop: `article`, `section` or `div` (the element's role is the caller's choice; `PostNode` must stay an `article`) | — |
| `InlineAlert` | `<p role="alert">` with a leading icon | `danger` (default: `--color-danger` on `--color-danger-subtle`) | — |
| `StatusLine` | `<p role="status">` | `neutral` (`--color-text-muted`, for loading lines), `success` (`--color-success` on `--color-success-subtle`, for "Your profile has been saved.") | — |
| `EmptyState` | a muted paragraph, plus an optional action | — | — |
| `Skeleton` | `aria-hidden` blocks in `--color-surface-muted` | `post` (avatar circle, two text bars), `line` | static; **no shimmer animation** (direction: calm, and nothing to switch off for reduced motion) |
| `Avatar` | the first character of the username **as typed**, in a `--radius-full` circle, `--color-surface-muted` fill, `--color-text` | `sm` 32 px, `lg` 64 px | `aria-hidden="true"`: the username is always beside it. No hashed per-user colours, which would land near team colours |
| `Badge` | an inline label, `--font-size-xs`, 600 | `neutral` (`--color-surface-muted` / `--color-text`), `live` (`--color-live` / `--color-on-live`, with a dot), `outline` (team abbreviations: transparent, 1 px `--color-border-strong`) | — |
| `Icon` | one inline SVG, `aria-hidden="true"`, `currentColor`, 20 px (16 in `sm` buttons) | see §3 | — |
| `GameScore` | the score block (§4) | `compact` (one line, for the feed ticker), `row` (for search results) | — |
| `VisuallyHidden` | text for screen readers only (the `.visually-hidden` class from `base.css`) | — | — |

### As built (`UI-002`, merged 2026-10-06)

The props the tests pin. Each is a named export from `src/components/ui/<Name>.tsx`.

| Export | Props |
|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "ghost"` and `size: "md" \| "sm"`, both required; every other `<button>` prop is passed through, and `className` is appended |
| `buttonClass(variant, size)` | returns the same class string as `Button`, for a `Link` |
| `Card` | `as?: "article" \| "section" \| "div"` (default `div`), plus any HTML attribute; `className` appended |
| `InlineAlert` | `children` only (danger is the only variant). **No `id` or `className` passthrough** |
| `StatusLine` | `variant?: "neutral" \| "success"` (default neutral) and `children`. No `id` or `className` |
| `EmptyState` | `children` (the muted line) and `action?: ReactNode` |
| `Skeleton` | `variant: "post" \| "line"` |
| `Avatar` | `username: string` and `size: "sm" \| "lg"` |
| `Badge` | `variant: "neutral" \| "live" \| "outline"` and `children` |
| `GameScore` | `variant: "compact" \| "row"`, `homeScore`, `awayScore` and `status` (`LiveScoreView` in camelCase) |
| `VisuallyHidden` | `children` |
| `icons/index.tsx` | `HouseIcon`, `SearchIcon`, `SquarePenIcon`, `BellIcon`, `UserIcon`, `HeartIcon`, `MessageCircleIcon`, `Repeat2Icon`, `ChevronDownIcon`, `XIcon`, `ImageIcon`, `CircleAlertIcon` and `CircleCheckIcon`, each taking `size?: number` (default 20) and `className?` |

A feature unit that needs something not listed here (for example an `id` on
`InlineAlert` for `aria-describedby`) can't edit `src/components/ui/**`. It
stops and reports, and the change is its own small unit.

**Deliberately not built** (no screen needs them; build when one does):

- **Tabs.** No view has tabs. `FRONTEND-007`'s two search UIs are two sections,
  by its own spec.
- **Toast.** Every failure in the app is already inline, beside the control it
  is about, with `role="alert"`. That is the better pattern, and a toast would
  move the message away from its cause.
- **Modal or dialog, and a menu.** None exist. The post "hamburger" menu in
  `business-rules.md` (report, copy link) is unbuilt. When it is built, use
  the native `<dialog>` and the Popover API before considering a dependency
  such as Radix: a dependency is a Director PR (`implementation-plan.md`).

## 3. Icons

**Copied, not installed.** Thirteen Lucide icons (ISC licence, `branding.md` §5)
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
| Like / Unlike | `heart` (filled when liked) | `LikeButton` |
| Reply | `message-circle` | `PostNode` footer |
| Repost | `repeat-2` | `PostNode` footer |
| Show replies | `chevron-down` (rotated 180° when `aria-expanded="true"`) | `PostNode` footer |
| Clear | `x` | `NotificationRow` |
| Image | `image` | `MediaWidget` |
| Alert | `circle-alert` | `InlineAlert` |
| Success | `circle-check` | `StatusLine success` |

**An icon never replaces a label.** Every control keeps its visible text, which
is also its accessible name, and that is what the tests find.

## 4. Sports-specific

### Score block (`GameScore`, inside `LiveScoreTickerDecorator`)

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
**Final** with no badge needed. They have `home_team_id` and `away_team_id`, and
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

Post text is rendered as typed, so `#GameId123` and `$TOR` appear literally.
**No unit in this plan parses them into links.** There is no game page to link
to yet ("Posts with a link to a game should be clickable to go to the stats
page", `business-rules.md`, is unbuilt), and `$TOR` deliberately resolves to
nothing (`0x08-frontend.md`). When the game page exists, the unit that builds
it renders `#GameId<n>` as a link styled as an inline `neutral` badge. That
style is reserved for it now, so nobody invents another.

## 5. Map: every existing component and view

| Existing | Uses | Notes |
|---|---|---|
| `routes/AppLayout` | header, nav, `buttonClass` (Sign in), icons | `layout.md` §2. `Link` → `NavLink` for `aria-current` |
| `routes/guards` `Resolving` / `Unavailable` | `StatusLine` / `InlineAlert` | Same text |
| `routes/views` `SearchView`, `NotFoundView` | page template, `EmptyState`, `buttonClass` | Search is replaced by `FRONTEND-007` |
| `components/FormField` `Field` | `field.module.css`: label 600 `--font-size-sm`; hint `--color-text-muted`; error `--color-danger` with icon | Markup and ids unchanged |
| `auth/SignInPage`, `SignUpPage`, `ConfirmPage`, `ForgotPasswordPage`, `ProfileSetupPage` | narrow `Card`, `InlineAlert`, `StatusLine` (Confirm's notice), `Button primary` (submit), `Button secondary` (Resend code), base form controls | Forgot step two's "We have sent a code to …" is a `StatusLine` look, as a plain `<p>` (it isn't a live update) |
| `features/feed/FeedPage` | `StatusLine` + 3 × `Skeleton post` (loading), `InlineAlert` (error), `EmptyState` ("There is nothing here yet."), `Button secondary` full width (Load more) | Load more's disabled-while-fetching state |
| `features/feed/PostNode` | `Card as="article"` (top level only), `Avatar sm`, author link 600, `<time>` muted tabular, `Button ghost sm` × Show replies, links styled as `ghost sm` (Reply, Repost) | Thread nesting: `layout.md` §4. Thread loading/error as `StatusLine` / `InlineAlert`. **Expanded with zero replies currently renders nothing**: `UI-005` adds "No replies yet." (`EmptyState`, test-first) |
| `features/feed/LiveScoreTickerDecorator` | `GameScore compact`, `Badge live` / `neutral` | §4 |
| `features/feed/LikeButton` | `Button ghost sm` + `heart` icon, `data-active` when liked | "N likes" stays one text node. Failure: `InlineAlert` |
| `features/feed/PostMedia` | `img`: `max-width: 100%`, `--radius-md`, `aspect-ratio` unknown so `height: auto`, max-height 28rem with `object-fit: cover` | Failure state is "nothing", unchanged |
| `features/compose/ComposePage` | form `Card`, `Button primary` (Post), `Button ghost` (Undo mention), `Button secondary` × quick posts, `InlineAlert` | Post disabled until `canBuild()` |
| `features/compose/ComposeTextBox` | `Field` + textarea (base) | The hint "Type # to mention a game…" is muted |
| `features/compose/MentionAutocomplete` | a `--shadow-2` panel under the text box, `--z-dropdown`; suggestions as full-width `ghost` buttons, min 44 px | `StatusLine` "Looking…", `InlineAlert`. Stays a list of buttons, not a combobox (its file says why) |
| `features/compose/MediaWidget` | `Field` + file input (base, `::file-selector-button` as secondary), preview `img` 96 px `--radius-sm`, `StatusLine` (preparing / ready), `InlineAlert` (wrong type, too large, `rejected`), `Button secondary sm` (Attach, disabled until `processed`) / `ghost sm` (Remove file) | States: chosen → `uploaded`/`scanning` (preparing) → `processed` (ready) or `rejected` (alert, no attach) |
| `features/notifications/NotificationsPage` | list `Card` with dividers, `StatusLine`, `InlineAlert`, `EmptyState` ("You have no notifications.") | |
| `features/notifications/NotificationRow` | actor link 600, sentence, `<time>` muted, `Button ghost sm` (Clear) with `x` icon | "Someone" placeholder is plain text |
| `features/notifications/EmailPreference` | one-row `Card`, native checkbox (base, `accent-color: var(--color-action)`, 20 px, label is the hit area) | Loading/error lines |
| `features/profile/ProfilePage` | `StatusLine` / `InlineAlert` | |
| `features/profile/ProfileSummary` | header `Card`, `Avatar lg`, `h1`, counts muted tabular | Counts stay single text nodes |
| `features/profile/OwnProfile` | description `<p>`, `<dl>` row (DOB with its privacy note), `ProfileSettings` | |
| `features/profile/PublicProfile` | `FollowButton` | |
| `features/profile/FollowButton` | `Button primary` (Follow) / `secondary` + `data-active` (Unfollow) | Failure: `InlineAlert` |
| `features/profile/ProfileSettings` | `Card` with `h2`, base controls, `Button primary` (Save), `StatusLine success` (saved, "nothing to save yet" as neutral) | Teams loading/error states |
