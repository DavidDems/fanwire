# FRONTEND-021: the stats picker modal

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 4, the last, of
`wiki/GeneralContext/Prompts/20-stats-navigation-and-compose-modal.md`.
FRONTEND-020 turned compose into a modal and put a bar chart in its attach
row, but the bar chart still shows FRONTEND-013's in-form `AttachmentPicker`
panel: three choice buttons, native selects and lists. FRONTEND-018 and -019
built one stats navigator (`components/stats-nav/`), outside `features/` so
compose can use it. This unit replaces the panel with a second modal that
holds that navigator in select mode, with Cancel and Select. It also closes
the risks the thread carried here: R22, R23, R25, R29, R30 and R32.

## Decided by the human

- **From the request (2026-10-23):** the stats picker has Cancel and Select,
  and Select is grey and disabled until something selectable is chosen.
- **2026-10-26, by `AskUserQuestion`:**
  - **A game's result is picked on the game's level.** A game row on a team
    opens the game: "Final score" is its first selectable row, and every
    played line in the box score under it is selectable too. Both game types
    are picked in one place.
  - **The picker's tabs are Seasons and Players.** A record can't be attached,
    so Records isn't offered.
  - **Compose opens with focus in the text box** (R38). Today it opens on
    Close, because the text box has no autofocus.

## Decided by the Director

- **The navigator takes the levels it doesn't own from its caller** (the
  skeptic's D3 and D4). `StatsNavigator` draws the season and team levels.
  Every other level's breadcrumb name and view come from a `LevelViews` prop:
  - `RecordsTab` passes the records views;
  - the picker passes the game, players and player views, which live in
    `features/compose/`, beside the selection rules.

  `stats-nav` may import nothing under `features/` but
  `features/games/format`. The records views leave the shared chunk with no
  extra serial load.
- **The picker's `Dialog` sits outside the compose `<form>`.** A nested
  `<dialog>` still belongs to the form around it. In the skeptic's prototype,
  Enter in the search box and Enter on a radio each posted the draft (D6).
- **The picker's `Dialog` is anchored at the top,** as compose's is. Centred,
  it scored a CLS of 0.17–0.27 as levels landed (D7).
- **Nested `Dialog`, not a panel.** The picker is a `Dialog` opened inside
  the compose `Dialog`, as a confirm opens inside the thread modal
  (`FRONTEND-012`). The browser stacks them, Escape is the inner one's, and
  focus returns to the bar chart. The old panel's comment ("a dialog over a
  dialog is a trap") predates nested `Dialog` support.
- **State-driven navigator.** The picker owns its stack. No address changes
  while it is open, so Back in the browser still means the compose modal's
  Back. No `levelHref`, so every level control is a button, and nothing in the
  picker is a link (R18).
- **One choice across the whole picker,** held while the reader moves
  between levels and named in a status line, so it's always clear why Select
  is enabled. Rows are native radios: no `aria-activedescendant`, and the
  arrow keys work for free.
- **Not selectable means plain text,** never a disabled control. A reader
  never tabs to something that can't be chosen.
- **The picker starts afresh each time it opens.** Its reads are cached with
  the Stats page's keys, so a fresh start costs no requests.
- **Reads through `src/api/` only.** The picker shares the Stats page's cache.
  `attachmentReads.ts` keeps what a pre-filled `?link=` needs (the address
  check), the selectability rules and the summary words. The game page and the
  player page keep their own reads: moving them is out of scope.

## The carried risks this unit closes

- **R22:** `Dialog` leaves initial focus to the browser. Chrome takes the
  content scroller on tall, cached content. The fix is in `Dialog` itself:
  focus Close after `showModal()`, and let a child's own effect move it
  further.
- **R23:** `loadComposer` caches a rejected import. On `main`, the skeptic
  measured worse than "stays failed": the whole app is replaced by React
  Router's error page. Two traps (D11):
  - `React.lazy` caches its rejection too, so use a module-level promise
    that is cleared on failure;
  - Vite never requests a stylesheet twice, so Try again re-requests the
    failed ones first, or the recovered content renders unstyled.
- **R25:** the picker would load the shared `StatsNavigator` chunk (4,696 B
  gzip on 47b6ffd, of which the records views are about 1,450 B), though no
  record is selectable. Decided by the injection above (D3): the chunk drops
  to about 3,243 B, and the records views move into `RecordsTab`.
- **R29:** `api/records.ts` has a copy of `api/stats.ts`'s private `ok()`.
  Fold them into one.
- **R30:** Back pressed before a cold record's list lands goes to the Team
  tab, even for a player record. Until the group is known, it comes from the
  id's prefix (`team-` or `player-`, D12).
- **R32:** the StatsPage and routes tests that reach a lazy tab have no
  warm-up, so a cold-chunk `findBy` can flake under the full suite.
- **R33:** done in this spec's PR. `bundle-budgets/FRONTEND-019.ts` is folded
  into the base, measured with the test's own vitest build on 47b6ffd.

## Traps

- **The bundle-budget file.** Add `src/test/bundle-budgets/FRONTEND-021.ts`
  in the **test commit**. List every lazy output the unit changes, adds or
  removes, each with a gzip ceiling, and the entry growth. Rollup names a
  chunk after its first module, so build a scratch copy of the planned layout
  before declaring. The Director may correct chunk names in its own commit
  after a build of the implementation, keeping the sums (R20).
- **The entry.** `Dialog` and `routes/ComposeModal.tsx` are in the entry.
  R22's line and R23's retry grow it, and so do the new outputs' names in
  Vite's preload map. The prototype measured +215 gzip and +500 raw, and the
  ceiling is +300 and +700. Anything the picker imports statically from the
  entry graph pulls it into the main chunk.
- **The Stats page must not change.** The game, players and player levels are
  only reachable in select mode. A team's game row on Stats still links
  `/games/<id>`.
- **Tests that pin the panel** change in the test commit, and the PR names
  each one, test by test. The prototype broke 47 tests in 6 files:
  - `AttachmentPicker.test.tsx` (25);
  - `ComposePage.test.tsx` (15);
  - `attach-row.test.tsx` (2);
  - `compose-style.test.tsx` (3);
  - `RecordLevel.test.tsx`'s breadcrumb-before-the-list test;
  - `lazy-routes.test.ts`'s compose Suspense test.
- **Two `id="stats-season"`s.** With compose over `/stats/seasons`, the
  Stats page's select and the picker's shared an id, and the picker's select
  lost its name. `SeasonSelect` takes its id from `useId` (D5).
- **The measuring databases.** `fanwire_perf` has the full stats load but no
  posts, so the compose rows run over the `fanwire` dev database's feed (20
  cards on its first page). The CLS rows delay every `/api/events/` read by
  800 ms: a faster read lands inside the 500 ms input window and scores 0 by
  definition.
- **`staleTime` and the test clients.** The test kit's clients use
  `staleTime: 0`, so a "makes 0" line passes only through the read's own
  `staleTime`. Declare it on the query options in `src/api/`.
- **`prettier --write` on named files only.**

## The skeptic

**First pass, 2026-10-26: proceed with changes, all landed in this spec.** It
built a bare prototype on 741944e and measured it with the budget test's own
build. Its build of 47b6ffd matched the Director's fold byte for byte.
- **Bundle:** the entry grows +215 gzip and +500 raw. Compose open gets
  lighter: `ComposePage` plus `stats` is 4,566 B, against 5,373 before. The
  picker cold loads 6,998 B of JS and 1,862 of CSS.
- **Requests:** opening the picker cold makes 3, and reopening it makes 0.
  Every level makes 1, and choosing, Select and Cancel make 0.
- **Long tasks** at 4× CPU and 360 wide: the worst row was 137 ms (opening a
  96-game team), and the picker cold had a median of 55 ms.
- **Its defects, D1–D16:**
  - the under-declared bundle lines, and the entry's real growth;
  - the R25 split by injection;
  - where the select-mode views live;
  - the missing season select, and its duplicate id;
  - Enter posting the draft;
  - the centred dialog's CLS;
  - the request counts, and the shared cache keys;
  - the full list of broken tests;
  - `attachmentReads.ts`'s contradiction;
  - R23's two traps, and R30's group prefix;
  - compose's initial focus (the human's R38);
  - a database for the feed rows;
  - the PR body's test list;
  - a wrong number.

Risks carried (Prompt 20 Progress):
- **R34:** a cold Seasons or Records fetches 3 more, smaller files.
- **R35:** new chunk names that the Director may need to correct.
- **R36:** a full playoff season's team table is the heaviest DOM.
- **R37:** nested `Dialog`s are proven for one level only.

## Not in this task

- Records as attachments, or a fourth `data_link` type (backend).
- Any change to the game page, the player page, the feed, the thread, the
  shell, the modal flow or the post cards.
- Any new dependency.
