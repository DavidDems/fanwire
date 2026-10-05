# 05 — Make the brand assets

**Why:** fanwire has no icon, favicon, wordmark or social-preview image. You
chose the direction on 2026-10-05: a lowercase `f` drawn as one wire line, plus
`fanwire` typeset in a free font, in Jet Black and Pale Sky. Only you can
generate and choose the images. Everything is free apart from the ChatGPT Plus
month you already have.

**The full instructions are in `wiki/CodeContext/FrontendUI/branding.md`.**
Section numbers below (§) point into it. Delete this file once the assets are
in the repo.

## Steps, in order

1. **Install the tools** (§7). One command per line:
   ```powershell
   winget install -e --id Inkscape.Inkscape
   winget install -e --id ImageMagick.ImageMagick
   ```
   **Confirm:** in a new PowerShell window, `magick -version` prints a version.

2. **Generate the symbol in ChatGPT** (§4.1, §6.1). Select the Thinking model,
   then paste variants A, B and C into three separate chats. Iterate on the
   best one, one change at a time. Reject anything on the §6.1 reject list,
   especially anything that looks like the Facebook `f`.
   **Confirm:** the PNG still reads as an `f` when shrunk to 16 px.

3. **Check it isn't someone else's logo** (§10). Run Google Lens and TinEye on
   the PNG, then search the Canadian Trademarks Database by Vienna code. While
   you're there, also search the word `fanwire`.
   **Confirm:** nothing close. If something is close, go back to step 2.

4. **Trace or redraw it in Inkscape** (§7.1). Redrawing over the trace gives a
   cleaner stroke and makes the result more clearly your own work (§4.3).

5. **Pick the wordmark font and typeset it** (§3.2). Compare `fanwire` in
   Outfit, Sora and Manrope on fonts.google.com, install the one you choose,
   type it in Inkscape, then **Path → Object to Path**.

6. **Make the five master SVGs** (§7.2): `symbol-tile`, `symbol-maskable`,
   `wordmark-light`, `wordmark-dark` and `og-image`. Optionally generate an Open
   Graph background first (§6.2). A plain Jet Black background is fine.

7. **Export the icon set** (§7.3). Run the commands there, one per line, from
   the folder holding the masters.
   **Confirm:** the three checks at the end of §7.3 pass (16 px `f`, the
   maskable.app circle, a 1200×630 `og-image.png`).

8. **Write `PROVENANCE.md`** next to the masters: the prompt you used, the
   date, "ChatGPT Images 2.5", and what you redrew by hand.

## Hand the files back

Either option works.

**Option A, commit them yourself.** Put the masters, the chosen ChatGPT PNG and
`PROVENANCE.md` in `brand\source\`, and the exported files in `brand\out\`.
Then run, one per line, from the repo root:

```powershell
git switch -c brand-assets origin/main
git add brand
git commit -m "brand: source masters and exported icon set"
git push -u origin brand-assets
```

Then tell the next session the branch name. **Placing the files** into
`frontend/public/` and `frontend/src/assets/brand/`, and wiring `index.html`
and the manifest (§8), is an agent's implementation unit, not yours.

**Option B, give an agent the path.** Leave everything in one folder, e.g.
`C:\Users\david\Pictures\fanwire-brand\`, and give that path to the session
that does the placement unit. It copies the files in and commits them.

## When it's done

Once the files are on `main`, delete this file, update the `TODO/README.md`
table, and record in `decisions.md` that the wordmark and icon now exist. The
agent doing the placement unit does that last part.
