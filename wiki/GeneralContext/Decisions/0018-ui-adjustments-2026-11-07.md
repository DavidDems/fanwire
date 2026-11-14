---
type: decision
---

# 0018 - UI adjustments after the track

Decision: 2026-11-07, the human, after seeing `FRONTEND-037` and `EVENTS-013`
live ("the changes fit my requests perfectly").

## Context

The track of navigation, home rail and stats units had landed
([ADR 0017](0017-navigation-and-home-rail.md)). Specs: `FRONTEND-040` to
`-044`, `EVENTS-015` to `-017`.

## Choice

- **Sidebar bar.** From 860 px to 1248 px the current page's bar overlaps the
  link's icon. Add padding so it never does (`FRONTEND-040`).
- **No matchup artwork** on the game view. Header, line score and team box
  score tabs stay, in that order (`FRONTEND-040`).
- **No Quick posts** in the composer, section and logic (`FRONTEND-040`).
- **Recent Games: newest day first.** Date, then the standings rank sum
  within a day (`EVENTS-015`).
- **Stats keeps its place.** A game opened from the Stats page opens in the
  detail modal, as from Recent Games (`FRONTEND-041`; players too, Director).
- **Records cards show the top three.** The record holder's name is bold
  (icons stay); second and third are not. Each entry is at most two lines:
  icon, name and value, then the season or date, grey and smaller
  (`EVENTS-016`, `FRONTEND-042`).
- **Seasonal records:** cards like the Historical ones for points, assists,
  rebounds, blocks, steals, FGM, 3PT FGM, FG%, 3PT FG%, FGA and 3PT FGA, each
  with its top three and a View all opening the top ten in a modal. A season in
  progress shows leaders as it goes; a season with a champion uses the
  65-game minimum (`EVENTS-017`, `FRONTEND-043`).
- **A Schedule page** (`FRONTEND-044`), a nav link after Stats: day cells of
  played and upcoming games in the Recent Games card, 5 days from 1248 px, 3
  from 860 px, 1 below, the middle cell on today; arrows and the day itself
  move through the season. No filters yet.

## Consequences

All of it is built (`FRONTEND-040` to `-044`, `EVENTS-015` to `-017`): the
routes in `wiki/CodeContext/FrontendUI/layout.md` §3, and the components in
`wiki/CodeContext/FrontendUI/components-map-pages.md` §5 and `wiki/CodeContext/FrontendUI/components-map-posts.md` §5.
