# FRONTEND-028: frontend tidy-up, behaviour unchanged

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why, and what was checked

The backlog's "Frontend tidy-ups" and "`fetchTeams` exists in four places" rows,
checked against `fanwire-archive@4795f19`. What the rows say and what is true differ:

| Item | Row says | On `fanwire-archive@4795f19` |
|---|---|---|
| `ScrollTable` | copies in `stats` and `players` | Two: `components/stats-nav/ScrollTable.tsx` (`features/stats`'s copy went with `FRONTEND-019`) and `features/players/ScrollTable.tsx` |
| `fetchTeams` | four | Three: `api/stats.ts`, `features/profile/api.ts`, `auth/ProfileSetupPage.tsx`. `attachmentReads.ts` no longer has one |
| Query key | one | One value, three spellings: `TEAMS_KEY`, `TEAMS_QUERY_KEY`, an inline literal |
| `GameScore` | no caller | True: only its own test and two CSS test lists name it |
| `ChevronDownIcon` | no caller | **Left out.** `Dialog.tsx` uses it for Back |
| `LikeButton` comments | three files | Two: `SearchPage.test.tsx`, `search-isolation.test.ts`. `Button.tsx` no longer names it, but still says nothing carries `aria-pressed`, and `PostAction` passes it |

## Start gate

Start only when no other PR touching `frontend/` is open, Renovate's included. This
unit moves a module imported across the tree and scanned by several tests, so any
open frontend PR is a merge conflict or a tree-scan failure. If fanwire-archive#296 is still open,
wait for it to merge or for the human to say otherwise.

## ScrollTable: the trap is the CSS, not the component

The two components differ only in their stylesheet and the caption's class. The two
stylesheets' table rules hold the same declarations, and Players' extra
`.scroll:focus-visible` repeats `base.css`'s `:focus-visible`, so one table can
replace both with no visual change.

But CSS modules hash per file. Today's cells use `.table .name` from their own
module; once `.table` lives in `components/ui/ScrollTable.module.css`, those
selectors stop matching:

- `.name` and `.figure` have to move to the shared module and be exposed to callers.
  Nineteen call sites read them from `StatsNav.module.css`, and `Leaders.tsx` imports
  it as `table`. Players' own uses move too. Suggested: export the classes from
  `ScrollTable.tsx`, so no caller imports another folder's stylesheet.
- `.table .postCell` in `Players.module.css` has specificity (0,2,0). Written without
  `.table` it loses to the shared `.table td`'s `text-align: right`. Keep it winning,
  and prove it with the post-about cell's computed `text-align` and `width`.
- CSS order across lazy chunks is not guaranteed, so do not rely on source order to
  break a tie between modules.
- `PlayerPage.test.tsx` requires `--duration-fast` in both stylesheets, so those
  rules stay. `stats-css.test.ts` looks for a scroll container in named files; point
  it at the new module without weakening it.

Vitest 4 returns a class name for any key of a CSS module, so `toHaveClass(styles.x)`
proves nothing unless `.x` is on disk (`search-css.test.ts` says why). The end-state
test reads the file.

## fetchTeams

`api/stats.ts` is the home: `stats.test.ts` already pins `fetchTeams` and `TEAMS_KEY`
there. Its `ok()` throws the same message as the two copies, so callers see no change.
`ProfileSetupPage` and `ProfileSettings` are both lazy, as is the `stats` chunk. Check
the build to confirm the `stats` chunk stays lazy and the entry does not grow.

## Formatter

`src/lib/` does not exist yet, and this creates it with the one file. The `format`
chunk keeps its name, since Rollup names it after the file, so its budget entry should
not move. The importers: `stats-nav/{RecordLevel,RecordsLevel,SeasonLevel,TeamLevel}.tsx`,
`stats-nav/recordLabels.ts`, `games/{BoxScore,GamePage,LineScore}.tsx`,
`players/PlayerPage.tsx`, `stats/Leaders.tsx`, and two test files in `features/stats`.
`stats-nav/labels.ts` and several test headers name it in comments only; fix those too.

## Scrim

Today: `background-color: var(--neutral-950); opacity: 0.6`. Recommended:
`--color-scrim: rgb(1 29 40 / 0.6)` in the light `:root` with no dark override, since
it is the same in both themes, and drop the `opacity`. A token holding a colour and a
leftover raw opacity would be half a token. `tokens.css` says `tokens.md` owns every
value and a unit cannot write `tokens.md`, so the later Director PR records it.

## How test-first works for a refactor

`handoff.md` §10.4 said refactors need `require_red_baseline: false`, because
behaviour tests are green before and after. This spec keeps it true:
`frontend-tidy-end-state.test.ts` pins the end state from disk (one definition, old
paths gone, token present, stale words absent) and fails today. Moving the format
tests in the test commit makes them red too, correctly: `lib/format` does not exist
yet. Budget ceilings in the test commit are estimates, as `bundle-budget.ts` expects.
A ceiling that proves wrong is fixed in its own test-only commit and disclosed
(`work-modes.md`).

The end-state test must exclude itself from its own word scans.

## openapi-fetch 0.17 (fanwire-archive#296)

On 0.11.3 a body-less non-2xx gives `error: ""`. On 0.17.0 one with `Content-Length: 0`
gives `error: undefined`, otherwise still `""`. Both are falsy, so `fetchProfile` is
right on either version and only the comment changes. Keep the wording true of both.

## Traps

- Run the guard per commit and role with the worktree's own `agentctl.py`
  (`director-sessions.md`, "Verification").
- Prettier has no project config: run it on named files only, never a glob.
- Browser rows are heavy work and need the heavy lock. Track B ports 5210-5219 with
  `--strictPort`. Stop only the port you started. Row 4 needs a signed-in session on
  localhost; if the stack is not up, report it NOT DONE rather than skip it silently.

## Later Director PR, not this spec (none of these are unit-writable)

- `FrontendUI/tokens.md` §4: add `--color-scrim`. This is the doc the token needs.
- `FrontendUI/components.md`: the `Dialog` row ("there is no scrim token"), the
  `GameScore` rows and its score-block section, and a `ScrollTable` row in `components/ui`.
- The two rows in `TODO/02-backlog.md`.
