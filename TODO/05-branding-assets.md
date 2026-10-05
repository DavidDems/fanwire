# 05 — Make the brand assets

**Why:** fanwire has no icon, favicon, wordmark or social-preview image. You
chose the direction on 2026-10-05: a lowercase `f` drawn as one wire line, plus
`fanwire` typeset in a free font, in Jet Black and Pale Sky. Only you can
generate and choose the images. Everything is free apart from the ChatGPT Plus
month you already have.

**The full instructions are in `wiki/CodeContext/FrontendUI/branding.md`.**
Section numbers below (§) point into it. Delete this file once the assets are
on `main`.

## Status as of 2026-10-05

The symbol is done: a wire `f` whose stem ends in a plug, traced in Inkscape
into `brand/source/symbol-f.svg`. From it, the agent built the icon masters and
exported the icon set into `brand/out/`. They are **not committed yet**: they
wait for your approval (step 4 below). Review sheets are in `brand/review/`,
which is deleted before the commit.

## Done

- [x] **Install the tools** (§7). Inkscape and ImageMagick are installed.
- [x] **Generate the symbol in ChatGPT** (§6.1). Variant A, the plug end.
- [x] **Trace it in Inkscape** (§7.1). `brand/source/symbol-f.svg`.
- [x] **Build the icon masters and export the icon set** (§7.2, §7.3). The
  agent did this: `symbol-tile`, `symbol-square`, `symbol-maskable` and
  `symbol-favicon` in `brand/source/`; `favicon.svg`, `favicon.ico`,
  `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and
  `icon-maskable-512.png` in `brand/out/`.

## Still needs you, in order

1. **Put the original ChatGPT PNG back** as `brand/source/symbol-chatgpt.png`.
   The earlier save under that name was actually the Inkscape SVG, which is now
   `symbol-f.svg`. Download the image again from **Images** in ChatGPT's
   sidebar.

2. **Paste the prompt you used** into the chat with the agent. It goes in
   `brand/source/PROVENANCE.md` with the date and model (§4.1, §4.3).

3. **Check the symbol isn't someone else's logo** (§10). Run Google Lens and
   TinEye on the PNG, then search the Canadian Trademarks Database by Vienna
   code. While you're there, also search the word `fanwire`.
   **Confirm:** nothing close. If something is close, the symbol goes back to
   ChatGPT before anything is committed.

4. **Approve the icons.** Open `brand/review/icons.png` (the 180 px Apple icon,
   the 192 px tile, and the maskable icon with its safe circle in red) and the
   files in `brand/out/`. The 16 px favicon is a deliberately bolder cut: at
   normal weight the plug smeared away (§7.2).

5. **Pick the wordmark font.** Open `brand/review/wordmarks.png`: `fanwire` in
   Outfit, Sora and Manrope, each at weights 500 and 600, beside the symbol.
   Tell the agent a number (1–6). The agent then builds `wordmark-light.svg`
   and `wordmark-dark.svg` and records the choice in `decisions.md`.

6. **Open Graph image** (optional). Once the wordmark exists, the agent can
   compose the 1200×630 card on plain Jet Black. If you want a background from
   §6.2, generate one in ChatGPT and save it as `brand/source/og-background.png`
   first.

## Hand-back

No git commands are needed from you. The files are already in the repo
folder. Once steps 1–5 are done, tell the agent, and it commits `brand/` to the
branding PR (#92). Placing the files into `frontend/` is a later
implementation unit (§8).

## When it's done

Once the files are on `main`, delete this file, update the `TODO/README.md`
table, and record in `decisions.md` that the wordmark and icon now exist. The
agent doing the placement unit does that last part.
