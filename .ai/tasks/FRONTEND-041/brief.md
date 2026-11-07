# FRONTEND-041: Stats links open the detail modal

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-07)

On the Stats page, open a team's season, click a game: it opens as a whole new
page (`/games/29687?season=2026-27`). Instead it should open a modal, the way
Recent Games already does, so the reader can close it and keep navigating the
Stats page in the same state as before.

## Where it is

- `features/stats/links.ts` `ROUTE_LINKS` builds plain `<Link>`s with no state.
  The navigator (`components/stats-nav/`) reaches links only through that
  adapter. `features/stats/Leaders.tsx` builds its own player links.
- `features/games/RecentGames.tsx` passes `useDetailLinkState()`
  (`routes/modal-flow.tsx`) as the link's `state`. `routes/routes.tsx` already
  registers `games/:gameId` and `players/:playerId` as `flowOnly` overlays, and
  `BackgroundRoutes` keeps the page underneath mounted.

## Decided (Director, 2026-11-07)

- **Players too.** The human said "some links" and gave a game as the example.
  A player is the other detail that already has a modal, and leaving it a page
  would break the same "keep my place" goal. Team links stay in-page.
- A hook cannot run inside the constant adapter. A small link component that
  calls `useDetailLinkState` itself, used by `ROUTE_LINKS`, keeps the adapter
  a constant. The implementer may choose another shape that meets the criteria.
- The address does not change, so a copied link or a reload is still the full
  page (FRONTEND-014's rule for flow-only details).
