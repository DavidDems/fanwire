---
type: decision
---

# 0011 - Brand palette

Decision: 2026-09-22 (three colours) and 2026-10-05 (one added, the
contrast re-measured), the human.

## Context

The UI needs a small brand palette whose pairings are measured, not judged by
eye. The branding research (`wiki/CodeContext/FrontendUI/branding.md` §2) re-measured every pairing
with a script and compared each colour with every team colour. Teal is ΔE 1.4
from the Charlotte Hornets' teal `#00788C` (CIEDE2000; under about 2 reads as
the same colour), so it must not dominate the brand. The palette as a set is
not any team's (`wiki/CodeContext/FrontendUI/branding.md` §2.2).

## Choice

Four brand colours:

| Token | Hex | Name |
|---|---|---|
| `--color-ink` | `#022b3a` | Jet Black |
| `--color-accent` | `#1f7a8c` | Teal |
| `--color-sky` | `#bfdbf7` | Pale Sky |
| `--color-accent-on-dark` | `#279ab1` | Teal, lightened for dark surfaces |

The three original colours are **kept**: the human declined shifting Teal to
sea green `#077e6a`. `#279ab1` is the darkest shade of Teal's hue that reaches
AA on Jet Black: **4.501:1**. Use it for links and focus rings on Jet Black,
never on light surfaces (3.31:1 on white). Its margin is 0.001. If it ever
sits on a surface other than exactly `#022b3a`, re-measure. `#289eb5` (4.72:1,
`wiki/CodeContext/FrontendUI/branding.md` §2.1) is the drop-in, which needs the human's sign-off like
any palette change.

The contrast, measured with WCAG 2.1 relative luminance:

| Pairing | Ratio | Verdict |
|---|---|---|
| Jet Black on white | **14.90:1** | AAA. The body-text colour. |
| Pale Sky on Jet Black | **10.42:1** | AAA. Use for text on dark surfaces. |
| White on Teal | **4.98:1** | AA for normal text, fails AAA. Fine for buttons and badges. |
| **Teal on Jet Black** | **2.995:1** | ❌ **Fails AA.** It also fails the 3:1 non-text minimum (WCAG 1.4.11), so teal can't be a focus ring, icon or border on Jet Black either. |
| `#279ab1` on Jet Black | **4.501:1** | AA, by a margin of 0.001. |
| `#279ab1` on white | 3.31:1 | Fails. Dark surfaces only. |

Teal on Jet Black is the trap. Teal and Jet Black are the two "brand" colours,
so pairing them is the obvious move, and the result is unreadable. Teal goes
*behind* white text, never in front of a dark surface.

Three colours can't style a whole UI, so a token set also needs the following.
They follow from the palette and are not further human decisions:

- **A neutral ramp** for borders, disabled states and secondary text, tinted
  toward Jet Black so it belongs to the same family rather than reading as flat
  grey.
- **Semantic states** for error, warning and success. None of the three brand
  colours can carry them: teal reads as neither danger nor confirmation.
- **Dark mode**, defined once as tokens and redefined under a dark media query
  rather than hardcoded per component.

## Consequences

Every other colour token is derived in `wiki/CodeContext/FrontendUI/tokens.md`; only the human changes
a palette value. The dark theme follows from the measured margins:

- **The page is darker than ink, and cards are exactly ink.** That puts
  `--color-accent-on-dark`, whose margin is 0.001, on exactly the surface it was
  measured on, and on one that only adds contrast (5.253).
- **The dark primary button is Pale Sky with Jet Black text** (10.425), not
  Teal. White on `#279ab1` is 3.311 and fails, and a Teal button on Jet Black
  is a teal-on-dark boundary. Teal therefore appears in only one theme.
