# 12 — Branding research: colour, mark and how to make them

**Objective:** research and recommend fanwire's branding (colour and visual
identity), then tell the human exactly how to produce the assets, free of
charge. **Scope is strictly colour and branding**: the palette, a wordmark, a
symbol or app icon, a favicon, a social-preview image, and any brand imagery
the site needs. UI layout, components and the UI typeface belong to `11`.

**You cannot make images, and you don't need to.** The human fetches or
generates them. Your job is to point them at a free resource and give them
instructions precise enough to follow without you. The human has **ChatGPT Plus
(a free month)** to use for image generation.

**Read first:** `00-session-protocol.md` (you are a Director);
`wiki/CodeContext/FrontendUI/decisions.md`, the human's decisions, which outrank
your recommendations; `wiki/GeneralContext/Architecture/business-rules.md`
(what fanwire is for); and `wiki/CodeContext/FrontendUI/` if `11` has already
built it, especially `direction.md` and `tokens.md`.

**Fixed inputs:**
- The name is always lowercase: `fanwire`.
- There is no wordmark and no icon.
- The palette is Jet Black `#022b3a`, Teal `#1f7a8c` and Pale Sky `#bfdbf7`.
  Its measured contrast table, including the teal-on-dark trap, is in
  `decisions.md`.

## Research, with sources

**Verify everything that is time-sensitive with web research, and cite the URL
and the date you read it.** That covers licence terms, product features, model
names, usage limits and what a free tier includes. None of it is to be stated
from memory: these things change, and the human will act on what you write.

1. **Colour.** Does the palette hold up for a sports app? Check:
   - Is it distinct from the major leagues and the most-followed teams?
   - Does it read as neutral across rival fan bases, or does it look like one
     team's colours?
   - How does it hold up in dark mode, and for the common colour-vision
     deficiencies?

   Recommend keeping, extending or changing it. Any proposed colour comes with
   its contrast ratios **computed, not estimated**: run a small script and show
   the numbers. The palette changes only if the human accepts the change.
2. **Mark strategy.** Choose between a wordmark only, a symbol plus a wordmark,
   or a monogram. Explain how lowercase `fanwire` constrains the choice, and
   what works at 16 px (the favicon) as well as at 512 px.
3. **AI generation with ChatGPT.** Establish:
   - **How to use it today:** which feature or model in ChatGPT Plus makes
     images, how to ask for a transparent background, the aspect ratios it
     supports, the output format and resolution, and any usage caps.
   - **What it is bad at,** text rendering in particular. If it can't reliably
     spell `fanwire`, recommend typesetting the wordmark in a free font and
     using AI for the symbol only.
   - **The rights:** OpenAI's current terms on owning and using outputs
     commercially. Also whether AI-generated art can be protected (copyright or
     trademark) in the human's jurisdiction. Ask the human which jurisdiction
     that is if it matters. Say plainly what the human would and would not own.
4. **Free stock and asset libraries.** Find candidates for brand imagery and
   icons and verify each one's current licence: commercial use, attribution, and
   whether it may be used in a logo or trademark. Many free licences forbid
   that. Starting points to check rather than trust: Unsplash, Pexels, Openverse,
   Google Fonts (OFL), Lucide, Tabler Icons. Recommend at most two or three.
5. **Tooling the human needs, free.** Converting a raster mark to a clean SVG
   (e.g. Inkscape's Trace Bitmap) and generating the favicon and icon set. Give
   the steps.
6. **Hazards.** Sports leagues and teams police their marks, so steer away from
   jerseys, team-like crests, league silhouettes and real players' likenesses.
   Also cover the risk that an AI output resembles an existing logo, and how to
   check (e.g. a reverse image search).

**Checkpoint with the human before writing the wiki.** Present two or three
brand directions in a few lines each, with your recommendation, and ask them to
choose. Ask about a colour change separately from the mark.

## Write it into `wiki/CodeContext/FrontendUI/`

- **`branding.md`, which you own:**
  - the research, condensed to the conclusions, with sources and dates;
  - the chosen direction;
  - an **asset checklist** with exact formats and pixel sizes: SVG favicon,
    `.ico` fallback, `apple-touch-icon` at 180, PWA icons at 192 and 512 (plus
    maskable), an Open Graph image at 1200×630, and the wordmark as SVG, light
    and dark;
  - **ready-to-paste ChatGPT prompts** for each asset that is to be generated,
    three variants each, with how to iterate on a result and what to reject;
  - the conversion and export steps;
  - where each finished file goes in the repo (`frontend/public/` and so on).
    Placing the files and wiring `index.html` is a later implementation unit,
    not this session.
- **`decisions.md`:** append the human's choices from the checkpoint, dated. Never
  rewrite an existing entry. If the palette changes, update its table and the
  contrast numbers together.
- **`tokens.md`:** if `11` has created it and the palette changed, update the
  colour values and the contrast table to match, and say so in the PR.
- **`index.md`:** if the folder has none yet, create a minimal one that lists
  `decisions.md` and `branding.md`; `11` will expand it.

Then create `TODO/05-branding-assets.md` for the human: a short, ordered list
of what to generate or fetch, and how to hand each file back (commit it, or
give the agent its path). Follow `TODO/README.md`'s rules: PowerShell, one
command per line. Delete that TODO file once the assets are in the repo.

Update `wiki/GeneralContext/index.md` (prompt status), and say in the PR body
that you wrote `wiki/GeneralContext/`.

## Out of scope

- Generating images, and any change under `frontend/`.
- The UI typeface, layout and components: `11`. If `11` hasn't run, don't wait
  for it. Either order works; whichever runs second reconciles with the first.
- Paid tools or paid stock. If the best option is paid, say so, then give the
  best free one.

One PR, on a human-named branch. Merge nothing.
