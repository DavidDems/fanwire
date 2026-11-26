---
type: reference
---

# FrontendUI — tokens: measured contrast

**Agent-facing.** Part of [tokens.md](tokens.md), which holds every token's
value: the measured contrast of every pair the UI uses, the banned pairs and
the distance of each chromatic token from team colours. Computed by the script
in [`tokens-check.md`](tokens-check.md) on 2026-10-06. **Ratios are not
rounded. WCAG has no rounding, so 4.499 is a fail.** Section numbers carry over
from `tokens.md`, so a `tokens.md` §5–§7 citation is found here.

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
| text → field (`UI-010`) | 12.685 | 9.031 | 4.5 |
| text → field-focus | 14.902 | 8.186 | 4.5 |
| text-muted → field (placeholder) | 5.741 | 5.640 | 4.5 |
| text-muted → field-focus | 6.744 | 5.113 | 4.5 |
| border-strong → field (the bottom rule) | 4.082 | 3.746 | 3.0 |
| border-strong → field-focus | 4.795 | **3.396** | 3.0 |

**Measured to fail, on purpose:** field → bg is 1.090 / 1.347 and field →
surface 1.175 / 1.154. No soft fill reaches 3:1 (WCAG 1.4.11), which is why
every soft-filled control keeps a 1 px `--color-border-strong` bottom rule in
every state (`UI-010`, `src/styles/tokens.test.ts`).

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

Why Live is raspberry: [ADR 0014](../../GeneralContext/Decisions/0014-look-and-feel.md).
