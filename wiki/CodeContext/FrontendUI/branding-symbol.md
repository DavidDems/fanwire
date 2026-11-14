---
type: runbook
---

# FrontendUI — branding: the symbol with ChatGPT

Part of [branding.md](branding.md). How the human generates the wire-`f` symbol concept, and optionally an Open Graph background, before tracing and exporting them ([branding-export.md](branding-export.md)).

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
  Inkscape trace (`branding-export.md` §7) discards the background anyway.
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
  chosen raster in `brand/source/` (`branding.md` §8) as the provenance record.

### 4.2 What it's bad at

- **Text.** OpenAI's own docs say *"the model can still struggle with precise
  text placement and clarity"* (API image guide, "Limitations"). That is why
  the wordmark is typeset.
- **Consistency across generations:** it *"may occasionally struggle to
  maintain visual consistency for … brand elements across multiple
  generations"* (same section). Generate the symbol **once**, trace it, and
  derive every size from the SVG. Never re-generate per size.
- **Precise geometry:** stroke widths drift and curves wobble. The trace and a
  node cleanup (`branding-export.md` §7) fix that, and the cleanup is human
  work that strengthens your claim to the result (`branding-rights.md` §4.3).

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
  anything sport-team-like (`branding.md` §10);
- has gradients, shadows or 3D, or a stroke that thins in places, since thin
  parts vanish at 16 px;
- has a detail that disappears when you shrink it. Test by viewing the PNG at
  16 px in Windows Photos, or zoom the browser to 10 %;
- matches an existing logo in the `branding.md` §10 similarity check.

### 6.2 Open Graph background (optional, 1200×630)

The Open Graph card is **composed in Inkscape** (`branding-export.md` §7.2) from the symbol and the
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
