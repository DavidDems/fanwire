# Brand assets — provenance

Where each brand file came from, who made which part, and with what. Kept
because copyright in AI-generated images is unsettled in Canada
(`wiki/CodeContext/FrontendUI/branding.md` §4.3), so the record of the human
and AI contributions matters.

## The symbol: wire `f` with a plug

| | |
|---|---|
| Generated | 2026-10-05, ChatGPT Images 2.5 (ChatGPT Plus), by the repository owner |
| Prompt | Variant A from `branding.md` §6.1, verbatim (below) |
| Raw output | `symbol-chatgpt.png`, 1254×1254 PNG, unedited |
| Vectorised | By the repository owner in Inkscape 1.4.4: Trace Bitmap, single scan, brightness cutoff. The result is `symbol-f.svg` |
| Similarity check | 2026-10-05, by the repository owner: Google Lens and TinEye returned no matches. Not yet done: a design-mark search in the Canadian Trademarks Database (`TODO/05-branding-assets.md`) |

The prompt:

> Design a minimal flat vector logo symbol: a lowercase letter "f" drawn as ONE
> continuous line of wire with a perfectly uniform thick stroke and rounded
> ends. The bottom of the f's stem ends in a small, simple plug or connector
> shape; the top curls over like a bent wire. Solid single colour #022b3a on a
> pure flat white #FFFFFF background. No gradients, no shadows, no 3D, no
> texture, no other letters or words, no frame, no background shape. Centered,
> generous empty margin on all sides, square 1:1. It must still read clearly as
> an "f" when shrunk to 16 pixels, so keep it bold and simple with no fine
> detail.

## Derived files

A Claude Code session composed these from `symbol-f.svg` on 2026-10-05, and
the repository owner approved them. The traced path is unchanged in all of
them, except the favicon's added stroke. Each is placed on a 512×512 page with
the `f`'s bounding box centred.

| File | Composition |
|---|---|
| `symbol-tile.svg` | Jet Black `#022b3a` square, corner radius 96. The `f` in Pale Sky `#bfdbf7` at 70 % of the height |
| `symbol-square.svg` | The same with corner radius 0 (for `apple-touch-icon`) |
| `symbol-maskable.svg` | Corner radius 0, the `f` at 60 % of the height (inside the 40 % safe circle) |
| `symbol-favicon.svg` | Corner radius 96, the `f` at 80 % of the height plus a 28-unit Pale Sky stroke with round joins and caps. This is the small-size cut for 16–48 px |
| `wordmark-light.svg` / `wordmark-dark.svg` | `fanwire` typeset in **Outfit SemiBold (600)**, the owner's choice, shaped with HarfBuzz (kerning on, ligatures off) and converted to paths. Jet Black and Pale Sky. The font is SIL OFL 1.1, which allows logo use without attribution (OFL FAQ 1.1, 1.1.2); the file came from Google Fonts (`fonts.gstatic.com/s/outfit/v15/…`). The font itself is not in the repo |
| `og-image.svg` | 1200×630 Jet Black. The `f` at 340 px tall, a 40 px gap, then the Pale Sky wordmark at 150 px tall. The lockup is centred |

The exports in `../out/` were made from these with Inkscape 1.4.4
(`--export-type=png -w N -h N`). `favicon.ico` was made with ImageMagick 7.1.2
(`-define icon:auto-resize=48,32,16` from a 256 px render of
`symbol-favicon.svg`).
