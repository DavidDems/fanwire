# FRONTEND-058: tidy-ups that change tests, behaviour unchanged

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5b takes what track 5 left. FRONTEND-052 (deliverable 2) skipped three
tidy-ups under the human's no-test-changes rule, and its brief says why: "Out of
scope … none of them can be a behaviour-unchanged tidy-up" without changing a
test. They went to `TODO/02-backlog.md` ("**Track 5 tidy-ups that change
tests**"). On 2026-11-25 the human decided the tidy-ups **may change tests**.
This unit does them. Behaviour stays the same.

The Director checked each fact in the code at the tip of `outstanding-track-5b`:

- **`features/games/format.ts`** imports only `date-fns`. Twelve shipped files
  import it: six in `components/stats-nav/`, four in `features/games/`,
  `features/players/PlayerPage.tsx` and `features/stats/Leaders.tsx`. Seven
  tests import it: its own three (`format.test.ts`, `format-player.test.ts`,
  `team-short-name.test.ts`) and four stats tests. Three isolation tests pin
  the path as the one cross-feature exception: `games-isolation.test.ts`,
  `stats-isolation.test.ts` and `stats-nav-lazy.test.ts`.
  `features/feed/previews/format.ts` is a different module with the same file
  name. It is not this unit's.
- **`GameScore`**: only `GameScore.test.tsx` imports it. `feed-css.test.ts`
  (a `SHARED_CLASSES` row) and `games-css.test.ts` (a describe block) read its
  stylesheet. `RecentGames.test.tsx` and `search-isolation.test.ts` mention it
  in history comments, which stay.
- **`UserIcon`**: only `icons.test.tsx` imports it. That test also pins the
  index header's "twenty Lucide icons in all". **`ChevronDownIcon`** is used
  by `Dialog.tsx` and stays.
- **`api/stats.test.ts`**'s "TEAMS_KEY is the one features/profile and search
  spell" went stale in FRONTEND-052: `features/profile` imports `TEAMS_KEY`
  now, and search reads no teams at all. The assertion,
  `["events", "teams"]`, still holds.

## Decision (Director's): `src/lib/format.ts`, same name

The backlog row and `0x08h` ("Moving `format.ts` to a shared `src/lib/` is the
cleaner home") name `src/lib/`. The file keeps its name, so the lazy chunk is
still called `format`, and its three tests move with it unchanged except for
their header comments. Once the module is shared and owned by no feature, the
FRONTEND-009 exception has nothing to allow. The three isolation tests then
lose it: stats and players import no other feature, nothing under
`components/` imports `features/`, and the only exception left in games is
schedule's `GameCard` (FRONTEND-044).

## The unit

1. **Tests, red, one commit** (`test_agent`; tests frozen afterwards):
   - `git mv` the three format tests to `src/lib/`. `./format` now points at a
     file that isn't there yet.
   - Four stats tests: `../games/format` becomes `../../lib/format`.
   - The three isolation tests, as the criteria list. They also add a pin that
     `src/lib/format.ts` exists and `features/games/format.ts` doesn't.
   - Delete `GameScore.test.tsx`. Remove the `feed-css.test.ts` row. Replace
     `games-css.test.ts`'s `GameScore` block with an "it's gone" pin.
   - `icons.test.tsx`: no `UserIcon`; the header check expects "nineteen Lucide
     icons in all" and no `UserIcon` or `lucide: user`.
   - `api/stats.test.ts`: the title and the header comment.
2. **Implementation** (`code_agent`): `git mv` the module, fix the twelve
   importers and `labels.ts`'s comment, delete `GameScore.tsx` and its
   stylesheet, and delete `UserIcon` with the header count.
3. **Docs** (`context_maintainer`): `0x08-frontend.md`, `0x08f`, `0x08h` and
   `0x08i`, as the last criterion says.

### The honest red

Every item except the title rename fails before the implementation for its own
reason: "module not found" (the moved tests and the four stats tests), the new
"src/lib/format.ts exists" and "GameScore is gone" pins, the no-exception
sweeps, which still find `features/games/format` imports, and the icon header
count. The rename is only a test name, so it is green both before and after.
That is fine: the commit as a whole is red, and the PR quotes each failure. A
commit that only deleted `GameScore.test.tsx` or the `feed-css` row would stay
green, which is why the "gone" pins exist. They are the same kind of pin as
`icons.test.tsx`'s retired `LinkIcon` and `stats-isolation.test.ts`'s
"`features/stats/api.ts` is gone".

## Bundle (Director's prototype, then reverted)

Prototype: the module moved, every importer updated, `GameScore` and
`UserIcon` deleted. Measured with the track's script, every output was
byte-identical to the tip: entry JS 147,270 B gzip / 465,831 B raw, entry CSS
7,457 B, and `format` 491 B under the same chunk name. Nothing was added or
removed. `GameScore` and `UserIcon` were already tree-shaken out. **No
bundle-budgets file.** If the finished unit moves anything past 100 B, or adds or
removes an output, stop and report.

## Running beside FRONTEND-059

The two units share no path. FRONTEND-059 writes `PostNode.module.css`,
`previews/Previews.module.css`, a new `styles/no-italics.test.ts`,
`features/account/`, `features/compose/attachmentReads.ts` and a new compose
test, `features/profile/`, and `0x08b-frontend-auth.md`. This unit writes none
of those, and each unit forbids the other's paths. **They can run in
parallel.** FRONTEND-059's prototype moved no output past tolerance, and this
unit moves none, so the two together stay inside the budgets.

## Traps

- `git mv`, so the history follows the file. A deleted path is still a change
  to that path, and every old path is in `allowed_paths`.
- A `sed` over `"./format"` must not touch
  `features/feed/previews/`, whose `./format` is the feed's own module.
- `BoxScore.tsx` and `PlayerPage.tsx` import over several lines, ending in
  `} from "…/format";`. Grep after the edit: no `games/format` import is
  left anywhere.
- `stats-nav-lazy.test.ts` still has to see `api/stats.ts` and the navigator
  stay out of the entry. `lib/format.ts` stays lazy, as the prototype's
  unchanged entry shows.
- `prettier --write` on named files only: a glob also matches committed tests.
- Run the frontend suite alone, in the foreground, sharded. A killed suite
  proves nothing.

## For the Director after merge (not unit-writable)

- **`TODO/02-backlog.md`**: delete the "Track 5 tidy-ups that change tests"
  row.
- **`FrontendUI/components-shared.md`**: the `GameScore` rows (lines 24 and 50)
  go. `UserIcon` leaves the `icons/index.tsx` row (line 60), and the
  "(unused) `user`" row (line 94) goes.
  `FrontendUI/components-sports.md`'s "Score block (`GameScore`, …)" section
  says nothing renders it and keeps the design for reuse. Keep the design,
  and say the component is deleted.
- **Open, for a later unit:** with the formatter in `src/lib/`, the feed's
  `previews/format.ts` could use it instead of keeping its own `formatDate`
  and `formatAverage`. The previews brief kept them local only because
  features may not import each other. That is not a tidy-up for this unit.
