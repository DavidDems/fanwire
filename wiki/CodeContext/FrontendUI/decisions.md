# FrontendUI — human decisions

**Agent-facing.** The look-and-feel and brand decisions the human has made, and
nothing else. These are inputs to every other file in `wiki/CodeContext/FrontendUI/`:
a page here that contradicts this one is wrong, not this one. Only the human
changes a decision; an agent that thinks one should change says so in its PR
and asks.

Research and recommendations live elsewhere: the look-and-feel plan is written
by `wiki/GeneralContext/Prompts/11-frontend-ui-plan.md`, and brand and colour
research by `12-branding-research.md` (into `branding.md`).

## Name styling — decided 2026-10-02

- **The brand name is always lowercase: `fanwire`.** This covers the header,
  the page `<title>`, emails, the app manifest, alt text and anywhere else the
  name appears, including at the start of a sentence.
- **Only the name.** Headings, buttons, labels and body copy use ordinary
  sentence case. User-written content (posts, display names) is shown as typed.
- **No wordmark and no icon yet.** Until they exist, the name is plain text in
  the UI typeface. `12-branding-research.md` recommends how to make them, and
  the human produces them.
- **Typeface: not chosen.** Until a plan picks one, the UI uses the system font
  stack. Choosing it is part of `11` (the UI typeface) and `12` (a wordmark's
  lettering, if it differs).

## Brand palette — decided 2026-09-22

Three brand colours:

| Token | Hex | Name |
|---|---|---|
| `--color-ink` | `#022b3a` | Jet Black |
| `--color-accent` | `#1f7a8c` | Teal |
| `--color-sky` | `#bfdbf7` | Pale Sky |

The contrast of each pairing was measured with WCAG 2.1 relative luminance, not
judged by eye:

| Pairing | Ratio | Verdict |
|---|---|---|
| Jet Black on white | **15.2:1** | AAA. The body-text colour. |
| Pale Sky on Jet Black | **10.6:1** | AAA. Use for text on dark surfaces. |
| White on Teal | **5.0:1** | AA for normal text, fails AAA. Fine for buttons and badges. |
| **Teal on Jet Black** | **3.1:1** | ❌ **Fails AA.** Never put teal text on a dark surface. |

The last row is the trap. Teal and Jet Black are the two "brand" colours, so
pairing them is the obvious move, and the result is unreadable. Teal goes
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

`12` may recommend extending or changing the palette. Until the human accepts a
recommendation, this table is the palette.

## Design guidance skill — installed 2026-09-22

The `ui-design` skill (`omer-metin/skills-for-antigravity`) is committed at
`.claude/skills/ui-design/`: `SKILL.md` plus `references/patterns.md`,
`sharp_edges.md` and `validations.md`. That is Markdown only, with no
executable content.

- **It was installed by copying the files after a review**, not by running the
  `npx skills add` installer, which would execute a third party's code. Because
  the files are committed, they are pinned and reviewable as a diff.
- **Precedence:** `SKILL.md` tells the agent to "politely correct" a user whose
  request conflicts with it. That does not hold here: the human's decisions on
  this page, and `wiki/CodeContext/Standards/design-principles.md`, win over the
  skill on any conflict.
