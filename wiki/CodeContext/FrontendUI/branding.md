---
type: reference
---

# FrontendUI — branding

**Agent-facing.** fanwire's brand: the colour verdict, the mark, how the human
makes the assets for free, and where each finished file goes. This page is the
index; the rights research, the symbol how-to and the export steps are its
parts (`## Parts` below).

The human's brand decisions, ADRs
[0010](../../GeneralContext/Decisions/0010-lowercase-brand-name.md)–[0013](../../GeneralContext/Decisions/0013-brand-mark-and-assets.md),
outrank this page and its parts. Everything else here is research and
recommendation.

**Scope is colour and identity only.** The UI typeface, layout and components
belong to the other FrontendUI pages.

Every time-sensitive fact on this page and its parts has its source and the
date it was read. All were read on **2026-10-05** unless a different date is
given. Re-check any of them before acting on them after a few months.

---

## 1. Decided direction

| | Decision |
|---|---|
| **Mark** | **Symbol plus wordmark**: a lowercase `f` drawn as one continuous wire line, alone as the favicon and app icon, and lowercase `fanwire` typeset in a free OFL font. **Superseded in the header on 2026-11-03:** the header shows the human's slightly cursive `fanwire` PNG wordmark (`brand/out/wordmark-light.png` and `wordmark-dark.png`) and no symbol; the favicon, app icons and OG card are unchanged ([ADR 0013](../../GeneralContext/Decisions/0013-brand-mark-and-assets.md)). |
| **Palette** | Jet Black `#022b3a`, Teal `#1f7a8c` and Pale Sky `#bfdbf7`, plus `--color-accent-on-dark` `#279ab1` for links and focus rings on dark surfaces ([ADR 0011](../../GeneralContext/Decisions/0011-brand-palette.md)). |
| **Mark colours** | Jet Black and Pale Sky, not teal: a Pale Sky wire `f` on a Jet Black tile (10.42:1). Teal stays a UI accent ([ADR 0013](../../GeneralContext/Decisions/0013-brand-mark-and-assets.md)). |
| **Jurisdiction** | Canada ([ADR 0013](../../GeneralContext/Decisions/0013-brand-mark-and-assets.md)). It shapes `branding-rights.md` §4.3. |

## 2. Colour

### 2.1 Measured numbers

These come from `palette_check.py` (§9), which uses WCAG 2.1 relative luminance
for contrast, CIEDE2000 for colour difference, and the Machado, Oliveira &
Fernandes (2009) matrices at severity 1.0 to simulate colour-vision deficiency.
Computed, not estimated.

| Pairing | Ratio | Verdict |
|---|---|---|
| Jet Black on white | **14.90:1** | AAA |
| Pale Sky on Jet Black | **10.42:1** | AAA |
| White on Teal | **4.98:1** | AA normal text, fails AAA |
| **Teal on Jet Black** | **2.995:1** | ❌ Fails AA text **and** the 3:1 non-text minimum (WCAG 1.4.11). WCAG does not round, so 2.995 is a fail. Teal can't be a focus ring, icon or border on Jet Black either. |
| Accent-on-dark `#279ab1` on Jet Black | **4.501:1** | AA normal text, by a margin of 0.001 (see below) |
| Teal on Pale Sky | 3.48:1 | Large text or non-text only |
| Accent-on-dark on white | 3.31:1 | Don't use it on light surfaces. It's for dark ones. |

**`#279ab1` has almost no margin.** It is the darkest shade of Teal's hue that
reaches 4.5:1 on Jet Black, so a tool that rounds or a slightly different dark
surface tips it under. If it ever sits on anything other than exactly `#022b3a`,
re-run the script. `#289eb5` (4.72:1, one step lighter on the same hue) is the
drop-in if margin is needed. Swapping it needs the human's sign-off, like any
palette change.

### 2.2 Is it distinct from the leagues and teams?

Every colour on teamcolorcodes.com's NBA, NFL and MLB league pages, plus the
teal and navy NHL teams (Kraken, Sharks, Canucks), was compared with CIEDE2000
(https://teamcolorcodes.com/nba-team-color-codes/, `/nfl-team-color-codes/`,
`/mlb-color-codes/`, and the individual NHL pages). ΔE under about 2 reads as
the same colour, and over about 10 as clearly different.

- **Teal is the Charlotte Hornets' teal.** Against `#00788C` it measures
  **ΔE 1.4**. fanwire is NBA-only today, so this is the one real hazard in the
  palette.
- **The palette as a set is not anyone's.** Averaging each colour's nearest
  match per team, the closest whole team is the Hornets at **11.3**, then the
  Mariners (11.4) and the 76ers (12.7). The Hornets' identity is purple plus
  teal, and fanwire has no purple.
- Jet Black is ΔE 4.2 from the Houston Texans' deep steel blue `#03202F`. Every
  near-black navy is close to some team's, so this is generic and not a hazard.
- Pale Sky is at least 8.9 from every team colour.

**The verdict: neutral across fan bases, provided teal never dominates the
brand.** A teal icon or a teal-dominant splash screen would read as Hornets to
an NBA fan. That is why the mark is Jet Black and Pale Sky (§1), and why the UI
keeps teal to buttons, badges and links rather than large surfaces.

The alternative considered was shifting the accent to sea green `#077e6a`
(white on it 5.00:1, ΔE 16.9 from the Hornets' teal). The human declined it on
2026-10-05.

### 2.3 Dark mode and colour-vision deficiency

- **Dark mode:** Jet Black is the dark surface and Pale Sky the text on it
  (10.42:1). Teal fails on it (above), which is why `#279ab1` exists.
- **CVD:** simulated protanopia, deuteranopia and tritanopia keep every pair
  apart, with ΔE at least 23.9 among ink, accent and sky. Lightness carries the
  difference, not hue, so the palette survives all three. Under simulated
  deuteranopia the accent-on-dark contrast on ink drops to 4.31. That isn't a
  WCAG failure (WCAG measures the real colours), but it is one more reason not
  to make colour the only cue.

## 3. The mark

### 3.1 Why a wire `f` plus a typeset wordmark

- **`fanwire` is long and all lowercase.** Seven letters with no capital to
  anchor them shrink to a grey smear at 16 px, so the wordmark can't be the
  favicon. Something has to carry 16 px on its own.
- **A monogram of the first letter is that something,** and lowercase rules
  make it an `f`. Its tall ascender and single crossbar survive 16 px when the
  stroke is thick. At 16 px a stroke must be **at least 2 px**, which is
  **about 12–14 % of the icon's width** at every size.
- **Drawing it as a wire,** one continuous line with a visible end such as a
  plug or a curl, ties it to the name. It is also what keeps it from being a
  plain glyph. **The plain `f` is the hazard:** a solid lowercase `f` on a
  coloured square or circle is Facebook's mark. A monoline `f` with a
  wire-specific feature, on Jet Black, is a different shape and colour.
- **The wordmark is typeset, not generated** (`branding-symbol.md` §4.2: text
  rendering is still unreliable). A real font also gives an exact, editable, perfectly spelled
  `fanwire`.

### 3.2 Wordmark lettering

**Chosen 2026-10-05: Outfit SemiBold (600)** ([ADR 0013](../../GeneralContext/Decisions/0013-brand-mark-and-assets.md)). The shortlist was **Outfit, Sora or Manrope**. Each is in `google/fonts` under
`ofl/` with an OFL licence file (checked 2026-10-05, e.g.
https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/OFL.txt). Type
`fanwire` into each one's preview on https://fonts.google.com and pick the one
whose `f` best matches the symbol. The `w` should stay open, and `ire` shouldn't
crowd.

The OFL allows logos: *"Can I use the fonts … to create logos or other graphics
…? Yes."* No acknowledgement is required (OFL FAQ 1.1 and 1.1.2,
https://openfontlicense.org/ofl-faq/). In Inkscape, convert the text to paths
(**Path → Object to Path**) so the SVG doesn't need the font installed.

The UI uses the system font stack (`typography.md` §1), so there is no UI
webfont to match.

## 8. Asset checklist and where each file goes

Vite serves `frontend/public/` at the site root.

| File | Format and size | Destination |
|---|---|---|
| `favicon.svg` | SVG, square, the small-size cut | `frontend/public/favicon.svg` |
| `favicon.ico` | ICO holding 16, 32 and 48 | `frontend/public/favicon.ico` |
| `apple-touch-icon.png` | PNG 180×180, opaque, square corners | `frontend/public/apple-touch-icon.png` |
| `icon-192.png` | PNG 192×192, manifest `purpose: "any"` | `frontend/public/icon-192.png` |
| `icon-512.png` | PNG 512×512, `purpose: "any"` | `frontend/public/icon-512.png` |
| `icon-maskable-512.png` | PNG 512×512, full-bleed, safe zone r = 40 %, `purpose: "maskable"` | `frontend/public/icon-maskable-512.png` |
| `og-image.png` | PNG 1200×630 | `frontend/public/og-image.png` |
| `wordmark-light.png` | PNG 316×84, Jet Black, transparent: the human's cursive wordmark | `frontend/src/assets/brand/wordmark-light.png` |
| `wordmark-dark.png` | PNG 316×84, Pale Sky, transparent | `frontend/src/assets/brand/wordmark-dark.png` |
| `wordmark-light.svg`, `wordmark-dark.svg` | SVG, the typeset wordmark, text as paths | `brand/out/` only; the app does not ship them |
| Masters plus provenance | Inkscape SVGs, the chosen ChatGPT PNG, and `PROVENANCE.md` (prompt, date, model, what was redrawn by hand) | `brand/source/` at the repo root. Not served and not bundled. |

The wordmarks sit under `src/` so the header can import them and Vite
fingerprints them. Everything under `public/` keeps a fixed URL, because the
manifest and crawlers request those paths by name.

## 9. `palette_check.py`

The script behind §2 is
[`brand/tools/palette_check.py`](../../../brand/tools/palette_check.py)
(numpy only); how to run it is [`tokens-check.md`](tokens-check.md). Its maths
was checked against published reference values: black on white gives 21.00:1,
and pure red against pure green gives ΔE2000 86.6.

## 10. Hazards

- **Leagues and teams police their marks.** NBA Properties, Inc. is the
  league's and its teams' licensing agent, and it files oppositions against
  marks it sees as too close, even outside sport. Examples are *NBA Properties
  v. Tiu* over "LAKERS" on clothing
  (https://www.federislaw.com.ph/wp-content/themes/federis/files/BLA%20-%20NBA%20PROPERTIES,%20INC%20vs.%20TIU%20%5BIPC%20NO.%203693%20February%203,%202000%5D.pdf)
  and its Beijing suit over a "Lakers Team" drinks mark
  (https://english.cnipa.gov.cn/transfer/news/localipinformation/922272.htm).
  **Never use** jerseys, numbers on a jersey, crests or shields, a
  league-style silhouette (a player in a vertical bar like the NBA logo), any
  team's colour pair (purple and teal is the Hornets), or real players'
  likenesses **in fanwire's own brand**. That last one is also a
  publicity-rights problem and excluded by Unsplash's licence. Team identity
  inside the app is the separate case below.
- **fanwire never promotes with NBA marks**
  ([ADR 0006](../../GeneralContext/Decisions/0006-no-nba-marks-in-promotion.md)).
  No team or league name, abbreviation, logo, colour pair, player name or
  player image in ads, social posts, app-store listings or screenshots, or
  promo graphics. The risk is implied affiliation: passing off (Trademarks Act
  s.7(b)) and depreciation of goodwill (s.22), both of which bite on use *in
  advertising*.
- **Stats and team names in content are fine.** Game statistics are facts,
  not copyright works (*NBA v. Motorola*, 2d Cir. 1997,
  https://law.justia.com/cases/federal/appellate-courts/F3/105/841/598844/);
  Canadian copyright does not protect facts either. Naming a team to say
  something about it is not "use" of the mark under s.4, which ss.20 and 22
  require (*Clairol* through *Veuve Clicquot*, SCC 2006,
  https://www.smartbiggar.ca/insights/publication/barbie-and-veuve-clicquot----supreme-court-of-canada-clarifies-protection-for-famous-trademarks-in-canada).
  So users may name teams and players in posts. The terms of service should
  instead forbid: uploading media without rights (game footage, NBA photos,
  logos); implying an account is official or affiliated; scraping or reselling
  the site's stats. They should add a takedown route (Canada's notice-and-notice,
  Copyright Act s.41.25, plus a DMCA-style address for US rights holders) and
  the line *"Not affiliated with or endorsed by the NBA, its teams or
  players."* The dataset's own nba.com-terms risk is already accepted
  (`wiki/GeneralContext/Prompts/06-nba-data.md`, decision 1).
- **Team icons (`FRONTEND-031`) are low-to-moderate risk.** Colours can be a
  mark once fans link them to a team: *LSU v. Smack Apparel* (5th Cir. 2008,
  https://www.ca5.uscourts.gov/opinions%5Cpub%5C07/07-30580-CV0.wpd.pdf) found
  infringement from school colours plus school context, without a logo. That
  was merchandise, though, where the colours sold the shirt and the court
  rejected nominative fair use because the use went beyond description. An
  in-app badge that names whose stats a row shows is descriptive. Keep it so:
  the abbreviation as plain text in fanwire's font, never the team's typeface
  or letterforms; data views only, never promotion; and check all 30 icons
  against the real logos, since some teams use a letter in a roundel (the
  Nets' black-and-white "B") and an icon must not read as one.
- **No player headshots without a licence.** Three separate rights apply:
  1. **Copyright in the photo.** Official and media-day headshots belong to
     NBA Entertainment (Getty credits them "Copyright NBAE" and needs NBAE's
     written approval to license them, https://www.gettyimages.com/collection-restrictions);
     nba.com's terms list photographs as NBA Properties' and the teams'
     (https://www.nba.com/terms). Hotlinking `cdn.nba.com` infringes and
     breaches those terms. Any other photo belongs to its photographer.
  2. **The player's personality.** Ontario's tort (*Krouse v. Chrysler*, 1973;
     *Athans v. Canadian Adventure Camps*, 1977,
     https://www.yorku.ca/osgoode/iposgoode/?p=4195), the BC, Saskatchewan,
     Manitoba and Newfoundland privacy acts and Quebec's Civil Code protect a
     likeness against commercial use. *Gould Estate v. Stoddart* (Ont. CA
     1998, https://en.wikipedia.org/wiki/Gould_Estate_v_Stoddart_Publishing_Co_Ltd)
     separates using a person as the subject of content (allowed) from selling
     by association (not).
  3. **Group licensing.** The players' union, through Think450, controls use
     of three or more players together
     (https://www.mondaq.com/unitedstates/sport/677046/national-basketball-players-association-launches-think450-to-handle-marketing-and-licensing-of-nba-players);
     a stats site of hundreds of faces is that use.

  A team-jersey headshot also shows the logos §10 already excludes. The
  options, in order: keep initials avatars; pay for a licensed feed
  (SportsDataIO, Sportradar, Getty), which clears the rights; or use
  Wikimedia Commons photos under their stated CC licence with attribution,
  checking each file and preferring shots without prominent jersey marks.
- **The AI output may resemble an existing logo.** OpenAI warns that output
  *"may not be unique"*. Before adopting a symbol:
  1. **Google Lens** (upload at https://images.google.com, then crop the
     selection box to just the mark) and **TinEye** (https://tineye.com, free
     for non-commercial searches) on the clean PNG.
  2. **The Canadian Trademarks Database**
     (https://ised-isde.canada.ca/cipo/trademark-search/srch): search design
     marks by **Vienna code**. Codes for the letter "f" and for wires or cables
     narrow it to figurative marks
     (https://ised-isde.canada.ca/site/canadian-intellectual-property-office/en/trademarks/additional-search-options).
     Search the word **`fanwire`** too. Done for fanwire's own mark by
     2026-10-06, with nothing similar found (`brand/source/PROVENANCE.md`).
  3. Compare by eye with the obvious single-letter marks: Facebook, Flipboard,
     Tumblr.
  4. If anything is close, iterate (`branding-symbol.md` §6.1) rather than tweak. A small tweak to a
     look-alike is still a look-alike.
- **Teal-dominant surfaces** read as Hornets (§2.2).
- None of this is legal advice. Talk to a Canadian trademark agent before
  filing a registration.

## Parts

- [`branding-rights.md`](branding-rights.md): §4.3 and §5, what you would and would not own in Canada, and the free resources with their licences.
- [`branding-symbol.md`](branding-symbol.md): §4.1–§4.2 and §6, using ChatGPT for the symbol, and the ready-to-paste prompts.
- [`branding-export.md`](branding-export.md): §7, tracing, the master SVGs and exporting the icon set.

Section numbers carry over into the parts, so a `branding.md` citation of a
moved section is found through these headings:

### 4.1 How to use it today

[`branding-symbol.md`](branding-symbol.md) §4.1.

### 4.2 What it's bad at

[`branding-symbol.md`](branding-symbol.md) §4.2.

### 4.3 Rights: what you would and would not own (Canada)

[`branding-rights.md`](branding-rights.md) §4.3.

### 5. Free resources: at most three

[`branding-rights.md`](branding-rights.md) §5.

### 6. Ready-to-paste ChatGPT prompts

[`branding-symbol.md`](branding-symbol.md) §6.

### 7. Conversion and export, all free

[`branding-export.md`](branding-export.md) §7.
