---
type: reference
---

# 0x08i — Frontend: stats and player pages

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Stats and player pages (`FRONTEND-009`)

`src/features/stats/` at `/stats/seasons`, `/stats/records` and
`/stats/players`, and
`src/features/players/` at `/players/:playerId`. **Public**: sports data is a
read path ([[0x02c-events-routes]] "Players", "Seasons"). Every type is an alias of
the generated schema. The players feature has its own `api.ts`; the
stats reads are `src/api/stats.ts` (below, "The stats navigator").

- **Tabs are routes, not state.** `/stats` redirects to `/stats/seasons`;
  the three tabs (Seasons, Records, Players) are lazy child routes of
  `StatsPage` (one h1 "Stats", then
  `<Tabs label="Stats">`, then the `Outlet`), so the address alone decides
  the tab and Back moves between them. **`components/ui/Tabs` is links that
  look like tabs**: a `<nav aria-label>` of `NavLink`s with
  `aria-current="page"`, deliberately not an ARIA `tablist`, which promises
  arrow-key switching between panels of one page. Its doc comment says so;
  don't "fix" it to `role="tab"`.
- **The nav's Stats item** (lucide `chart-column`) follows Home and is
  current on `/stats/*` and `/players/*`. `NavLink` can only mark its own
  address, so `NavItem` takes `alsoCurrentOn` patterns and renders a plain
  `Link` with `aria-current="page"` on them.
- **Game and player links open the detail modal flow** (`FRONTEND-041`):
  `ROUTE_LINKS`' `gameLink`/`playerLink` and the leaders' links render
  `DetailLink`, a `Link` carrying `useDetailLinkState()`, so the Stats page
  stays mounted underneath; hrefs are unchanged. Team links stay in-page.
- **URL state.** `?season=`, `?team=` and `?q=` live in the address through
  `useSearchParams`. The season defaults to the newest from
  `GET /events/seasons` **without being written to the URL** until the user
  picks one, so `/stats/seasons` stays the address of "the current season".
- **The season view** (rebuilt by `FRONTEND-018`, below): the champion and
  series result, or that there is no champion yet; one standings table per
  conference, sorted across divisions by the API's rule (win fraction, wins,
  name) with the API's `tie_break` note. The leaders are in Records > Seasonal
  (`FRONTEND-019`, [[0x08j-frontend-records]]).
- **The team search is a client-side combobox** (`TeamSearch`) over
  `GET /events/teams`, matching name or abbreviation case-insensitively: ARIA
  1.2 `role="combobox"` with a `listbox` and `aria-activedescendant`;
  ArrowDown/ArrowUp, Enter, Escape and click (options take `mousedown`
  with `preventDefault`, so the input keeps focus). Choosing a team sets
  `?team=`, which opens the navigator's team level (record, home and away,
  every game with W/L as a letter in an `abbr`); clearing the box returns
  to the season level. Every team in a table links to
  `/stats/seasons?team=<id>`, every game to `/games/<id>`.
- **The player search hits the API**, debounced 250 ms, trimmed, and sends
  nothing for an empty box; the trimmed text goes into `?q=` with `replace`.
  An empty result names the search.
- **Paging without `next_offset`.** `GET /events/games`, `/events/players`
  and the game log answer bare lists, so each fetcher sends its page size
  (50, 20, 50) and a page that comes back full is the only sign another may
  follow: Load more shows only then.
- **The player page**: the name as the h1; the attributes as a `dl`, null
  ones left out, height from inches as `6'9"` (`formatHeight`), averages to
  one place (`formatAverage`, null is an en dash); the career table (Regular
  season, Playoffs), the season-by-season table and the game log, with
  did-not-play rows giving the reason or "Did not play". Since
  `FRONTEND-023`, the game log also charts points for the ten most recent
  completed games, with a captioned Points table as its text equivalent. A
  404 or a non-numeric id is "Player not found"; any other failure is
  `InlineAlert`.
- **The team level** (`FRONTEND-037`) charts the cumulative record over played games in date order: per
  game, a wins bar above a baseline and a losses bar below it, "Wins" and
  "Losses" labelled, month-only axis labels, and no overall record. Its text
  equivalent is the "Record after each game" table (game, month, W/L,
  record) in a `<details>`. The games follow as result cards in API order
  (newest first): one link each to `/games/<id>?season=<level season>`, the
  selected team first ("Celtics vs Knicks" / "at"), short names, a W/L chip
  (solid W, outlined L, the word in hidden text), score and type or label, no
  date. One column, two from 36em of container width, row-major. An unplayed
  0-0 game has no chip, reads "Not played yet" and counts in no total. While a
  new team-season read is pending, the previous result stays visible with an
  updating status.
- **Every table** has a `caption` and `th` with `scope`, and sits in its own
  `ScrollTable` region (`role="region"` named by the caption, `tabIndex=0`,
  `overflow-x: auto`): at 360 px the tables scroll and the page does not
  (checked in Chromium, 2026-10-16). Every Stats table, the leaders'
  included, is the navigator's `ScrollTable` drawn by the navigator's own
  stylesheet; `features/stats/Stats.module.css` holds no table rules since
  `FRONTEND-019` (R24). The
  players feature keeps its own older copy; it may now import the
  navigator's instead, in a unit with `features/players/` in scope.
- **Teams are fetched in three places now**: profile, `ProfileSetupPage`
  and `src/api/stats.ts`. They share the `["events", "teams"]` cache key; moving
  the fetch into `api/` is the fix, for a unit with all three in scope.

### "Post about this" (`FRONTEND-017`)

- **Signed-in only** (the human, 2026-10-22), from `useAuth()`: a guest would
  go through `RequireAuth`'s sign-in and could lose the attachment on the way.
  A guest's page and tables are exactly what they were.
- **Offered only where `POST /posts` would accept it**, by FRONTEND-013's
  picker rules: the game page's result link for a completed game (not 0–0),
  one per played box-score row (`seconds_played` not null), one per career row
  whose scope has games.
- **Links, to FRONTEND-013's address** ([[0x08c-frontend-compose#sports-data-attachments-frontend-013]]), built in one helper
  per feature, `features/games/postLinks.ts` and
  `features/players/postLinks.ts`. Not a shared one in `features/stats/`: the
  isolation tests keep both folders from importing it. Each is the only file
  in its folder that names `/compose`, which `postLinks.test.ts` pins. The
  links carry no flow state, so from the modal they simply leave it.
- **Placement.** The result link sits under the score heading. In the box
  score and the career table it is a trailing column, only for a signed-in
  viewer (a visually hidden "Post" header), so the row header keeps its one
  link and the stat columns stay put; the column scrolls with the table at
  360 px. The visible text is "Post" with `SquarePenIcon`; the accessible
  name says what about ("Post about Scottie Barnes’s game", "… LeBron James’s
  playoffs").

### The stats navigator (`FRONTEND-018`)

Brief 20, stage 2. One navigator for the Stats page and the compose stats
picker (`FRONTEND-021`).

- **Its home is `src/components/stats-nav/`**, outside `features/`, so
  compose may use it. `StatsNavigator` renders a **stack of levels**:
  - a breadcrumb, `nav` "Stats path", whose items return to their level,
    with the last one `aria-current="location"`. `rootCrumb={false}` hides
    it while the stack is one level deep, where it only repeats the `h2`
    (the records home and the Seasons tab's season level, 2026-11-04);
  - Back, shown only when the stack is deeper than one;
  - the top level's `h2` (`tabIndex -1`) and view.
- **The levels are data** (`types.ts`): `{ kind: "season", season, conf }`
  and `{ kind: "team", season, teamId }`. The union is meant to grow (the
  picker adds a game and a box-score level). `SeasonLevel` shows the
  champion and the standings under a `SegmentedTabs` "Conference" bar (All,
  East, West), filtered on the client from the one standings read.
  `TeamLevel` shows the record, the splits and the games. `PlayerResults` is
  the Players search's result list.
- **Router-agnostic, by test.** No file in `stats-nav/` imports
  `react-router-dom` or `features/`, except `features/games/format`.
  - The caller owns the stack, through `open`, `replace` (the conference
    tab) and `pop(toDepth)`.
  - An adapter says how a game or a player is linked. With `levelHref`, the
    level controls are real links whose plain click calls the callback.
  - `StatsNavigator.test.tsx` drives it from React state with no router,
    as the picker will.
- **`SeasonsTab` is the route adapter.**
  - `?season=` and `?conf=east|west` give the season level; All is not
    written, and an unknown value is All.
  - `?team=` gives the team level.
  - `open` and `pop` push the new address, and a conference tab replaces it.
- **Focus** moves to the new level's heading only when a navigator control
  moved the stack. A cold load, the browser's Back or a tab moves none.
- **The reads are `src/api/stats.ts`.** It holds the old `features/stats/api.ts`
  with the same keys, one `ok()` check per fetcher, and `queryOptions`
  factories (`championQuery`, `standingsQuery`, `leaderBoardsQuery`,
  `teamSeasonQuery`) with `staleTime` `SEASON_STALE_TIME` (5 minutes).
  - Requests per screen, pinned in `stats-requests.test.tsx`: a cold
    `/stats/seasons` makes 4; switching
    tabs makes 0; opening a team makes 1; Back makes 0.
- **Lazy.** Nothing in `stats-nav/` or `api/stats.ts` is reachable from the
  entry (`stats-nav-lazy.test.ts`). Since two tabs import it, Rollup puts
  the navigator in a shared `StatsNavigator` chunk (`FRONTEND-019`).
- **No layout shift on load.** The champion's place is two lines tall in
  every state, and the All standings' place is held at the two tables'
  height by a static `Skeleton` while they load.
- **The leaders are not on Seasons**: they are Records > Seasonal
  (`FRONTEND-019`, [[0x08j-frontend-records]]).
