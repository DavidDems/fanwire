# FRONTEND-019: Records

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 3 of `wiki/GeneralContext/Prompts/20-stats-navigation-and-compose-modal.md`.
EVENTS-010 serves the records (`GET /events/records`, each record's holder,
and `GET /events/records/{record_id}`, its ranked top 100), and FRONTEND-018
rebuilt Stats on one navigator. This unit adds the Records tab between Seasons
and Players:
- **Historical:** Team and Player tabs of record cards. Each card shows its
  holder, and clicking it opens the record's full ranked list.
- **Seasonal:** the per-season leaders, moved off Seasons.

## Decided by the human

- **From the request (2026-10-23):** each record is a card showing its holder,
  with "View all" at the right of its title; clicking anywhere on the card
  opens that record's ranked list; Team and Player records are tabs; the
  leaders move from Seasons to Records > Seasonal.
- **2026-10-24:** the leaders move in this unit, in one PR, so no deploy is
  ever without them.
- **2026-10-25, by `AskUserQuestion`:** a ranked list opens as a **navigator
  level**, in the page, like Seasons → team: breadcrumb, Back and its own
  address. Not a `Dialog`, so R22 (the Dialog's initial focus) stays with
  FRONTEND-021 or a small Director UI PR.

## Decided by the Director

- **One call per list, at `limit=100`.** A list holds at most 100 entries and
  at most 27.5 KB, so paging would cost a request per 25 rows to save nothing.
  "View all" is one request (R11), and no read passes `offset`.
- **The card's one control is its "View all" link,** stretched over the card
  (a `::after` covering it), so the whole card is the hit area, a keyboard
  user has one tab stop per card, and the link has a real address for a new
  tab. The holder's name is plain text: a link inside a link is invalid, and
  the list level links every name anyway.
- **"Since 2003-04" is said once per panel and on every list,** from the
  API's `since_season`, not on each of the twelve cards.
- **Season records show the API's ranks as given.** Two rows can show the same
  `.xxx` with different ranks, because the API ranks the exact fraction and
  sends three places. The list says so in one line rather than re-ranking on
  the client, which would contradict the API's order.
- **The record levels are navigator levels,** so the breadcrumb, Back and the
  focus rule are one implementation. The picker (FRONTEND-021) never opens
  them: a record is not a `data_link` type.
- **Seasonal has its own season select** on `?season=`, as Seasons does. The
  two tabs are separate routes, so the parameter doesn't collide.

## Addresses

| Address | Shows |
|---|---|
| `/stats/records` | Historical, Team |
| `/stats/records?group=player` | Historical, Player |
| `/stats/records?record=<id>` | that record's list (its group from the response) |
| `/stats/records?view=seasonal[&season=<s>]` | Seasonal, the newest season by default |

Defaults are never written, as on Seasons. An unknown value shows the
default.

## The skeptic

**First pass, 2026-10-25: proceed with changes, all landed in this spec.**
It built a bare prototype on 4cefa2c and measured it with the budget test's
own build:
- the entry grows 69 B gzip and 241 B raw;
- once two tabs import `StatsNavigator`, Rollup splits the navigator into a
  shared chunk of its own (`StatsNavigator`, 4,359 B gzip, with
  `css:StatsNavigator.css` replacing `css:SeasonsTab.css`), and SeasonsTab
  drops from 4,637 to 1,771;
- a cold Seasons therefore downloads the records views it doesn't render,
  about +1.66 kB gzip net. Accepted: splitting them out would add a third
  serial chunk load;
- R24 saves only 67 B gzip, because the copy already gzipped away; the cards'
  CSS adds 233;
- every provisional request count held in msw.

Its fixes, D1–D8: the budget lines (three were unmeetable, and the shared
chunk wasn't declared); a `teamLink` on the adapter, because the navigator
can't import `features/stats/links.ts`; where a record level's group comes
from; the headings (never empty, so focus never lands on a blank); a home for
the leaders' cell classes; the full list of tests the move breaks; the bars
replace history; and the wording of ties, empty columns and the + row.

Risks carried into this unit (Prompt 20 Progress):
- **R26:** the shared chunk's name comes from the prototype. If Rollup names
  it otherwise, the Director corrects the budget file's names, keeping the
  sums 9,850 JS and 1,800 CSS.
- **R27:** at 360 a holder line wraps two or three lines, so the cards' hold
  height may be short. The CLS row decides it.
- **R28:** the 100-row list's long task is reasoned (100–130 ms, from the
  team level), not measured. The `player-points-game` row decides it.
- **R11:** Records opens with one call, and "View all" adds one.
- **R19:** after FRONTEND-020 the entry is 470,954 B raw and 149,444 B gzip
  (the test's build on 4fc9b46). This unit adds nothing to it but the route.
- **R24:** retire the Stats copy of the table CSS when the leaders move.
- **R4, R14:** the long-task rows, as a median of five alternating runs with
  a 250 ms worst-run cap. A 100-row table at 4× CPU is the row to watch.
- **R7:** the records routes are cached at the edge, so `staleTime: Infinity`.
- **From EVENTS-010:** the points-in-a-game holder is Adebayo's 83
  (2026-03-10), which the Director couldn't check against a second source. The
  browser row records what the full load shows.

## Traps

- **The bundle-budget file.** Add `src/test/bundle-budgets/FRONTEND-019.ts`
  in the **test commit**: every lazy output the unit changes, adds or removes,
  each with a gzip ceiling, and the entry growth. Rollup names a chunk after
  its first module, so build a scratch copy of the planned layout before
  declaring. As in FRONTEND-018 (R20), the Director may correct the chunk
  names in its own commit after a build of the implementation, keeping the
  ceilings' sums. `bundle-budget.ts` itself is the Director's.
- **The entry.** `routes.tsx` is in the entry, so the Records route's
  `lazy()` line is the only growth allowed there. A static import of
  `api/records.ts` or a records view from anything in the entry graph pulls
  it into the main chunk.
- **Tests that pin today's layout** change in the test commit and are named in
  the PR:
  - `SeasonsTab.test.tsx`'s leaders tests (they move to the Seasonal tests);
  - `stats-requests.test.tsx`'s Seasons counts (7 → 4, 5 → 2);
  - `StatsPage.test.tsx`'s two tabs and "the only tablist";
  - `stats-css.test.ts`'s scroll-container check for `features/stats` (the
    tables' CSS leaves it).
- **`staleTime: Infinity` and the test clients.** The test kit's clients use
  `staleTime: 0`, so a "Back makes 0" passes only through the read's own
  `staleTime`. Declare it on the query options in `api/records.ts`, not in a
  component.
- **The navigator assumes a season today.** `StatsNavigator` reads
  `top.season` for its heading and team links. The union grows, so narrow by
  `kind` everywhere, including `StatsNavigator.test.tsx`'s typing.
- **`teamLink` is optional.** `StatsNavigator.test.tsx`'s state-driven
  `pickerAdapter` has none, and FRONTEND-021's picker may not want one.
- **The stretched link.** The card must be `position: relative` and nothing
  inside it may sit above the `::after`. Check at 360 that the + button
  doesn't cover a card's "View all" (FRONTEND-020's row).
- **CLS.** The cards appear when one summary lands: hold their place with the
  shared `Skeleton` at the cards' height. The list's place holds while it
  loads.
- **`prettier --write` on named files only.**

## Not in this task

- The compose stats picker, and records as attachments (FRONTEND-021).
- R22, R23 (FRONTEND-021).
- Any backend change: EVENTS-010's routes are as they are.
- Any change to the game page, the player page, the modal flow, the shell or
  the post cards.
- Any new dependency.
