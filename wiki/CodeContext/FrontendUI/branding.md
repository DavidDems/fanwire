# FrontendUI — branding

> The UI typeface is the system font stack (`typography.md`, decided 2026-10-06), so §3.2's "prefer the UI font" advice is moot; the wordmark stays Outfit 600 as SVG paths.

**Agent-facing.** fanwire's brand: the colour verdict, the mark, how the human
makes the assets for free, and where each finished file goes. Written by
`wiki/GeneralContext/Prompts/12-branding-research.md` on 2026-10-05.

`decisions.md` outranks this page. The choices below were made by the human at
this session's checkpoint and are recorded there, dated. Everything else here is
research and recommendation.

**Scope is colour and identity only.** The UI typeface, layout and components
belong to `11`'s pages. Placing the asset files and wiring `index.html` and the
manifest is a later implementation unit, not this page.

Every time-sensitive fact below has its source and the date it was read. All
were read on **2026-10-05** unless a different date is given. Re-check any of
them before acting on them after a few months.

---

## 1. Decided direction

| | Decision |
|---|---|
| **Mark** | **Symbol plus wordmark.** The symbol is a lowercase **`f` drawn as one continuous wire line**. The wordmark is lowercase `fanwire` **typeset in a free OFL font**, not generated. The symbol alone is the favicon and app icon. |
| **Palette** | **Keep** Jet Black `#022b3a`, Teal `#1f7a8c` and Pale Sky `#bfdbf7`, and **add** `--color-accent-on-dark` `#279ab1` for links and focus rings on dark surfaces. |
| **Mark colours** | **Jet Black and Pale Sky, not teal.** The icon is a Pale Sky wire `f` on a Jet Black tile (10.42:1). Teal stays a UI accent. |
| **Jurisdiction** | Canada (the human's answer). It shapes §4.3. |

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

The first four rows correct the figures first recorded in `decisions.md`
(15.2 / 10.6 / 5.0 / 3.1). Only the teal-on-dark verdict gets worse, and it now
fails the non-text threshold too. The correction is appended there, dated.

**`#279ab1` has almost no margin.** It is the darkest shade of Teal's hue that
reaches 4.5:1 on Jet Black, so a tool that rounds or a slightly different dark
surface tips it under. If `11` puts it on anything other than exactly `#022b3a`,
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
an NBA fan. That is why the mark is Jet Black and Pale Sky (§1), and why `11`
should keep teal to buttons, badges and links rather than large surfaces.

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
- **The wordmark is typeset, not generated** (§4.2: text rendering is still
  unreliable). A real font also gives an exact, editable, perfectly spelled
  `fanwire`.

### 3.2 Wordmark lettering

**Chosen 2026-10-05: Outfit SemiBold (600)** (`decisions.md`). The shortlist was **Outfit, Sora or Manrope**. Each is in `google/fonts` under
`ofl/` with an OFL licence file (checked 2026-10-05, e.g.
https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/OFL.txt). Type
`fanwire` into each one's preview on https://fonts.google.com and pick the one
whose `f` best matches the symbol. The `w` should stay open, and `ire` shouldn't
crowd.

The OFL allows logos: *"Can I use the fonts … to create logos or other graphics
…? Yes."* No acknowledgement is required (OFL FAQ 1.1 and 1.1.2,
https://openfontlicense.org/ofl-faq/). In Inkscape, convert the text to paths
(**Path → Object to Path**) so the SVG doesn't need the font installed.

If `11` has picked the UI typeface by then, prefer that font, or one that sits
well beside it. Whichever of `11` and `12` runs second reconciles.

## 4. ChatGPT for the symbol

### 4.1 How to use it today

- **Model:** ChatGPT Images 2.5, released 2026-09-08, *"available to all
  ChatGPT, ChatGPT Work, and Codex users across desktop, mobile, and web"*
  (https://openai.com/index/introducing-chatgpt-images-2-5/). Plus also gets
  **images with thinking**: select the *Thinking* model and it *"can plan and
  refine image outputs before generating them"*. Use that for the symbol
  (https://help.openai.com/en/articles/6825453-chatgpt-release-notes, entry of
  2026-04-21).
- **Where:** ask in any chat, or open **Images** in the sidebar (or **More →
  Images**). Templates include a logo template, but write your own prompt from
  §6 instead (https://help.openai.com/en/articles/11084440-images-in-chatgpt).
- **Aspect ratio:** *"Use the aspect ratio picker … or include your desired
  aspect ratio in your prompt"* (same article). Use **1:1** for the symbol and
  the closest wide ratio for the Open Graph background. In the API, the same
  model family accepts 1:3 to 3:1 with no edge over 3840 px
  (https://developers.openai.com/api/docs/guides/image-generation).
- **Transparent background:** the help article says ChatGPT *"can follow
  instructions to … make the background transparent"*. The API has had a real
  `background: "transparent"` setting since 2026-08-20
  (https://developers.openai.com/api/docs/changelog). In the app, users report
  it is inconsistent: a fake checkerboard or a solid background instead of
  alpha (https://community.openai.com/t/having-trouble-getting-transparent-backgrounds-in-chatgpt-images/1380143,
  May 2026). **Don't depend on it.** Ask for a flat pure-white background. The
  Inkscape trace (§7) discards the background anyway.
- **Format and resolution:** the help article doesn't state what **Save**
  downloads. The API defaults to PNG, with recommended sizes of 1024×1024,
  1536×1024 and 1024×1536. Neither matters here, because the symbol is traced
  to vector and a 1024 px source is plenty.
- **Usage caps:** **OpenAI publishes no number.** The 2026-09-08 release note
  says only *"Existing image-generation limits are unchanged"*. Third-party
  figures (for example "40–50 per 3 hours") are user reports, not OpenAI's.
  Expect to iterate 10–30 times on the symbol, which is well inside any
  reported cap.
- **Provenance:** OpenAI adds C2PA metadata and an invisible watermark to
  generated images (Images 2.5 post). The traced SVG carries neither. Keep the
  chosen raster in `brand/source/` (§8) as the provenance record.

### 4.2 What it's bad at

- **Text.** OpenAI's own docs say *"the model can still struggle with precise
  text placement and clarity"* (API image guide, "Limitations"). That is why
  the wordmark is typeset.
- **Consistency across generations:** it *"may occasionally struggle to
  maintain visual consistency for … brand elements across multiple
  generations"* (same section). Generate the symbol **once**, trace it, and
  derive every size from the SVG. Never re-generate per size.
- **Precise geometry:** stroke widths drift and curves wobble. The trace and a
  node cleanup (§7) fix that, and the cleanup is human work that strengthens
  your claim to the result (§4.3).

### 4.3 Rights: what you would and would not own (Canada)

- **OpenAI's terms** (effective 2026-01-01,
  https://openai.com/policies/terms-of-use/): *"you … own the Output. We hereby
  assign to you all our right, title, and interest, if any, in and to
  Output."* Commercial use is allowed. Three caveats in the same document: the
  assignment covers rights **"if any"** exist; *"other users may receive
  similar output … Our assignment above does not extend to other users'
  output"*; and you may not *"Represent that Output was human-generated when it
  was not."* The assignment survives the end of the free Plus month.
- **Copyright in Canada is unsettled.** The only test case is *CIPPIC v Sahni*
  (Federal Court T-1717-24). It challenges a 2021 copyright registration that
  lists an AI tool as co-author, arguing that an AI can't be an author and the
  work lacks originality. As of CIPPIC's case page, the parties were *"waiting
  for the Court to set a hearing date"* (https://www.cippic.ca/our-work/cippic-v-sahni).
  Music Publishers Canada intervened in July 2026, so the case is still live
  (https://www.musicpublishing.ca/news/2026-7-22-music-publishers-canada-intervenes-in-landmark-federal-court-case-on-ai-and-copyright).
  CIPO registers copyright without examining it, so that registration settles
  nothing. For comparison, the US position is that purely AI-generated material
  isn't copyrightable (Copyright Office report, Part 2, January 2025), and the
  US Supreme Court declined *Thaler v. Perlmutter* on 2026-03-02
  (https://www.mayerbrown.com/en/insights/publications/2026/03/supreme-court-denies-review-in-ai-authorship-case).
- **Trademark is the protection that matters for a logo, and it doesn't turn
  on authorship.** Canada's Trademarks Act defines a trademark by what it does:
  *"a sign or combination of signs that is used or proposed to be used … to
  distinguish"* goods or services. Canada is a first-to-use jurisdiction, and
  registration needs distinctiveness and no confusion with existing marks
  (https://www.mondaq.com/canada/ip/1425930/trademarks-comparative-guide).
  Nothing in that test asks who drew the mark. That is an inference from the
  definition, not a ruling, so ask a lawyer before filing.

**Plainly:**

- **You would own:** the right to use the symbol commercially; trademark rights
  in Canada, which come from using it (and registration if you file); and
  copyright in the human work, meaning your redraw, cleanup and composition.
- **You would not reliably own:** copyright in the raw ChatGPT image.
- **You could not stop** someone else who independently gets a similar output.
- **You never own the font.** The OFL licenses its use, including in a logo.

## 5. Free resources: at most three

| Use | Resource | Licence (read 2026-10-05) | In the logo? |
|---|---|---|---|
| Wordmark lettering | **Google Fonts** (Outfit, Sora or Manrope) | SIL OFL 1.1. Logos are explicitly allowed and no attribution is needed (OFL FAQ 1.1, 1.1.2). | **Yes** |
| UI icons (`11` confirms) | **Lucide** (https://lucide.dev/license) | ISC: *"use, copy, modify, and/or distribute … for any purpose"*, keeping the notice. Some icons are MIT (from Feather). | **No.** An icon anyone can download can't be a distinctive mark, and other apps already use the same glyphs. |
| Photography, if any | **Unsplash** (https://unsplash.com/license) | Free commercial use, no attribution, no selling unmodified copies, no competing service. Per https://unsplash.com/terms the licence *excludes* "Trademarks, logos, or brands that appear in Images" and recognisable people. | **No.** Avoid any photo showing a team logo, jersey, arena branding or a recognisable player. |

The rest were checked and rejected:

- **Tabler Icons:** MIT, equally fine. Lucide is preferred only to keep one
  icon set, and `11` decides.
- **Pexels:** forbids use *"as part of your trade-mark, design-mark,
  trade-name, business name or service mark"* (https://www.pexels.com/license/).
  Fine for imagery, never for the mark.
- **Openverse:** it *"does not verify its licensing status"*, so the user must
  verify each item (https://docs.openverse.org/terms_of_service.html). That is
  too much risk for a solo project.
- Paid stock isn't needed. Nothing here requires it.

**Does the site need brand imagery at all?** Not for v1. The Open Graph card
(§6.2) is the only brand image the site needs. If a guest landing hero is wanted
later, use an Unsplash basketball photo with no logos or faces, or variant C of
§6.2.

## 6. Ready-to-paste ChatGPT prompts

Select the **Thinking** model. Paste one variant per new chat, so earlier
attempts don't pull the result. Generate 3–4 images per variant before judging.

### 6.1 The symbol: a wire `f` (1:1)

**Variant A, the plug end:**
```text
Design a minimal flat vector logo symbol: a lowercase letter "f" drawn as ONE continuous line of wire with a perfectly uniform thick stroke and rounded ends. The bottom of the f's stem ends in a small, simple plug or connector shape; the top curls over like a bent wire. Solid single colour #022b3a on a pure flat white #FFFFFF background. No gradients, no shadows, no 3D, no texture, no other letters or words, no frame, no background shape. Centered, generous empty margin on all sides, square 1:1. It must still read clearly as an "f" when shrunk to 16 pixels, so keep it bold and simple with no fine detail.
```

**Variant B, the crossbar loop:**
```text
Minimal flat vector monogram: lowercase "f" formed from a single unbroken wire line of uniform heavy stroke weight. The crossbar is made by the wire looping once around the stem before continuing, like a wire tied in a single neat loop. Rounded line caps. Solid #022b3a on pure white #FFFFFF, flat, no gradient, no shadow, no texture, no outline around it, no text. Centered with wide margins, 1:1 square. Geometric and clean, legible at favicon size (16 px).
```

**Variant C, the signal end:**
```text
A clean geometric logo mark: a lowercase "f" built from one continuous thick monoline, as if bent from a single piece of wire, with rounded terminals. The top hook of the f extends into a short spark or signal of two small parallel arcs, suggesting a live wire. Flat solid colour #022b3a only, on a flat pure-white #FFFFFF background. No gradients, shading, 3D, texture, or additional words or letters. Square 1:1, centered, lots of empty space around it, bold enough to work at 16x16 pixels.
```

**Iterating:** don't re-roll a near miss. Select the image and ask for one
change at a time, for example *"keep everything identical but make the stroke
about 30% thicker"*, *"remove the small detail at the top; keep the rest
exactly"*, or *"make the line weight perfectly uniform"*. The editor's
selection tool is imprecise, and *"edits may extend beyond the area you
selected"* (help article), so compare against the previous version each time.

**Reject an image that:**

- reads as the **Facebook** logo (a solid `f` in a square or circle), or as
  another single-letter app mark (Flipboard, Tumblr's `t`);
- has any second letter, text, ball, jersey, crest, shield, star or flame, or
  anything sport-team-like (§10);
- has gradients, shadows or 3D, or a stroke that thins in places, since thin
  parts vanish at 16 px;
- has a detail that disappears when you shrink it. Test by viewing the PNG at
  16 px in Windows Photos, or zoom the browser to 10 %;
- matches an existing logo in the §10 similarity check.

### 6.2 Open Graph background (optional, 1200×630)

The Open Graph card is **composed in Inkscape** (§7.4) from the symbol and the
wordmark, so its text is exact. AI is used here only for an optional background
texture, and the plain Jet Black version is a perfectly good card. If wanted,
pick the widest landscape ratio (or ask for 1.91:1):

**Variant A:**
```text
Abstract minimal background, wide landscape 1.91:1. Deep navy #022b3a field with a few smooth, thin, flowing lines like loose wires or cables in teal #1f7a8c and pale blue #bfdbf7, sweeping in from the right edge only. The left two-thirds stay almost empty for text to be placed later. Flat vector style, no text, no letters, no logos, no people, no sports equipment.
```

**Variant B:**
```text
Wide 1.91:1 flat graphic background: solid #022b3a with a subtle network of thin straight lines and small nodes in #1f7a8c at low contrast, densest at the right edge and fading out toward the left. Calm, modern, lots of negative space. No text, no logos, no balls, jerseys or players, no gradients beyond the background.
```

**Variant C:**
```text
Minimal abstract landscape 1.91:1: a dark navy (#022b3a) surface with two or three long continuous wire-like curves in pale sky blue (#bfdbf7) that cross and connect once near the right side, suggesting fans connecting. Clean flat vector look, no texture, no text or lettering, no sports imagery, large empty area on the left.
```

**Reject:** any letters (the model sometimes adds fake text), any ball, court,
jersey or player, and busy right-hand detail that would fight the logo.

## 7. Conversion and export, all free

Install once (PowerShell, one command per line):

```powershell
winget install -e --id Inkscape.Inkscape
winget install -e --id ImageMagick.ImageMagick
```

Inkscape's current release is 1.4.4, released 2026-05-06
(https://inkscape.org/release/). The ImageMagick winget id was checked on
https://winget.run/pkg/ImageMagick/ImageMagick. Open a new PowerShell window
after installing so `magick` is on the path.

### 7.1 Raster to clean SVG

Following the Inkscape Beginners' Guide
(https://inkscape-manuals.readthedocs.io/en/latest/tracing-an-image.html):

1. **File → Import** the chosen PNG. Select it.
2. **Path → Trace Bitmap** (Shift+Alt+B). Mode **Single scan → Brightness
   cutoff**, which is *"the most frequently used mode"* and ideal for *"dark
   silhouettes in front of a bright background"*, as the symbol is. Click
   **Update**, adjust the threshold until the edges are clean, then **Apply**.
3. Drag the traced path aside and **delete the bitmap**.
4. Select the path and run **Path → Simplify** (Ctrl+L) once or twice, until the
   curves are smooth but the shape is unchanged. Fix any lump with the node
   tool (N).
5. **Better still, redraw:** with the trace as a guide, draw the wire with the
   Bezier tool (B) as a stroked line at your chosen width. Then use **Path →
   Stroke to Path** and delete the trace. You get a perfectly uniform stroke,
   and the result is more clearly your own work (§4.3).
6. Set the fill to the colours in §1. Save as **Inkscape SVG** into
   `brand/source/` (the editable master), then **Save a Copy → Optimized SVG**
   for the shipped files.

### 7.2 Master SVGs to make

| Master | Content |
|---|---|
| `symbol-tile.svg` | 512×512 page. A Jet Black `#022b3a` rounded square filling it, with the Pale Sky `#bfdbf7` wire `f` centred at about 70 % of the height. Used for the `any` icons (192, 512). |
| `symbol-square.svg` | The same with **no rounded corners** (full-bleed Jet Black). For `apple-touch-icon.png`: iOS rounds the corners itself, and transparent corners would show as black. |
| `symbol-favicon.svg` | **The small-size cut.** The tile with the `f` at about 80 % of the height and its outline thickened by a 28-unit Pale Sky stroke on the 512 page. At 70 % with no thickening, the stem is under 1 px at 16 px and the plug smears. Much heavier (a 60-unit stroke) reads at 16 px but turns into a Facebook-like `f` at 32 px. Checked by rendering at 16, 32 and 48 px on 2026-10-05. Used for `favicon.svg` and `favicon.ico`. |
| `symbol-maskable.svg` | 512×512 page with **full-bleed** Jet Black and no rounded corners. The `f` fits inside the central circle of **radius 40 % of the width** (the maskable safe zone, https://web.dev/articles/maskable-icon), so about 60 % of the height. |
| `wordmark-light.svg` | Typeset `fanwire` (converted to paths) in Jet Black, transparent background. For light surfaces. |
| `wordmark-dark.svg` | The same in Pale Sky. For dark surfaces. |
| `og-image.svg` | 1200×630 page with a Jet Black field (or the §6.2 background), the symbol and the Pale Sky wordmark in the left two-thirds, optionally one line of tagline. Keep important content away from the edges, because some platforms crop. |

Set the page size in **File → Document Properties**, and use **Edit → Resize
Page to Selection** where useful.

### 7.3 Export the icon set

Run from the folder holding the masters. One command per line. The Inkscape
CLI flags are from https://wiki.inkscape.org/wiki/Using_the_Command_Line, and
`icon:auto-resize`, which needs a 256×256 input, is from
https://imagemagick.org/script/defines.php.

```powershell
New-Item -ItemType Directory -Force .\out
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-favicon.svg --export-type=png --export-filename=.\out\favicon-256.png -w 256 -h 256
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-square.svg --export-type=png --export-filename=.\out\apple-touch-icon.png -w 180 -h 180
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-tile.svg --export-type=png --export-filename=.\out\icon-192.png -w 192 -h 192
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-tile.svg --export-type=png --export-filename=.\out\icon-512.png -w 512 -h 512
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-maskable.svg --export-type=png --export-filename=.\out\icon-maskable-512.png -w 512 -h 512
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\og-image.svg --export-type=png --export-filename=.\out\og-image.png -w 1200 -h 630
magick .\out\favicon-256.png -define icon:auto-resize=48,32,16 .\out\favicon.ico
```

`favicon.svg` is a copy of `symbol-favicon.svg`.

**Check before handing back:**

- Open `favicon.ico` and confirm the 16 px frame still reads as an `f`.
- Drop `icon-maskable-512.png` into https://maskable.app/ and confirm nothing is
  clipped in the circle shape.
- `og-image.png` is exactly 1200×630 (right-click → Properties → Details).

### 7.4 Online alternative

https://realfavicongenerator.net/ takes one image and produces the whole set,
including an SVG favicon. It is a third-party upload, and its pricing and
account terms weren't stated on the page read on 2026-10-05. The local
commands above need neither, so they are the recommended route.

## 8. Asset checklist and where each file goes

Placing these files and wiring `index.html` and the manifest is a **later
implementation unit**. This table is its input. Vite serves `frontend/public/`
at the site root, and that folder doesn't exist yet. The unit creates it.

| File | Format and size | Destination |
|---|---|---|
| `favicon.svg` | SVG, square, the small-size cut | `frontend/public/favicon.svg` |
| `favicon.ico` | ICO holding 16, 32 and 48 | `frontend/public/favicon.ico` |
| `apple-touch-icon.png` | PNG 180×180, opaque, square corners | `frontend/public/apple-touch-icon.png` |
| `icon-192.png` | PNG 192×192, manifest `purpose: "any"` | `frontend/public/icon-192.png` |
| `icon-512.png` | PNG 512×512, `purpose: "any"` | `frontend/public/icon-512.png` |
| `icon-maskable-512.png` | PNG 512×512, full-bleed, safe zone r = 40 %, `purpose: "maskable"` | `frontend/public/icon-maskable-512.png` |
| `og-image.png` | PNG 1200×630 | `frontend/public/og-image.png` |
| `wordmark-light.svg` | SVG, Jet Black, text as paths | `frontend/src/assets/brand/wordmark-light.svg` |
| `wordmark-dark.svg` | SVG, Pale Sky, text as paths | `frontend/src/assets/brand/wordmark-dark.svg` |
| Masters plus provenance | Inkscape SVGs, the chosen ChatGPT PNG, and `PROVENANCE.md` (prompt, date, model, what was redrawn by hand) | `brand/source/` at the repo root. Not served and not bundled. |

The wordmarks sit under `src/` so the header can import them and Vite
fingerprints them. Everything under `public/` keeps a fixed URL, because the
manifest and crawlers request those paths by name.

## 9. `palette_check.py`

This is the script behind §2. It needs only numpy. Run
`python palette_check.py name=#hex …` to test a candidate colour against the
palette, the team list and CVD.

<details><summary>Source</summary>

```python
"""fanwire palette check: WCAG 2.1 contrast, CIEDE2000 distance to team colours,
and colour-vision-deficiency simulation (Machado, Oliveira & Fernandes 2009,
severity 1.0). numpy only."""
import sys
import numpy as np

PALETTE = {"ink": "#022b3a", "accent": "#1f7a8c", "sky": "#bfdbf7"}
EXTRA = dict(arg.split("=") for arg in sys.argv[1:])  # name=#hex candidates

def rgb(h): h = h.lstrip("#"); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)]) / 255
def lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def unlin(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
def lum(c): return float(lin(c) @ [0.2126, 0.7152, 0.0722])
def ratio(a, b): la, lb = sorted([lum(a), lum(b)], reverse=True); return (la + 0.05) / (lb + 0.05)

def lab(c):
    xyz = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750],
                    [0.0193339, 0.1191920, 0.9503041]]) @ lin(c) / [0.95047, 1.0, 1.08883]
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])

def de2000(c1, c2):
    L1, a1, b1 = lab(c1); L2, a2, b2 = lab(c2)
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2); Cb = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cb**7 / (Cb**7 + 25**7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    if C1p * C2p == 0: dh = 0
    elif dh > 180: dh -= 360
    elif dh < -180: dh += 360
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    if C1p * C2p == 0: hbp = hs
    elif abs(h1p - h2p) <= 180: hbp = hs / 2
    else: hbp = (hs + 360) / 2 if hs < 360 else (hs - 360) / 2
    T = (1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp))
         + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63)))
    dtheta = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbp**7 / (Cbp**7 + 25**7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -np.sin(np.radians(2 * dtheta)) * Rc
    return float(np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)))

CVD = {  # Machado et al. 2009, severity 1.0, applied in linear RGB
    "protanopia": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deuteranopia": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    "tritanopia": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
def simulate(c, kind): return unlin(np.array(CVD[kind]) @ lin(c))
def hx(c): return "#" + "".join(f"{round(v * 255):02x}" for v in np.clip(c, 0, 1))

TEAMS = {  # teamcolorcodes.com, read 2026-10-05 (excerpt: the near neighbours;
           # the full run used every NBA/NFL/MLB colour on the league pages)
    "Charlotte Hornets teal": "#00788C", "Charlotte Hornets purple": "#1D1160",
    "San Jose Sharks Pacific teal": "#006D75", "Jacksonville Jaguars teal": "#006778",
    "Jacksonville Jaguars black": "#101820", "Miami Dolphins aqua": "#008E97", "Miami Dolphins blue": "#005778",
    "Philadelphia Eagles midnight green": "#004C54", "Seattle Mariners NW green": "#005C5C",
    "Seattle Mariners navy": "#0C2C56", "Seattle Kraken deep sea blue": "#001628",
    "Seattle Kraken ice blue": "#99D9D9", "Seattle Kraken shadow blue": "#68A2B9",
    "Seattle Kraken boundless blue": "#355464", "Houston Texans deep steel blue": "#03202F",
    "Tampa Bay Rays light blue": "#8FBCE6", "Miami Marlins blue": "#41748D",
    "Memphis Grizzlies beale st blue": "#5D76A9", "Memphis Grizzlies navy": "#12173F",
    "Denver Nuggets midnight blue": "#0E2240", "Minnesota Timberwolves blue": "#236192",
    "Dallas Mavericks silver": "#B8C4CA", "NBA logo blue": "#1D428A", "Vancouver Canucks dark blue": "#041C2C",
}

def main():
    W = rgb("#ffffff")
    cols = {**PALETTE, **EXTRA}
    print("== WCAG 2.1 contrast ==")
    names = list(cols) + ["white"]; vals = {**{n: rgb(h) for n, h in cols.items()}, "white": W}
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            print(f"  {a:>10} / {b:<10} {ratio(vals[a], vals[b]):5.2f}:1")
    print("== nearest team colours (CIEDE2000) ==")
    for n, h in cols.items():
        near = sorted((de2000(rgb(h), rgb(t)), tn, t) for tn, t in TEAMS.items())[:3]
        print(f"  {n:>10} {h}: " + "; ".join(f"{tn} {t} dE={d:.1f}" for d, tn, t in near))
    print("== colour-vision deficiency (simulated) ==")
    for kind in CVD:
        sim = {n: simulate(v, kind) for n, v in vals.items() if n != "white"}
        print(f"  {kind}: " + ", ".join(f"{n}->{hx(c)}" for n, c in sim.items()))
        keys = list(sim)
        for i, a in enumerate(keys):
            for b in keys[i + 1:]:
                print(f"     {a}/{b}: dE={de2000(sim[a], sim[b]):5.1f} contrast={ratio(sim[a], sim[b]):.2f}:1")

if __name__ == "__main__":
    main()
```

Sanity checks run on 2026-10-05: black on white gives 21.00:1, and pure red
against pure green gives ΔE2000 86.6, matching published reference values.

</details>

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
  likenesses. That last one is also a publicity-rights problem and excluded by
  Unsplash's licence.
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
  4. If anything is close, iterate (§6.1) rather than tweak. A small tweak to a
     look-alike is still a look-alike.
- **Teal-dominant surfaces** read as Hornets (§2.2).
- None of this is legal advice. Talk to a Canadian trademark agent before
  filing a registration.
