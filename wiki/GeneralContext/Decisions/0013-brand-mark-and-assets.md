---
type: decision
---

# 0013 - Brand mark and assets

Decision: 2026-10-05 (the mark and the assets), 2026-10-06 (the similarity
check) and 2026-11-03 (the header wordmark), the human.

## Context

`fanwire` is long and all lowercase, so a wordmark alone can't carry 16 px
(`wiki/CodeContext/FrontendUI/branding.md` §3.1). The branding research (`wiki/CodeContext/FrontendUI/branding.md`) compared
marks, colours, rights and free tools, and the choices below were made at its
checkpoint and after the assets were made.

## Choice

- **Symbol plus wordmark.** The symbol is a lowercase `f` drawn as **one
  continuous wire line**, alone as the favicon and app icon. The wordmark is
  lowercase `fanwire` **typeset in a free OFL font** (shortlist Outfit, Sora,
  Manrope), never AI-generated.
- **The mark is Jet Black and Pale Sky, not teal**: a Pale Sky wire `f` on a
  Jet Black tile.
- **The human produces the assets** with ChatGPT (symbol concept only),
  Inkscape and ImageMagick, following `wiki/CodeContext/FrontendUI/branding.md`.
- **Jurisdiction for rights questions: Canada.**
- **Symbol:** the wire `f` with a plug at the foot of the stem, generated from
  `wiki/CodeContext/FrontendUI/branding-symbol.md` §6.1 variant A and traced by the human. Masters and
  provenance are in `brand/source/` (`PROVENANCE.md`), and the exports in
  `brand/out/`. The human approved the icons and the colour treatment.
- **Wordmark font: Outfit SemiBold (600)**, chosen from the Outfit, Sora and
  Manrope shortlist. The wordmark is SVG paths, so it doesn't load the font.
- **Similarity check:** Google Lens and TinEye found no matches (2026-10-05).
  The human searched the Canadian Trademarks Database (2026-10-06): the word
  `fanwire` returned nothing, and among the design marks built on an `f`, none
  uses a plug and none is similar to the symbol. The record is in
  `brand/source/PROVENANCE.md`. This is a clearance search, not legal advice:
  a registration filing would still go through a trademark agent.
- **The header (2026-11-03):** the header shows the human's slightly cursive
  `fanwire` wordmark (a PNG, recoloured to transparent
  `brand/out/wordmark-light.png` and `wordmark-dark.png`) and no symbol. The
  favicon, app icons and OG card are unchanged.

## Consequences

- Every check in `wiki/CodeContext/FrontendUI/branding.md` §10 is done for this mark.
- The asset checklist and destinations are `wiki/CodeContext/FrontendUI/branding.md` §8; the header's
  markup is `wiki/CodeContext/FrontendUI/layout.md` §2.
- The typeset SVG wordmark stays in `brand/out/`, and the app does not ship
  it (`wiki/CodeContext/FrontendUI/typography.md` §3).
