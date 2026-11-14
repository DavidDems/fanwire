---
type: reference
---

# 0x08j — Frontend: records

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Records (`FRONTEND-019`)

Brief 20, stage 3, on `EVENTS-010`'s records API ([[0x02d-events-records]] "Records").

- **`/stats/records` is `RecordsTab`**, the route adapter for a `SegmentedTabs`
  "Records view" bar, Historical / Seasonal. The address is the state:

  | Address | Shows |
  |---|---|
  | `/stats/records` | Historical, Top records (`FRONTEND-030`) |
  | `?group=team`, `?group=player` | Historical, that group's library |
  | `?q=<query>` (with or without `group`) | that bar's search |
  | `?record=<id>` | that record's ranked list |
  | `?view=seasonal[&season=<s>]` | the season's leader cards (newest by default) |

  Defaults are never written (Top records is the default, so Team is
  written), and an unknown value is the default. Both bars and typing in the
  search replace the history entry; the group bar keeps `q`; switching the
  view drops `group`, `q`, `record` and `season`. Opening and popping a level
  push. A record opened from a card carries its origin in the history state,
  and its in-page Back is the history's Back, to that tab and query; a cold
  `?record=` falls back to its group's tab with no query. The breadcrumb's
  first item stays the record's group tab.
- **Where the view bar sits** (by hand, 2026-11-04): inside the panel it
  switches. `SegmentedTabs` hands it to function children, and it goes to
  the end of the Top records / Team / Player bar's row (`end`), of the
  season picker's row on Seasonal (`SegmentedRow`), or into a row of its own
  above the navigator on a record's level. The row wraps on a phone, the
  view bar on its own line at the end. `RecordsTabLayout.test.tsx` pins it.
- **Two navigator levels**, `{ kind: "records", group, q }` (`group` a
  `RecordsBar`, `"top"` or a group) and
  `{ kind: "record", id }` (`types.ts`), so the breadcrumb, Back and the
  focus rule are the navigator's. Every use of a level narrows by `kind`.
  - `RecordsLevel` (the records home, `FRONTEND-030`): a "Search records"
    box, a "Record group" bar (Top records / Team / Player), the data window
    ("Since 2003-04, through 2026-27") and the cards, in a list named by the
    bar. Top records with no query is the catalog's records with a
    `featured_rank`, in that order; Team and Player are the group's whole
    library in catalog order. A query (`recordSearch.ts`) needs every
    whitespace-separated term, case-insensitive, somewhere in the title,
    category, group, unit or keywords, and searches the whole library on Top
    records and the group's on a group, in the browser over the cached
    catalog. 24 cards a page, Load more adds 24 (focus moves to the first new
    card); each page's holders are one read with its ids sorted, asked once
    the box has rested 300 ms, so a page already read asks nothing. The box
    keeps its own text (a keystroke never waits on the router). A card shows
    its title and category line ("Team franchise", "Player playoffs") from
    the catalog at once; below them, the holder's `top` (`FRONTEND-042`,
    `EVENTS-016`, from the same read) in the API's order as a list, each
    entry two lines. Line 1: the team icon (a team record's team; a player's
    single-game record, the team they played for; none for a player's season
    or career), the name (a team's `teamShortName`, "Warriors"; a player's
    full name) and the value (`RecordValue`); it never wraps, the name cut
    with an ellipsis (on screen only, the whole text in the page). Line 2,
    `.muted`: the season or the game's date. An entry whose value equals the
    holder's holds the record, so its name and value are semibold; the
    others regular. When `tied_count` is more than the shown entries that
    hold it, a muted "N more" line follows; never "and N others". Fewer than
    three entries shows what there is. The `.holder` area keeps the room of
    three two-line entries (line 1 the 2 rem icon or a body line, line 2 a
    small line, in em and rem), and while loading holds three `Skeleton`
    bars in it, so landing entries move nothing at any width. At 200% text
    the bars wrap and View all wraps under the title. A failed page is one alert, its cards keeping
    titles and links. No match is an `EmptyState` naming the query with
    "Clear search". The match count is a visually hidden polite live region,
    present from the start, and says the settled query's count only. A card's
    one control is
    "View all" (named "View all: <title>", a real `?record=` link), its
    `::after` stretched over the card so the whole card is the hit area; the
    holder is plain text. A card with no qualifying holder keeps "Nothing
    qualifies yet." and adds the shared decorative court / scoreboard art.
    While the catalog loads, skeleton cards hold the place.
  - `RecordLevel`: the rule, "Since <season>" and the whole list (up to 100)
    in one `ScrollTable`, with the API's ranks as given; a column the record
    has no value for is left out. A rank-1 row's name is semibold
    (`.lead`), as a holder is on its card (`FRONTEND-042`). A season record notes that it ranks the
    exact percentage, so equal three-place figures can rank apart. An unknown
    id is "Record not found" in place, with Back.
  - **A value by its `value_kind`** (`EVENTS-011`): `RecordValue` (`components/stats-nav/`) draws a card's and
    a list cell's value. `win_loss` is `73–9` (an en dash) then `(.890)`; a
    screen reader hears one phrase, "73 wins, 9 losses, .890" (the visible
    part is `aria-hidden`, the phrase visually hidden), and the list's value
    column is headed Record (the unit). `made_total` is `12 (57.1%)`, the
    count alone when `pct` is null; a card puts its unit after the count
    (`14 threes (58.3%)`). The parenthesis is `.share`, `--color-text-muted`
    (4.5:1 on the card's surface and hover surface in both themes). A
    `count` is the value alone, as before. `shot_pct` (`FRONTEND-030`) is
    `45.4%` then a muted `(402/886)`, with no unit on the card; `average` is
    one decimal, a card adding its unit (`31.0 points per game`).
  - **The record level's group is its list's.** `?record=` never carries
    `group`; until the list or cached summary arrives, the id's prefix
    supplies the group (`FRONTEND-021`, R30). Unknown prefixes retain the
    "Records" fallback. The heading is the record's title from the cached
    summary, else the list.
  - **Seasonal leader cards** (`FRONTEND-043`, `features/stats/Leaders.tsx`):
    the season's eleven `EVENTS-017` boards, in its order, as cards in the
    Historical grid. Both use `StatCard` and `CardEntry`
    (`components/stats-nav/StatCard.tsx`); only a record card is
    `stretched` (`.cardStretched`, the `::after` hit area), so a leader
    card's player links and View all stay their own controls. One muted
    line above the cards gives the response's rule ("Qualifying: …", or
    "Season in progress: …"). A card lists the top three: line 1 the
    player's `DetailLink` (the detail modal) and the value (one decimal, or
    `72.5%`); line 2 muted, "DAL · 70 games", plus made-attempted on a
    percentage board. The leader and anyone tied with them are semibold. A
    board with no qualifier reads "No player qualifies yet." and has no View
    all. View all ("View all <title> leaders") opens a local `Dialog`, not a
    route, titled "<title> leaders, <season>": the board's rule and a
    `ScrollTable` of the top ten (#, player, team, GP, made and attempted
    on a percentage board, value), tied values sharing a rank. One read per
    season, `leaderBoardsQuery(season)` (`limit=10`, season staleTime),
    feeds the cards and every dialog.
- **The adapter's optional `teamLink(teamId, season, children)`**: without it
  a team is plain text. `ROUTE_LINKS` gives it through `teamHref`.
- **`SeasonSelect`** (`components/stats-nav/`) is the season picker and its
  loading, error and empty states, shared by Seasons, Seasonal and the picker.
- **The wide column** (`FRONTEND-030`): `AppLayout` gives `main` the
  `.wide` class, `max-width: var(--content-max-wide)` (64rem, `tokens.css`),
  when the route matches `/stats/records`, so the cards sit one to a row
  below 40rem, two from 40rem and three from 64rem (`StatsNav.module.css`'s
  `.cards`). Every other route keeps `--content-max`.
- **The reads are `src/api/records.ts`**: `recordsQuery()`,
  `recordHoldersQuery(ids)` (keyed by the sorted ids) and
  `recordQuery(id)`, all `staleTime: Infinity` (the routes are cached five
  minutes at the edge, R7). A list is one call at `limit=100`; nothing sends
  `offset`; a 404 is `null`. Stats and records share `api/ok.ts` since
  `FRONTEND-021` (R29).
- **Requests per screen**, pinned in `records-requests.test.tsx`
  (`FRONTEND-030`): a cold `/stats/records` makes 2 (the catalog, then the
  sixteen's holders); Team and Player make 1 each (the first page's holders)
  and returning makes 0; Load more makes 1; opening a card makes 1, and Back
  and reopening it make 0; a cold `?record=` makes 1 and Back from it 2; a
  cold Seasonal makes 2 (seasons and one `leader-boards` read, `FRONTEND-043`).
- **Measured** (2026-10-26, `vite preview` against the full load in
  `fanwire_perf`, 360 wide, CPU 4x, five runs): the longest task on a cold
  Records is a median of 108 ms (worst 127); opening the 100-row
  `player-points-game` list 99 ms (142); a cold `?record=` 138 ms (170);
  tabs and Back 0. CLS is 0 on a cold Records and 0.0056 on a cold record.
