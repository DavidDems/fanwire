# FrontendUI — tokens

**Agent-facing.** Every design token with its value, in light and dark, and the
measured contrast of every pair the UI uses. `UI-001` writes these into
`frontend/src/styles/tokens.css` verbatim. Every other stylesheet refers to them
by name and never by value: a hex code or a raw `px` spacing value in a
`*.module.css` file is a defect (`verification.md` checks it).

`decisions.md` owns the four brand colours. Everything else here follows from
them (`decisions.md` "Three colours can't style a whole UI…") and was computed by
the script in [`tokens-check.md`](tokens-check.md) on 2026-10-06. **Ratios are
not rounded. WCAG has no rounding, so 4.499 is a fail.**

## 1. Two layers

1. **Brand primitives.** These are fixed, keep the names `decisions.md` gave
   them, and never change with the theme. Components don't use them directly.
2. **Semantic tokens.** These are what components use. They are defined once on
   `:root` for light, and redefined under
   `@media (prefers-color-scheme: dark)`. No component hardcodes a theme.

There is no in-app theme toggle (YAGNI): the operating system's setting
decides. `:root` also declares `color-scheme: light dark`, so native controls
(the checkbox, date input, select and scrollbars) follow the theme.

## 2. Brand primitives (`decisions.md`)

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
| `--color-surface` | `#ffffff` | `#022b3a` (**exactly** ink) | Cards, header, inputs |
| `--color-surface-muted` | `#e6eef2` (n-100) | `#173543` (n-800) | Skeletons, hover fill, chips. **Never put a link on it** (§6) |
| `--color-text` | `#022b3a` | `#bfdbf7` | Body text |
| `--color-text-muted` | `#465f6c` | `#8fb0c4` | Timestamps, counts, hints |
| `--color-border` | `#d0dde4` | `#1f4757` | Decorative dividers, card edges. Not a control boundary |
| `--color-border-strong` | `#5c7684` | `#6d8fa1` | Input and checkbox boundaries (≥3:1) |
| `--color-action` | `#1f7a8c` (Teal) | `#bfdbf7` (Pale Sky) | Primary button fill, selected-tab bar |
| `--color-action-hover` | `#17606f` | `#e1eefb` | Primary button hover and active |
| `--color-on-action` | `#ffffff` | `#022b3a` | Primary button label |
| `--color-link` | `#1f7a8c` | `#279ab1` | Inline links |
| `--color-focus` | `#1f7a8c` | `#bfdbf7` | Focus ring |
| `--color-danger` | `#9b1c1c` | `#ffa08a` | Error text, field-error border |
| `--color-danger-subtle` | `#fdecea` | `#2e0f17` | Alert background |
| `--color-success` | `#1b6e4a` | `#6fd39a` | Success text |
| `--color-success-subtle` | `#e7f4ec` | `#0e2a13` | Success status background |
| `--color-warning` | `#8a5300` | `#efbd71` | Warning text |
| `--color-warning-subtle` | `#fdf1dc` | `#3d350f` | Warning background |
| `--color-live` | `#c0176f` | `#f58cc8` | Live badge fill and dot |
| `--color-on-live` | `#ffffff` | `#011d28` | Live badge label |

**Why the dark theme looks like this:**

- **The page is darker than ink, and cards are exactly ink.** That puts
  `--color-accent-on-dark`, whose margin is 0.001, on exactly the surface it was
  measured on, and on one that only adds contrast (5.253).
- **The dark primary button is Pale Sky with Jet Black text** (10.425), not
  Teal. White on `#279ab1` is 3.311 and fails, and a Teal button on Jet Black
  is a teal-on-dark boundary. Teal therefore appears in only one theme.

## 5. Measured pairs

Every pair the components in `components.md` use. All pass.

| Foreground → background | Light | Dark | Needs |
|---|---|---|---|
| text → bg | 13.825 | 12.165 | 4.5 |
| text → surface | 14.902 | 10.425 | 4.5 |
| text → surface-muted | 12.685 | 9.031 | 4.5 |
| text-muted → bg | 6.257 | 7.597 | 4.5 |
| text-muted → surface | 6.744 | 6.511 | 4.5 |
| text-muted → surface-muted | 5.741 | 5.640 | 4.5 |
| link → bg | 4.616 | 5.253 | 4.5 |
| link → surface | 4.975 | **4.501** | 4.5 |
| on-action → action | 4.975 | 10.425 | 4.5 |
| on-action → action-hover | 7.145 | 12.648 | 4.5 |
| action → bg (button edge, non-text) | 4.616 | 12.165 | 3.0 |
| action → surface (non-text) | 4.975 | 10.425 | 3.0 |
| focus → bg | 4.616 | 12.165 | 3.0 |
| focus → surface | 4.975 | 10.425 | 3.0 |
| focus → surface-muted | 4.235 | 9.031 | 3.0 |
| border-strong → bg | 4.449 | 5.046 | 3.0 |
| border-strong → surface | 4.795 | 4.324 | 3.0 |
| danger → surface | 8.150 | 7.555 | 4.5 |
| danger → bg | 7.562 | 8.816 | 4.5 |
| danger → surface-muted | 6.938 | 6.545 | 4.5 |
| danger → danger-subtle | 7.127 | 8.896 | 4.5 |
| success → surface | 6.221 | 8.132 | 4.5 |
| success → success-subtle | 5.495 | 8.431 | 4.5 |
| warning → surface | 6.329 | 8.648 | 4.5 |
| warning → warning-subtle | 5.664 | 7.108 | 4.5 |
| on-live → live | 5.844 | 7.840 | 4.5 |
| live → surface (badge edge, non-text) | 5.844 | 6.718 | 3.0 |
| live → bg (non-text) | 5.422 | 7.840 | 3.0 |
| sky → ink (the symbol on its tile) | 10.425 | 10.425 | 4.5 |

## 6. Banned pairs

These are measured so the ban has a number beside it. `UI-001`'s contrast test
(`src/styles/tokens.test.ts`) asserts that none of them is ever declared as a pair.

**Scope of each ban.** Teal on Jet Black is banned for **every** use, text and
non-text, because it fails 3:1 too. The other five are banned **as text** (a
4.5 pair) only. The same values may still meet as a 3:1 non-text pair where §5
lists one: light Teal on `#e6eef2` is the §5 *focus → surface-muted* ring
(4.235 ≥ 3.0) and is allowed, while a Teal *link* on `#e6eef2` is not. The test
implements exactly this split.

| Pair | Ratio | Why it's banned |
|---|---|---|
| Teal `#1f7a8c` on Jet Black `#022b3a` | **2.995** | Fails text, and fails the 3:1 non-text minimum. No teal text, icon, border or focus ring on a dark surface |
| Teal on the dark page `#011d28` | 3.495 | Fails text |
| `#279ab1` on dark surface-muted `#173543` | 3.899 | Fails text. That's why links never sit on surface-muted |
| Teal link on light surface-muted `#e6eef2` | 4.235 | Fails text. Same rule in light |
| `#279ab1` on white | 3.311 | It's the dark-theme link colour only |
| `--neutral-400` as text on white | 3.027 | Use `--neutral-600` or darker |

`#289eb5` (4.72:1 on ink, `branding.md` §2.1) is the drop-in if the dark link
ever needs margin. It's a palette change, so it's the human's call. Nothing in
this plan needs it, because dark links only ever sit on `#022b3a` or darker.

## 7. Distance from team colours

Every new chromatic token was compared, with CIEDE2000, to all 307 colours on
teamcolorcodes.com's NBA (101), NFL (96) and MLB (110) pages, read on
2026-10-06. Under about 2 reads as the same colour. The nearest match for each:

| Token | Value | Nearest team colour | ΔE |
|---|---|---|---|
| light danger | `#9b1c1c` | Nationals red `#AB0003` | 5.3 |
| light success | `#1b6e4a` | Jets green `#125740` (Celtics `#007A33` 8.5) | 8.2 |
| light warning | `#8a5300` | Jaguars dark gold `#9F792C` | 14.2 |
| light live | `#c0176f` | Cardinals red `#97233F` | 12.4 |
| dark danger | `#ffa08a` | Giants / Knicks orange | 17.2 |
| dark success | `#6fd39a` | Seahawks green `#69BE28` | 16.1 |
| dark warning | `#efbd71` | Giants beige `#EFD19F` (Cavaliers gold 7.8) | 7.7 |
| dark live | `#f58cc8` | Timberwolves moonlight grey | 16.8 |
| tints (`*-subtle`) | — | nearest is light warning-subtle vs Bucks cream `#EEE1C6` | 4.1 |

**Live was the reason for this check.** A conventional red Live badge
(`#c0262d`) is ΔE **2.2** from the Pistons' and Clippers' red `#C8102E`, so in
an NBA app it reads as a team's colour. Raspberry is clear of every team, and
it also separates "live" from "error" by hue. Danger is still a red: any red
that reads as an error sits near some team's red, so it is kept to text, thin
borders and tints, never a large fill.

## 8. Type, space and shape

CSS custom properties can't be used inside `@media`, so breakpoints are
constants (§9), not tokens.

| Token | Value | Notes |
|---|---|---|
| `--font-sans` | see `typography.md` | System stack |
| `--font-mono` | `ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace` | Not used in v1 UI; listed so no unit invents one |
| `--font-size-xs` | `0.75rem` (12 px) | Badges only; the floor |
| `--font-size-sm` | `0.875rem` (14 px) | Metadata, hints, counts |
| `--font-size-md` | `1rem` (16 px) | Body, inputs (16 px stops iOS zoom-on-focus) |
| `--font-size-lg` | `1.125rem` (18 px) | Card headings, `h2` |
| `--font-size-xl` | `1.375rem` (22 px) | Page `h1` on phones |
| `--font-size-2xl` | `1.75rem` (28 px) | Page `h1` ≥ 640 px; the score figures |
| `--line-height-tight` | `1.2` | Headings, scores |
| `--line-height-body` | `1.5` | Body text |
| `--font-weight-regular` | `400` | |
| `--font-weight-semibold` | `600` | Headings, usernames, buttons |
| `--font-weight-bold` | `700` | Score figures only |
| `--space-1` … `--space-8` | `0.25rem`, `0.5rem`, `0.75rem`, `1rem`, `1.5rem`, `2rem`, `3rem`, `4rem` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| `--radius-sm` | `4px` | Inputs, badges |
| `--radius-md` | `8px` | Cards, buttons |
| `--radius-full` | `9999px` | Avatars, the live dot |
| `--shadow-1` | light `0 1px 2px rgb(2 43 58 / 0.08), 0 1px 3px rgb(2 43 58 / 0.06)`; dark `none` | Sticky header and bottom bar. Dark uses `--color-border` instead |
| `--shadow-2` | light `0 4px 12px rgb(2 43 58 / 0.12)`; dark `0 0 0 1px var(--color-border-strong)` | Mention suggestions |
| `--focus-ring` | `2px solid var(--color-focus)`, offset `2px` | Via `:focus-visible` only |
| `--target-min` | `2.75rem` (44 px) | Primary controls and nav items on touch |
| `--content-max` | `40rem` (640 px) | The content column |
| `--duration-fast` | `120ms` | Hover, press |
| `--duration-base` | `200ms` | Disclosure, score highlight |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | All transitions |
| `--opacity-disabled` | `0.55` | Disabled controls (exempt from 1.4.3, still legible) |

Under `@media (prefers-reduced-motion: reduce)` both durations become `0ms`.
Components use the tokens, so they get this for free.

## 9. Breakpoints and layers

| Constant | Value | What changes |
|---|---|---|
| `xs` | below `360px` | The header shows the symbol alone (`layout.md`) |
| `sm` | `640px` (`40em`) | The bottom tab bar gives way to header navigation |
| `md` | `960px` (`60em`) | Wider page gutters only. Still one column |

Write them as `@media (min-width: 40em)` (mobile-first), never `max-width`.

| Token | Value | Layer |
|---|---|---|
| `--z-base` | `0` | Content |
| `--z-sticky` | `10` | Header, bottom tab bar |
| `--z-dropdown` | `20` | Mention suggestions |
| `--z-toast` | `30` | Reserved; no toast in v1 (`components.md`) |
| `--z-skip-link` | `40` | The skip link when focused |
