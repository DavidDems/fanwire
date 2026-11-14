---
type: reference
---

# FrontendUI — components: shared components and icons

Part of [components.md](components.md). Token names are from [tokens.md](tokens.md).

## 2. Shared components (`UI-002`, `src/components/ui/`)

| Component | Renders | Variants | States |
|---|---|---|---|
| `Button` | a native `<button>` (all props passed through) | `primary` (`--color-action` fill, `--color-on-action` label), `secondary` (surface fill, `--color-border-strong` 1 px edge, `--color-text`), `ghost` (no fill or edge, `--color-text-muted`; for in-card actions such as Clear and Undo) | default, `:hover` (primary → `--color-action-hover`; others → `--color-surface-muted` fill), `:active`, `:focus-visible` (`--focus-ring`), `:disabled` (`--opacity-disabled`, `cursor: not-allowed`), `data-active` (Unfollow: secondary, with the icon filled; the attribute is for CSS only, because the label already carries the state). **A control is one or the other, never both:** either its label changes (Follow ↔ Unfollow, no `aria-pressed`), or its name stays fixed and `aria-pressed` carries the state (the post card's Like and Repost since `UI-009`, the human 2026-10-16). A changing label plus a pressed state is announced as "Unlike, pressed", a double signal |
| `buttonClass(variant, size)` | a class string, for a `Link` that should look like a button (header "Sign in", the not-found link back to the feed) | as `Button` | as `Button` |
| — sizes | | `md`: min-height 44 px (`--target-min`), padding `--space-2 --space-4`. `sm`: min-height 32 px, with a hit area padded to at least 24 × 24 (WCAG 2.5.8); for post footers and the notification Clear | |
| `Card` | a box with `--color-surface`, 1 px `--color-border`, `--radius-md`, padding `--space-4` | `as` prop: `article`, `section` or `div` (the element's role is the caller's choice; `PostNode` must stay an `article`) | — |
| `InlineAlert` | `<p role="alert">` with a leading icon | `danger` (default: `--color-danger` on `--color-danger-subtle`) | — |
| `StatusLine` | `<p role="status">` | `neutral` (`--color-text-muted`, for loading lines), `success` (`--color-success` on `--color-success-subtle`, for "Your profile has been saved.") | — |
| `EmptyState` | a muted paragraph, plus an optional action | — | — |
| `Skeleton` | `aria-hidden` blocks in `--color-surface-muted` | `post` (since `FRONTEND-015`: the post card's own box and column, so it is the card's height: `Card`'s border, padding and surface, a 32 px avatar row, one text line, the action row with the card's wrap rules; with `media`, a full-width 4:3 frame), `line` | static; **no shimmer animation** (direction: calm, and nothing to switch off for reduced motion) |
| `Avatar` | in a `--radius-full` circle, `--color-surface-muted` fill, `--color-text`: the account's picture when it has one (`pictureKey`), else one of eight code-drawn presets (`avatarKey`, `AVATAR_OPTIONS`: `court-lines` … `play-pattern`), else the first character of the username **as typed** | `sm` 32 px, `lg` 64 px | `aria-hidden="true"`: the username is always beside it. No hashed per-user colours, which would land near team colours |
| `Badge` | an inline label, `--font-size-xs`, 600 | `neutral` (`--color-surface-muted` / `--color-text`), `live` (`--color-live` / `--color-on-live`, with a dot), `outline` (team abbreviations: transparent, 1 px `--color-border-strong`) | — |
| `Icon` | one inline SVG, `aria-hidden="true"`, `currentColor`, 20 px (16 in `sm` buttons) | see §3 | — |
| `GameScore` | the score block (`components-sports.md` §4) | `compact` (one line, for the feed ticker), `row` (for search results) | **No caller since `FRONTEND-009`**: the ticker went with `EVENTS-003` and the search game filter with `FRONTEND-009`; Recent Games used it from `EVENTS-013` until `FRONTEND-037` replaced it with its own card. Kept until a unit with `components/ui/` in scope deletes it or reuses it |
| `Tabs` (`FRONTEND-009`) | a `<nav aria-label>` of `NavLink`s styled as tabs, the current one `aria-current="page"` | — | default, `:hover`, `:focus-visible`, current (a bar and weight). **Deliberately not an ARIA `tablist`**: each tab is its own route, so the address decides the tab and Back moves between them |
| `VisuallyHidden` | text for screen readers only (the `.visually-hidden` class from `base.css`) | — | — |
| `Dialog` (`FRONTEND-010`) | a native `<dialog>` opened with `showModal()` (top layer, page inert, focus kept inside): a sticky header with the title as an `h2` (also the accessible name, `aria-labelledby`) and a Close button (`x` icon, 44 px), then the body. `--color-bg`, 1 px `--color-border`, `--radius-md`, `--shadow-2`, at most `--content-max` wide with a `--space-4` gutter. The backdrop is `--neutral-950` at 0.6 opacity: **there is no scrim token**, so a primitive is used; a styles unit may add one | — | open, closed (renders nothing). Escape is the prevented `cancel` event. The Back icon is `ChevronDownIcon` rotated 90° (no left chevron in `ui/icons/` yet). **A backdrop click is a click whose target, and whose mousedown's target, is the `<dialog>` itself**: the dialog has no padding and does not scroll (its content does), so a scrollbar click or a selection dragged out of the content never closes it. Since `FRONTEND-021`, focus starts on Close after `showModal()`; a child effect may move it (compose to its text box, confirms to Cancel). Focus returns to the opener. A `close` event arriving while the element is open again is ignored (StrictMode's re-run). **Since `FRONTEND-012`:** `role="alertdialog"` for confirms (no Close button), and a `<dialog>` inside another acts only on its own `cancel`/`close` events, so a confirm's Escape never closes the thread modal around it |
| `ConfirmDialog` (`FRONTEND-012`) | `Dialog role="alertdialog"`: the question as the title, one explaining paragraph, then Cancel (`Button secondary`, focused on open) and the action, right-aligned | the action `primary`, or `destructive` (Delete, Deactivate: `--color-danger` fill) | default; in flight (both disabled); failed (an `InlineAlert` inside, and it stays open) |
| `SearchInput` (`UI-010`) | `Field` around a wrapper holding an `aria-hidden` `SearchIcon` (`--color-text-muted`, inside the fill at the start) and an `input type="search"`, its text padded past the icon | — | as the soft-filled controls, plus `error` (from `Field`) |
| `SegmentedTabs` (`UI-010`) | an in-page ARIA `tablist` of `<button role="tab">`s and one `tabpanel` around its children. **Not `Tabs`**: it switches a panel on the same page, where `Tabs` is navigation | — | each tab ≥ 44 px (`--target-min`); selected: a `--radius-full` pill in `--color-action` with `--color-on-action` text; others `--color-text-muted`; `:focus-visible` ring. One tab stop (roving `tabindex`); arrows wrap, Home/End. Overflow at 360 scrolls the bar inside itself, never the page. Ids from `useId`, so two bars on one page never collide. Forced colors: the selected tab is underlined |
| `FloatingButton` (`UI-010`) | a 56 px round action, `position: fixed` bottom right: a `Link` (`to`) or a `<button type="button">` (`onClick`), named by a required `aria-label` | — | `--color-action` fill, `--color-on-action` icon, `--shadow-2`, `:focus-visible` ring, a 2 px edge under forced colors. Phones: above the bottom bar and clear of `env(safe-area-inset-bottom)`. From 40em: `--space-5` from the corner. Its caller is `routes/AppLayout`'s compose **+** (`CirclePlusIcon`). It must not cover a card's More options at 360 (a browser row there) |
| `Menu` (`FRONTEND-012`) | a button (`aria-haspopup="menu"`, `aria-expanded`) and a `role="menu"` list shown with `popover="manual"` + `showPopover()`, so it sits in the top layer over a modal and is never clipped. `--color-surface`, 1 px `--color-border`, `--radius-md`, `--shadow-2`; items 44 px (`--target-min`), hover `--color-surface-muted`, `:focus-visible` `--focus-ring`, disabled items muted | — | rendered only while open; placed under the button's end edge, flipped above near the viewport's bottom, following scroll. APG menu button keys: arrows, Home/End (roving tab stop), Escape closes it and only it (stopped and default-prevented), Tab or focus leaving closes it |

### As built (`UI-002`, merged 2026-10-06)

The props the tests pin. Each is a named export from `src/components/ui/<Name>.tsx`.

| Export | Props |
|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "ghost"` and `size: "md" \| "sm"`, both required; every other `<button>` prop is passed through, and `className` is appended |
| `buttonClass(variant, size)` | returns the same class string as `Button`, for a `Link` |
| `Card` | `as?: "article" \| "section" \| "div"` (default `div`), plus any HTML attribute; `className` appended |
| `InlineAlert` | `children` and `id?: string` (danger is the only variant). The `id` lands on the `<p role="alert">` itself, for a field whose error is this alert and whose control names it in `aria-describedby` ([ADR 0015](../../GeneralContext/Decisions/0015-inline-alert-id-prop.md)). **No `className` or other passthrough** |
| `StatusLine` | `variant?: "neutral" \| "success"` (default neutral) and `children`. No `id` or `className` |
| `EmptyState` | `children` (the muted line) and `action?: ReactNode` |
| `Skeleton` | `variant: "post" \| "line"`; `media?: boolean` on `post` (reserves the 4:3 frame, `FRONTEND-015`) |
| `Avatar` | `username: string` and `size: "sm" \| "lg"`, plus optional `avatarKey?` (a preset's key), `pictureKey?` (a picture, which wins over the preset) and `exposeKey?` (default true: the preset's key as `data-avatar-key`) |
| `Badge` | `variant: "neutral" \| "live" \| "outline"` and `children` |
| `GameScore` | `variant: "compact" \| "row"`, `homeScore`, `awayScore` and `status` (`LiveScoreView` in camelCase) |
| `VisuallyHidden` | `children` |
| `Tabs` | `label: string` (the `nav`'s name) and `items: TabItem[]` (each a route and its text) |
| `Dialog` | `open: boolean`, `onClose: () => void` (called once per way out; the dialog never closes itself, the caller turns `open` false or unmounts it), `title: string`, `children`, optional `onBack: () => void` (`FRONTEND-011`: a 44 px ghost icon button named "Back" leads the header while it is given; if it disappears while focused, focus moves to Close), optional `role?: "dialog" \| "alertdialog"` and `describedBy?: string` (`FRONTEND-012`) |
| `ConfirmDialog` | exported from `Dialog.tsx` (`FRONTEND-012`): the title, the explanation, the action's label and tone, `onConfirm`, `onCancel`, and its in-flight and error state |
| `SearchInput` | `id: string`, `label: string`, `error?: string`, and every other `<input>` prop passed through to the input (`type` is always `search`; no `className`) |
| `SegmentedTabs` | `label: string` (the tablist's name), `tabs: { id: string; label: string }[]`, `value: string` (the selected id), `onChange: (id: string) => void`, `children` (the panel, or a function handed the bar to place), `end?` (set at the bar's row end; the row wraps). `SegmentedRow` (`start?`, `end`) is that row alone. Controlled: the caller holds `value` |
| `FloatingButton` | `aria-label: string` (required, a type error without it), `children` (the icon), and either `to: string` or `onClick: () => void` |
| `Menu` | `label: string` (the button's and the menu's name), `items: MenuItem[]` (`{ label, onSelect, disabled? }`), `icon?: ReactNode` (shown in place of the label, which stays the name) |
| `icons/index.tsx` | `HouseIcon`, `SearchIcon`, `SquarePenIcon`, `BellIcon`, `UserIcon`, `ChartColumnIcon`, `HeartIcon`, `HeartFilledIcon`, `MessageCircleIcon`, `Repeat2Icon`, `Repeat2FilledIcon`, `ChevronDownIcon`, `XIcon`, `ImageIcon`, `CircleAlertIcon`, `CircleCheckIcon`, `EllipsisIcon` (`FRONTEND-012`), and `CirclePlusIcon`, `PaperclipIcon` and `CircleXIcon` (`UI-010`), `LogOutIcon` (`FRONTEND-035`) and `CalendarIcon` (`FRONTEND-044`), each taking `size?: number` (default 20) and `className?` |

A feature unit that needs something not listed here (for example a
`className` on `InlineAlert`, or an `id` on `StatusLine`) can't edit
`src/components/ui/**`. It stops and reports, and the change is its own small
unit. Don't work around a missing prop with a wrapper element: that is how
`UI-006` first gave the media error its id, and it was replaced by
`InlineAlert`'s `id` prop.

**Deliberately not built** (no screen needs them; build when one does):

- **Toast.** Every failure in the app is already inline, beside the control it
  is about, with `role="alert"`. That is the better pattern, and a toast would
  move the message away from its cause.
- **A modal is `Dialog`, a menu is `Menu`.** Both are native (`<dialog>`,
  the Popover API), with no dependency, as this note asked. The post menu in
  `business-rules.md` (report, copy link) is `FRONTEND-012`'s `PostMenu`. A
  dependency such as Radix is still a Director PR (`frontend/package.json` is
  denied to unit roles, `.ai/policy.json`).

## 3. Icons

**Copied, not installed.** Twenty Lucide icons plus two pressed variants (ISC licence, `branding-rights.md` §5)
are copied as inline SVG React components into `src/components/ui/icons/`,
with Lucide's licence text in `src/components/ui/icons/LICENSE`. There is no
`lucide-react` dependency (so no `package.json` Director PR), no third-party
request, and only the glyphs in use.

| Icon | Lucide name | Used by |
|---|---|---|
| Home (was Feed) | `house` | nav |
| Search | `search` | nav (the sidebar from 640 px) and the header's Search link on phones (`FRONTEND-035`) |
| Compose | `square-pen` | "Post about this" links in `GamePage`, `BoxScore` and `PlayerPage` (`FRONTEND-017`); no longer in the nav |
| Notifications | `bell` | nav |
| (unused) | `user` | no caller since "Your profile" left the nav for the Account menu; kept until a tidy-up deletes it |
| Stats | `chart-column` | nav (`FRONTEND-009`) |
| Schedule | `calendar` | nav (`FRONTEND-044`) |
| Like | `heart`; pressed: `HeartFilledIcon`, the same path filled with `currentColor` | `PostAction` (`UI-009`) |
| Reply | `message-circle` | `PostAction` |
| Repost | `repeat-2`, also the "↻ name reposted" line; pressed: `Repeat2FilledIcon`, the same paths at stroke width 3 (an outline has nothing to fill) | `PostAction`, `PostNode` |
| Back | `chevron-down` | `Dialog`'s Back (rotated 90°) |
| Clear, Close | `x` | `NotificationRow`, `Dialog` |
| (unused) | `image` | no caller; kept until a tidy-up deletes it |
| Alert | `circle-alert` | `InlineAlert` |
| Success | `circle-check` | `StatusLine success` |
| More options | `ellipsis` | `PostMenu`'s `Menu` button (`FRONTEND-012`) |
| Compose (+) | `circle-plus` | `AppLayout`'s compose `FloatingButton` |
| Attach image | `paperclip` | `MediaWidget`'s attach button |
| Refused | `circle-x` | `MediaWidget`'s red refusal line |
| Sign out | `log-out` | the nav's Sign out, its last item (`FRONTEND-035`) |

**An icon never replaces a visible label, with two exceptions.** Every control keeps
its visible text, which is also its accessible name, and that is what the
tests find. **The first is the post card's action row** (`UI-009`, the
human 2026-10-14): Like, Reply and Repost are icon-only, named by
`aria-label`, each followed by its count as visible text ("2 likes"); the card's "More options" menu button (`FRONTEND-012`) is icon-only in the same row. The
count stays outside the control's name. **The second is the primary nav**
(`FRONTEND-035`): on phones (the bottom bar) and in the compact sidebar (40em to
53.75em) each item shows its icon only, and its label stays in the DOM in the
shared `.visually-hidden` class, so the accessible name is still the word. From
53.75em (`FRONTEND-039`) the sidebar shows the label again. The header's Search link on phones
works the same way.
