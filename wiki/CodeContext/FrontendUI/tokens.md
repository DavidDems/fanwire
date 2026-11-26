---
type: reference
---

# FrontendUI — tokens

**Agent-facing.** Every design token with its value, in light and dark. The
measured contrast of every pair the UI uses, the banned pairs and the distance
from team colours are in [`tokens-contrast.md`](tokens-contrast.md) (§5–§7,
section numbers carried over). `UI-001` writes these into
`frontend/src/styles/tokens.css` verbatim. Every other stylesheet refers to them
by name and never by value: a hex code or a raw `px` spacing value in a
`*.module.css` file is a defect (`verification.md` checks it).

[ADR 0011](../../GeneralContext/Decisions/0011-brand-palette.md) owns the four brand colours. Everything else here follows from
them (ADR 0011's three derived needs) and was computed by
the script in [`tokens-check.md`](tokens-check.md) on 2026-10-06. **Ratios are
not rounded. WCAG has no rounding, so 4.499 is a fail.**

## 1. Two layers

1. **Brand primitives.** These are fixed, keep the names ADR 0011 gave
   them, and never change with the theme. Components don't use them directly.
2. **Semantic tokens.** These are what components use. They are defined once on
   `:root` for light, and redefined under
   `@media (prefers-color-scheme: dark)`. No component hardcodes a theme.

There is no in-app theme toggle (YAGNI): the operating system's setting
decides. `:root` also declares `color-scheme: light dark`, so native controls
(the checkbox, date input, select and scrollbars) follow the theme.

## 2. Brand primitives (ADR 0011)

| Token | Value | Use |
|---|---|---|
| `--color-ink` | `#022b3a` | Jet Black. Light text, dark surface |
| `--color-accent` | `#1f7a8c` | Teal. Light-theme action, link and focus |
| `--color-sky` | `#bfdbf7` | Pale Sky. Dark-theme text and action |
| `--color-accent-on-dark` | `#279ab1` | Dark-theme links, **only** on `--color-bg` or `--color-surface` (dark) |

## 3. Neutral ramp

Tinted toward Jet Black's hue so greys belong to the palette. Ratios against
white and against Jet Black:

| Token | Value | On white | On ink | Allowed as text? |
|---|---|---|---|---|
| `--neutral-0` | `#ffffff` | 1.000 | 14.902 | on ink only |
| `--neutral-50` | `#f3f7f9` | 1.078 | 13.825 | on ink only |
| `--neutral-100` | `#e6eef2` | 1.175 | 12.685 | on ink only |
| `--neutral-200` | `#d0dde4` | 1.387 | 10.747 | no (decorative borders) |
| `--neutral-300` | `#aabfca` | 1.907 | 7.816 | no |
| `--neutral-400` | `#7f98a5` | 3.027 | 4.923 | **no** on light: 3.027 fails text |
| `--neutral-500` | `#5c7684` | 4.795 | 3.108 | non-text on light (input borders) |
| `--neutral-600` | `#465f6c` | 6.744 | 2.210 | yes, on light |
| `--neutral-700` | `#2f4753` | 9.781 | 1.524 | yes, on light |
| `--neutral-800` | `#173543` | 12.909 | 1.154 | dark surface only |
| `--neutral-900` | `#022b3a` | 14.902 | 1.000 | = ink |
| `--neutral-950` | `#011d28` | 17.389 | 1.167 | dark page background |

## 4. Semantic colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#f3f7f9` (n-50) | `#011d28` (n-950) | Page background |
| `--color-surface` | `#ffffff` | `#022b3a` (**exactly** ink) | Cards, header |
| `--color-surface-muted` | `#e6eef2` (n-100) | `#173543` (n-800) | Skeletons, hover fill, chips. **Never put a link on it** (`tokens-contrast.md` §6) |
| `--color-text` | `#022b3a` | `#bfdbf7` | Body text |
| `--color-text-muted` | `#465f6c` | `#8fb0c4` | Timestamps, counts, hints |
| `--color-border` | `#d0dde4` | `#1f4757` | Decorative dividers, card edges. Not a control boundary |
| `--color-border-strong` | `#5c7684` | `#6d8fa1` | Input and checkbox boundaries (≥3:1): a soft-filled field's 1 px bottom rule |
| `--color-field` (`UI-010`) | `#e6eef2` (n-100) | `#173543` (n-800) | A form control's fill at rest. Under 3:1 against bg and surface (`tokens-contrast.md` §5), so it never identifies the field alone: the bottom rule does |
| `--color-field-focus` (`UI-010`) | `#ffffff` | `#1b3c4b` | A focused control's fill. **Dark stays near `#173543`**: `#1f4757` puts the placeholder at 4.38 and the rule at 2.91 |
| `--color-action` | `#1f7a8c` (Teal) | `#bfdbf7` (Pale Sky) | Primary button fill, selected-tab bar |
| `--color-action-hover` | `#17606f` | `#e1eefb` | Primary button hover and active |
| `--color-on-action` | `#ffffff` | `#022b3a` | Primary button label |
| `--color-link` | `#1f7a8c` | `#279ab1` | Inline links |
| `--color-focus` | `#1f7a8c` | `#bfdbf7` | Focus ring |
| `--color-danger` | `#9b1c1c` | `#ffa08a` | Error text, the invalid field's ring |
| `--color-danger-subtle` | `#fdecea` | `#2e0f17` | Alert background |
| `--color-success` | `#1b6e4a` | `#6fd39a` | Success text |
| `--color-success-subtle` | `#e7f4ec` | `#0e2a13` | Success status background |
| `--color-warning` | `#8a5300` | `#efbd71` | Warning text |
| `--color-warning-subtle` | `#fdf1dc` | `#3d350f` | Warning background |
| `--color-live` | `#c0176f` | `#f58cc8` | Live badge fill and dot |
| `--color-on-live` | `#ffffff` | `#011d28` | Live badge label |
| `--color-scrim` (`FRONTEND-052`) | `#011d28` | `#011d28` | Modal backdrop, at 0.6 opacity |

Why the dark theme looks like this: [ADR 0011](../../GeneralContext/Decisions/0011-brand-palette.md).

## 5. Measured pairs

[`tokens-contrast.md`](tokens-contrast.md) §5.

## 6. Banned pairs

[`tokens-contrast.md`](tokens-contrast.md) §6.

## 7. Distance from team colours

[`tokens-contrast.md`](tokens-contrast.md) §7.

## 8. Type, space and shape

CSS custom properties can't be used inside `@media`, so breakpoints are
constants (§9), not tokens.

| Token | Value | Notes |
|---|---|---|
| `--font-sans` | see `typography.md` | System stack |
| `--font-mono` | `ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace` | Not used in v1 UI; listed so no unit invents one |
| `--font-size-xs` | `0.75rem` (12 px) | Badges only; the floor (one exception: `TeamIcon` `sm`, `components-sports.md` §4) |
| `--font-size-sm` | `0.875rem` (14 px) | Metadata, hints, counts |
| `--font-size-md` | `1rem` (16 px) | Body, inputs (16 px stops iOS zoom-on-focus) |
| `--font-size-lg` | `1.125rem` (18 px) | Card headings, `h2` |
| `--font-size-xl` | `1.375rem` (22 px) | Page `h1` on phones |
| `--font-size-2xl` | `1.75rem` (28 px) | Page `h1` ≥ 640 px; the score figures |
| `--line-height-tight` | `1.2` | Headings, scores |
| `--line-height-body` | `1.5` | Body text |
| `--font-weight-regular` | `400` | |
| `--font-weight-semibold` | `600` | Headings, usernames, buttons |
| `--font-weight-bold` | `700` | Score figures, `TeamIcon` abbreviation |
| `--space-1` … `--space-8` | `0.25rem`, `0.5rem`, `0.75rem`, `1rem`, `1.5rem`, `2rem`, `3rem`, `4rem` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| `--radius-sm` | `4px` | Badges, small previews |
| `--radius-md` | `8px` | Cards, buttons |
| `--radius-lg` (`UI-010`) | `12px` | Form controls (soft filled) |
| `--radius-full` | `9999px` | Avatars, the live dot |
| `--shadow-1` | light `0 1px 2px rgb(2 43 58 / 0.08), 0 1px 3px rgb(2 43 58 / 0.06)`; dark `none` | Sticky header. Dark uses `--color-border` instead |
| `--shadow-2` | light `0 4px 12px rgb(2 43 58 / 0.12)`; dark `0 0 0 1px var(--color-border-strong)` | `Dialog`, `Menu`, `FloatingButton`, and the Stats team search's options |
| `--focus-ring` | `2px solid var(--color-focus)`, offset `2px` | Via `:focus-visible` only |
| `--target-min` | `2.75rem` (44 px) | Primary controls and nav items on touch |
| `--content-max` | `40rem` (640 px) | The content column |
| `--content-max-wide` (`FRONTEND-030`) | `64rem` (1024 px) | The content column on `/stats/records` only, chosen by `AppLayout` from the route (`layout.md` §2) |
| `--sidebar-width-compact` (`FRONTEND-035`) | `4.5rem` (72 px) | The icon-only left sidebar, 40em to 53.75em |
| `--sidebar-width` (`FRONTEND-035`) | `12rem` (192 px) | The labelled left sidebar from 53.75em (`FRONTEND-039`) |
| `--rail-width` (`FRONTEND-035`, used by `FRONTEND-036`) | `18rem` (288 px) | The home page's right column from 76.0625em (`FRONTEND-039`) |
| `--duration-fast` | `120ms` | Hover, press |
| `--duration-base` | `200ms` | Disclosure; reserved for a score highlight (`direction.md`) |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | All transitions |
| `--opacity-disabled` | `0.55` | Disabled controls (exempt from 1.4.3, still legible) |

Under `@media (prefers-reduced-motion: reduce)` both durations become `0ms`.
Components use the tokens, so they get this for free.

## 9. Breakpoints and layers

| Constant | Value | What changes |
|---|---|---|
| `sm` | `640px` (`40em`) | The bottom icon bar gives way to the compact left sidebar; the header's Search link hides (`FRONTEND-035`) |
| `md` | `960px` (`60em`) | Wider page gutters |
| `tablet` | `860px` (`53.75em`) | The sidebar shows its labels and moves `--space-4` from the left edge (`FRONTEND-039`) |
| `lg` | `1217px` (`76.0625em`) | The home page's right column (`FRONTEND-036`, `FRONTEND-039`): the first width that fits the labelled sidebar, the 640 px feed and the rail with 16 px outer gaps beside a 17 px classic scrollbar |
| `xl` | `1248px` (`78em`) | The sidebar and main are centred again, the desktop geometry from before `FRONTEND-039` |

Write them as `@media (min-width: 40em)` (mobile-first), never `max-width`.

| Token | Value | Layer |
|---|---|---|
| `--z-base` | `0` | Content |
| `--z-sticky` | `10` | Header, bottom icon bar, sidebar; `Dialog`'s sticky header, `FloatingButton`, the stats picker's sticky footer |
| `--z-dropdown` | `20` | The team search suggestions (Stats) |
| `--z-toast` | `30` | Reserved; no toast in v1 (`components-shared.md`) |
| `--z-skip-link` | `40` | The skip link when focused |

## 10. Team colours (`FRONTEND-031`)

Declared on `:root` outside any theme block: a team's colours are the same in
both themes. `TeamIcon.module.css` reads them by name (`components-sports.md` §4,
Team identity); the palette order and the 30-team mapping live in
`frontend/src/lib/teamColors.ts`.

| Token | Keys and values |
|---|---|
| `--team-inner-<key>` (fill, black text) | gold `#ffd23f`, orange `#f58a1f`, red `#fa7b82`, green `#7cc24b`, sky `#4fa8f7`, lavender `#a98de6`, silver `#d3d8dc`, teal `#26d0c0` |
| `--team-outer-<key>` (ring) | blue `#0a4a9a`, crimson `#9b0f26`, black `#0a0a0a`, purple `#6a1b8f`, forest `#0b5d2e` |
