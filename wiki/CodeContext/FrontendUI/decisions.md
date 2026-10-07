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

## Brand mark — decided 2026-10-05

Chosen at `12-branding-research.md`'s checkpoint. The detail is in `branding.md`.

- **Symbol plus wordmark.** The symbol is a lowercase `f` drawn as **one
  continuous wire line**, alone as the favicon and app icon. The wordmark is
  lowercase `fanwire` **typeset in a free OFL font** (shortlist Outfit, Sora,
  Manrope), never AI-generated.
- **The mark is Jet Black and Pale Sky, not teal**: a Pale Sky wire `f` on a
  Jet Black tile.
- **The human produces the assets** with ChatGPT (symbol concept only),
  Inkscape and ImageMagick, following `branding.md` and `TODO/05-branding-assets.md`.
  Until the files land in the repo, "No wordmark and no icon yet" above still holds.
- **Jurisdiction for rights questions: Canada.**

## Brand palette — extended 2026-10-05

The three colours above are **kept** (the human declined shifting Teal to sea
green `#077e6a`), and one is **added**:

| Token | Hex | Name |
|---|---|---|
| `--color-accent-on-dark` | `#279ab1` | Teal, lightened for dark surfaces |

It is the darkest shade of Teal's hue that reaches AA on Jet Black: **4.501:1**.
Use it for links and focus rings on Jet Black, never on light surfaces (3.31:1
on white). Its margin is 0.001. If it ever sits on a surface other than exactly
`#022b3a`, re-measure. `branding.md` §2.1 names `#289eb5` (4.72:1) as the
drop-in, which needs the human's sign-off like any palette change.

Reason: Teal is ΔE 1.4 from the Charlotte Hornets' teal `#00788C` (CIEDE2000;
under about 2 reads as the same colour), so it must not dominate the brand.
The palette as a set is not any team's (`branding.md` §2.2).

## Contrast table — corrected 2026-10-05

The table in "Brand palette — decided 2026-09-22" above was re-measured with a
script (`branding.md` §9). It is left as written, and the correct figures are:

| Pairing | Recorded | Measured | Verdict change |
|---|---|---|---|
| Jet Black on white | 15.2:1 | **14.90:1** | none (AAA) |
| Pale Sky on Jet Black | 10.6:1 | **10.42:1** | none (AAA) |
| White on Teal | 5.0:1 | **4.98:1** | none (AA, fails AAA) |
| Teal on Jet Black | 3.1:1 | **2.995:1** | **Worse.** It also fails the 3:1 non-text minimum (WCAG 1.4.11), so teal can't be a focus ring, icon or border on Jet Black either. |

## Brand assets — approved 2026-10-05

- **Symbol:** the wire `f` with a plug at the foot of the stem, generated from
  `branding.md` §6.1 variant A and traced by the human. Masters and provenance
  are in `brand/source/` (`PROVENANCE.md`), and the exports in `brand/out/`.
  The human approved the icons and the colour treatment.
- **Wordmark font: Outfit SemiBold (600)**, chosen from the Outfit, Sora and
  Manrope shortlist. The wordmark ships as SVG paths, so it doesn't load the
  font. `11` chooses the UI typeface separately and may or may not pick Outfit.
- **Similarity check:** Google Lens and TinEye found no matches. The Canadian
  Trademarks Database search (design mark and the word `fanwire`) is still
  open in `TODO/05-branding-assets.md`.
- "No wordmark and no icon yet" (2026-10-02) stops being true for the **site**
  only when the placement unit lands the files under `frontend/`. Until then the
  UI still shows the plain-text name.

## Similarity check — closed 2026-10-06

The human searched the Canadian Trademarks Database. The word `fanwire` returned
nothing, and among the design marks built on an `f`, none uses a plug and none is
similar to the symbol. With the Google Lens and TinEye results of 2026-10-05,
every check in `branding.md` §10 is done, so `TODO/05-branding-assets.md` is
deleted. The record is in `brand/source/PROVENANCE.md`. This is a clearance
search, not legal advice: a registration filing would still go through a
trademark agent.

## Look and feel — decided 2026-10-06

Chosen at `11-frontend-ui-plan.md`'s checkpoint. The detail is in the pages
named on each line.

- **Direction: "scoreboard-crisp, calm, dense."** Neutral surfaces tinted
  toward Jet Black; Teal only for actions and links; colour otherwise reserved
  for state and for Live. Not a team-coloured fan site, not a neon esports look
  (`direction.md`).
- **Styling mechanism: CSS Modules plus one global token stylesheet**, with no
  new dependency (`implementation-plan.md`, `verification.md`).
- **UI typeface: the system font stack.** Chosen over the recommended Atkinson
  Hyperlegible Next. No font file is shipped. The wordmark is still Outfit
  SemiBold (600) as SVG paths, so it doesn't depend on this (`typography.md`).
- **Live is a raspberry accent, not red** (`#c0176f` light, `#f58cc8` dark), so
  it stays out of the team reds and doesn't share a colour with errors
  (`tokens.md`).
- **No team logos in v1.** Teams are shown by name and abbreviation as text
  (`components.md`).
- **Sequencing as proposed:** one Director PR first for `index.html`, then nine
  worker units; `FRONTEND-007` (search) lands after the shared-component unit
  and uses it (`implementation-plan.md`).

## Before merging the plan — decided 2026-10-06

- **Brand placement is part of the Director PR `D1`**, not a worker unit, so
  `index.html` and the files it links land together: `D1` plus eight worker
  units (`implementation-plan.md`).
- **Tagline: "Sports talk, wired live."** Used for `<meta name="description">`
  and `og:description`. Sentence case; the name stays lowercase.
- **The first styling pass is run by hand from Claude Code sessions**, not by
  the API-driven orchestrator: specs `UI-001`–`UI-008` (and the amended
  `FRONTEND-007`) are worked through by prompts `13`–`16` in
  `wiki/GeneralContext/Prompts/`, one PR per unit.

## `InlineAlert` takes an `id` — decided 2026-10-07

- **A prop, not a wrapper.** When a field's error *is* an `InlineAlert` (the
  composer's image field), the control's `aria-describedby` names the alert
  itself through `InlineAlert`'s `id` prop. `UI-006` first put the id on a
  `<div>` wrapping the alert, because `src/components/ui/**` was outside its
  paths. The human preferred the prop as the better practice: the element that
  describes the control is the alert, with no extra node whose text has to
  stay identical to it.
- **Only `id`.** No `className` or general attribute passthrough; the role,
  classes and icon are what make it this component.
- **Performance:** none expected (one optional attribute, and one element fewer
  than the wrapper). If that ever proves wrong, revisit it here.
