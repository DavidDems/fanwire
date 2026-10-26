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

## Decided by the Director

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
- **R23:** `loadComposer` caches a rejected import, so a chunk that failed once
  stays failed until a reload. The picker's chunk must not copy that.
- **R25:** the picker would load the shared `StatsNavigator` chunk (4,696 B
  gzip on 47b6ffd), which also carries the records views and `SeasonSelect`,
  though no record is selectable. Split them out, or budget their cost by
  name. The skeptic's prototype decides.
- **R29:** `api/records.ts` has a copy of `api/stats.ts`'s private `ok()`.
  Fold them into one.
- **R30:** Back pressed before a cold record's list lands goes to the Team
  tab, even for a player record.
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
- **The entry.** `Dialog` is in the entry (the detail modal uses it), so
  R22's focus line is the only entry growth allowed. Anything the picker
  imports statically from the entry graph pulls it into the main chunk.
- **The Stats page must not change.** The game, players and player levels are
  only reachable in select mode. A team's game row on Stats still links
  `/games/<id>`.
- **Tests that pin the panel** change in the test commit and are named in the
  PR: `AttachmentPicker.test.tsx`, `attach-row.test.tsx`'s disclosure checks,
  `component-isolation.test.ts`'s file list, and the `Dialog` focus tests.
- **`staleTime` and the test clients.** The test kit's clients use
  `staleTime: 0`, so a "makes 0" line passes only through the read's own
  `staleTime`. Declare it on the query options in `src/api/`.
- **`prettier --write` on named files only.**

## Not in this task

- Records as attachments, or a fourth `data_link` type (backend).
- Any change to the game page, the player page, the feed, the thread, the
  shell, the modal flow or the post cards.
- Any new dependency.
