---
type: reference
---

# 0x08h — Frontend: search, schedule and games

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Search (`FRONTEND-007`)

`src/features/search/`, wired at `/search`, and from 76.0625em in the home page's
right rail too. **Public**,
like the feed: every search route is a read path ([[0x07-search]]).

**Accounts and posts only (`FRONTEND-009`, the human, 2026-10-14).** The
sports-data filter (`GameFilter`, its tests and CSS, and the
`GET /search/games` and `/search/games/filters` client code only it used) is
gone; games, teams and players are on `/stats` ([[0x08i-frontend-stats]]). The backend routes
stay: only the UI moved. `search-scope.test.ts` pins from disk that nothing
under `src/` imports `GameFilter` and that `features/search/api.ts` asks no
`/search/games` route.

- **The address is the seam.** On `/search` the bar submits to
  `/search?q=<trimmed text>`, which `SearchPage` reads; on `/` it pushes
  `/?q=<trimmed text>` and stays there, which the rail reads (`FRONTEND-036`).
  A search is a link either way, and Back undoes it. An empty or
  whitespace-only submit goes nowhere (the route 422s on an empty `q`). The
  bar's input is `maxLength` 100, the route's own cap.
- **No search bar above the feed, at any width (`FRONTEND-036`).** From 76.0625em
  `routes/HomeView.tsx` mounts an `<aside>` after `FeedPage`, through
  `routes/useMediaQuery('(min-width: 76.0625em)')`: below it the rail is not
  mounted, so a phone makes none of its requests and searches on `/search`
  (`FRONTEND-035`'s Search links). The rail is `SearchRail`, then lazy `RecentGames` (`EVENTS-013`);
  HomeView composes the features and
  none imports another. Mounting the rail, or a change of `q`, never remounts
  `FeedPage`. `AppLayout.module.css` widens `main` from 76.0625em by
  `.main:has(aside)` to `--content-max` + `--space-5` + `--rail-width`, so no
  other route changes width; the rail is sticky at the sidebar's `top` and
  scrolls on its own.
- **The rail is a preview.** "Results for <q>" (h2) with Clear search (a new
  entry without `q`, focus back to the box), then Accounts and Posts (h3), at
  most five each from the first page of the same infinite queries
  (`accountsQuery`/`postsQuery` in `api.ts`), so Show all to `/search?q=` opens
  from the cache. Accounts are `SearchPage`'s own `AccountResults` with
  `showAll`; a post row is compact (author, time linking to `/posts/<id>` with
  the modal flow's state, handed in by HomeView; text clamped to three lines;
  no controls). Both pages share `ResultSection`'s loading, failure and empty
  states; the rail adds Retry. A polite live region, present before any
  search, announces the count once both sections settle.
- **Accounts and posts page apart.** Two `useInfiniteQuery`s, each fed its own
  `next_offset` straight through; loading more of one never refetches the
  other (pinned with result sets of different lengths). Accounts render above
  posts.
- **Post results are `PostNode`s, and are cached under the feed's key root**
  (`["feed", "search", q]`). `TogglePostAction` patches a like or repost optimistically into
  every entry under `FEED_KEY_ROOT` that holds the post, and `PostsPage`'s
  `{ items }` page shape is one `cacheHolds`/`mapCachedPosts` already walk.
  Keyed anywhere else, a like on a search result would not move until the
  server answered. The flip side: anything that later invalidates the whole
  `["feed"]` prefix also refetches open search results. `features/search`
  imports `PostNode` and `feed/api` only, enforced from disk by
  `search-isolation.test.ts`.
- **Every empty result names what was searched.**

### Recent games (`EVENTS-013`)

`HomeView` lazy-loads `features/games/RecentGames` after SearchRail only while
the home rail is mounted. Its h2 is "Recent games". One public
`GET /events/games/recent` read uses `["events", "games", "recent"]`, fresh
for five minutes, retaining API order. Each card (`FRONTEND-037`) is one
link to `/games/<id>?season=<season>`: away above home, each a TeamIcon, the
short name (`teamShortName`), the overall record in small parentheses and
the score. The losing line is muted text that still meets contrast; the
winner's score is bolder and named in hidden text, so the result is never
colour alone. No home/away records and no date. Modal-flow state opens the
game over home. Lazy and query loading reserve five Skeleton rows the card's
height; errors use InlineAlert and Retry; an empty response removes the
section. The card is `features/games/GameCard` (`FRONTEND-044`), shared
with the Schedule page.

### The shared game card (`FRONTEND-044`)

`GameCard` (`features/games/GameCard.tsx`, `GameCard.module.css`) takes
`away` and `home` sides (`{ team, record?, score? }`), an optional `to`
and an optional `time`.
- **With `to`**, it is a `Link` carrying `useDetailLinkState()`, so the
  game opens in the detail modal over the page.
- **Without `to`**, it is a plain block: a scheduled game.
- **A null team** reads "TBD", with the neutral `TeamIcon`.

`games-isolation.test.ts` lets `features/schedule/` import `GameCard`, and
nothing else from `features/games/`, beside `FRONTEND-009`'s `format`
exception.

## Schedule (`FRONTEND-044`)

`/schedule` is `features/schedule/SchedulePage`: lazy, public, h1
"Schedule", the nav item "Schedule" (`CalendarIcon`, Lucide `calendar`).
The item sits after Stats in the sidebar and in the phone bar. `main` takes
`--content-max-wide` here, as on `/stats/records`, so five cells are about
190 px and team names stay whole.
- **Days:** day cells side by side, from `useMediaQuery`: 5 from 78em, 3
  from 53.75em, 1 below. The centre is `?date=YYYY-MM-DD`, or today in US
  Eastern (`Intl`, `America/New_York`); a malformed or impossible date
  falls back to today. `days.ts` does the date arithmetic on UTC midnights.
- **Moves:** Previous day / Next day, each visible day's heading (a button),
  and a Today button while the centre is not today. A move replaces the
  history entry, so Back leaves the page; moving to today drops `?date=`.
- **Announcements:** a polite live region, always present, names the new
  centre after a move ("Tomorrow, Sun 8 Nov"). `aria-current="date"` marks
  today's heading.
- **Cells:** each is a `section` labelled by its heading: "Today",
  "Yesterday", "Tomorrow", else "Sat 7 Nov". It lists the day's games in the
  route's order as `GameCard`s.
  - A final game shows scores and links to `/games/<id>?season=…`.
  - A scheduled game has no link: the start as "7:30 PM ET" (the stored
    Eastern wall-clock, whatever the viewer's zone) or "Time TBD".
  - No team records. A day with no game reads "No games".
- **Data:** `api/schedule.ts` makes one `GET /events/seasons/{season}/schedule`
  read per season shown. The season is derived from the date (from 1 August,
  the season starting that year), and `staleTime` is 5 minutes.
  - Moving within a season asks nothing.
  - A 404 is `null`, so its days read "No games".
  - Any other failure is one `InlineAlert` with Retry.
- **No animation** outside `prefers-reduced-motion: no-preference` (none
  today).

## Game page (`FRONTEND-008`)

`src/features/games/`, wired at `/games/:gameId`. **Public**: a game is a read
path ([[0x02-events]]). One read, `GET /events/games/{id}`, through
`features/games/api.ts`, typed by the schema's own `GameDetailOut`,
`TeamBoxScoreOut` and `BoxScorePlayerOut` with no renamed client model.

- **Reached by address only.** Post text (`PostText`) and the Stats page's
  game rows link to `/games/<id>`. One exception to "nothing imports
  `features/games/`": `features/stats` and `features/players` import
  `features/games/format` (the brief: one number format), and nothing else
  from the folder. `features/games` imports no other feature
  (`games-isolation.test.ts` pins both). Moving `format.ts` to a shared
  `src/lib/` is the cleaner home, for a unit with that path in scope.
- **A 404 is not-found, not an error.** `fetchGame` returns `null` on 404 and
  the page says "Game not found" with a link back to the feed; any other
  failure throws and shows `InlineAlert`. A non-numeric id is not-found
  without a request.
- **Every figure goes through `format.ts`**: `27:04` minutes from
  `seconds_played`, `.462` percentages (null is an en dash), `+12`/`−3`/`0`
  plus-minus, `8-13` made-attempted, and the line-score headers Q1–Q4, OT,
  2OT, `3OT+` (the seventh stored figure is "third overtime and later",
  [[0x02a-events-schema]] Game, never split or padded).
- **Dates as stored.** The timestamp is naive US-Eastern; `parseISO` on the
  string without `Z` shows the stored calendar date in every viewer's zone.
- **Team links and tabs** (`FRONTEND-037`). Each team's name in the `h1`
  links to its Stats > Seasons page with the `?season=` the game was opened
  with (a direct address carries none: the default season); the game's path
  stays `/games/<id>`. Below the line score, a `SegmentedTabs` "Team box
  scores" bar holds one tab per team, "<short name> <score>": the winner
  first (a tie or an unplayed 0-0 game, home first), selected initially
  unless `?line=` names the other team's player line. The panel shows the
  selected team's box score only. Only selection lights a tab; there is no
  winner colour, and no spelled-out final-score sentence.
- **Real tables.** `<caption>`, `th scope="col"` headers, the player in a
  `th scope="row"`, starters then bench in API order, the API's `totals` as
  the last row. Each table sits in a labelled `role="region"` with
  `tabIndex=0` and `overflow-x: auto`, so a keyboard user can scroll it and
  the page itself never scrolls sideways. The line score is absent when either
  side's is null; an empty box score is an `EmptyState` in place of the table.
  Players who did not play are listed after their team's table, with the
  reason or "Did not play".
- **Mentions link only when the server resolved them.** `PostText` splits on
  `#GameId(\d+)` and links a token only if its id is in
  `mentioned_game_ids`; it builds React nodes, so post text is never parsed as
  HTML. `\d+` is greedy: `#GameId5012` is 5012, never 501.
- **Box-score names link to `/players/<id>`** (`FRONTEND-009`), inside the
  row's `th scope="row"`; the position stays outside the link, and the
  totals row has none.
