---
type: runbook
---

# FrontendUI — branding: conversion and export

Part of [branding.md](branding.md). Turns the chosen symbol image into clean master SVGs and the shipped icon set, with free tools; where each file goes is `branding.md` §8.

## 7. Conversion and export, all free

Install once (PowerShell, one command per block):

```powershell
winget install -e --id Inkscape.Inkscape
```

```powershell
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
   and the result is more clearly your own work (`branding-rights.md` §4.3).
6. Set the fill to the colours in `branding.md` §1. Save as **Inkscape SVG** into
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
| `og-image.svg` | 1200×630 page with a Jet Black field (or the `branding-symbol.md` §6.2 background), the symbol and the Pale Sky wordmark in the left two-thirds, optionally one line of tagline. Keep important content away from the edges, because some platforms crop. |

Set the page size in **File → Document Properties**, and use **Edit → Resize
Page to Selection** where useful.

### 7.3 Export the icon set

Run from the folder holding the masters, one block at a time, in order. The Inkscape
CLI flags are from https://wiki.inkscape.org/wiki/Using_the_Command_Line, and
`icon:auto-resize`, which needs a 256×256 input, is from
https://imagemagick.org/script/defines.php.

```powershell
New-Item -ItemType Directory -Force .\out
```

```powershell
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-favicon.svg --export-type=png --export-filename=.\out\favicon-256.png -w 256 -h 256
```

```powershell
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-square.svg --export-type=png --export-filename=.\out\apple-touch-icon.png -w 180 -h 180
```

```powershell
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-tile.svg --export-type=png --export-filename=.\out\icon-192.png -w 192 -h 192
```

```powershell
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-tile.svg --export-type=png --export-filename=.\out\icon-512.png -w 512 -h 512
```

```powershell
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\symbol-maskable.svg --export-type=png --export-filename=.\out\icon-maskable-512.png -w 512 -h 512
```

```powershell
& "C:\Program Files\Inkscape\bin\inkscape.exe" .\og-image.svg --export-type=png --export-filename=.\out\og-image.png -w 1200 -h 630
```

```powershell
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
