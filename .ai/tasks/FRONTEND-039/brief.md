# FRONTEND-039: the tablet sidebar and the rail's breakpoint

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-06, after seeing FRONTEND-035 and -036 live)

- "The icons on the left sidebar (once width is large enough to not use bottom
  navbar) are sometimes too far from the edge of the screen. … The
  margin/padding should be minimized for tablet screens. For desktop screens
  its fine." Their screenshot is an iPad Pro 13 at 1032 px: the icon-only
  sidebar sits about 150 px in from the left edge.
- "Ipad mini layout at 768 width is perfect, but … starting around the 860
  width, the gap to the left of the sidebar becomes noticeable. Around this
  width, reduce the left margin/padding of the sidebar and add the text back in."
- "Keep search out of the home page until there is enough space for the sidebar
  to have words and the search bar on the right as well (1248+ and possibly
  below if it can all fit …) see at what pixel width the titled sidebar and
  search bar both fit nicely."

## Why the gap

From 40em the sidebar and `main` are one centred group (`layout.md` §2): a
72 px sidebar, a 24 px gap and a 640 px `main`. Every pixel above about 750 px
is split evenly either side, so at 1032 px each side gets about 137 px plus the
item's own inset. Labels make the sidebar 192 px, which takes up 120 px of that.

## Decided

- **Labels from about 860 px** (breakpoint L, at most 54em), not from 78em.
  With `main` at its full 640 px the labelled group needs about 905 px
  (192 + 24 + 640, 16 px outside each side, a 17 px scrollbar), so between L and
  that width `main` narrows instead, never below 36rem (576 px). Measure where
  the feed still reads well.
- **768 stays exactly as it is.** The human called it perfect.
- **Desktop (78em up) stays as it is**, apart from the rail appearing earlier
  if R comes out below 78em.
- **The rail needs the labelled sidebar** (breakpoint R). 192 + 24 + 952
  (`main` widened for the rail) plus the outside margins and a scrollbar comes
  to about 1215 px, so R is about 76em; measure it. Between 72em and R, `/` is
  the feed alone, as on a tablet.
- **The gap is measured, not eyeballed.** Report the left gap to the first icon
  and the right gap after `main` at each row width, before and after.

## Reuse

`useMediaQuery` (one call in `HomeView`), the existing `.body` group and
`.main:has(aside)` rule in `AppLayout.module.css`, and `stubViewport` in
`test/search.ts`.

## Traps

- Media queries can't use custom properties, so L and R are written as em
  literals. Keep the two `R`s (the CSS rule and the hook's query) equal, and pin
  that in a test.
- `em` in a media query follows the browser's default font size, not the root's
  `font-size`. A root-`font-size` 200% emulation doesn't move breakpoints; say
  which emulation the 200% row used.
- `FRONTEND-038` may run alongside and touches `AppLayout.tsx` and its tests;
  test the combination as `director-sessions.md` "Sibling PRs" says.
- Use dev server ports 5210–5219 with `--strictPort`, and stop only the port
  you started.

## Later Director PR, not this spec

`FrontendUI/layout.md` §2 and §3 and `tokens.md` §9 for L and R.
