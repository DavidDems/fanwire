# FRONTEND-052: frontend tidy-ups, behaviour unchanged

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5, deliverable 2 (`Prompts/34`, ADR 0035): one spec of tidy-ups, behaviour
unchanged. Each item is a copy or a stale note the module docs already record as known
debt: two `ScrollTable` copies, three teams fetches, two (three, counting `Avatar`)
media-URL joins, a primitive where a semantic token belongs, and comments that still
describe `LikeButton`, which UI-009 replaced.

## The human's rule: no test changes

The existing tests, unchanged and green, are the proof that behaviour did not change.
The only test edits allowed are comment-only: the two search tests'
`LikeButton` mentions and the stale msw comments (Director's amendment, below). Every
test and test-kit file's diff must be comments only: no code, assertion or test name
changes. So there is no red test and `require_red_baseline` is
`false` (`state-machine.md`: a waived baseline, said why here). The commits are:

1. **test_agent**: the comment edits (the search tests and the msw comments), plus
   `bundle-budgets/FRONTEND-052.ts` if the bundle moves (see Bundle). Measure on the
   finished implementation, then commit this first.
2. **code_agent**: the implementation.
3. **context_maintainer**: the module docs.

## The unit

- **One `ScrollTable`.** `components/ui/ScrollTable.tsx` exports `ScrollTable` and
  `ColumnHeader`; both old copies are deleted. The copies differ only in their
  stylesheet (`StatsNav.module.css` vs `Players.module.css`, whose caption has a class),
  so the shared component owns the markup and roles, and each caller passes its own
  classes. It imports no stylesheet. `stats-css.test.ts` pins an `overflow-x: auto` rule
  in `features/players` and in `components/stats-nav`, so both stylesheets stay as they
  are. Callers: `RecordLevel`, `SeasonLevel`, `TeamLevel`, `Leaders` and `StatsPicker`
  (navigator classes; `StatsPicker` and `Leaders` import `StatsNav.module.css` the way
  `Leaders` already does), and `PlayerPage` (players classes). Every table must render
  with the class names it has today. `ColumnHeader`'s `name` boolean can become a
  `className`, or the class can be passed some other way. Pick the plainest; the
  rendered `th` is what's fixed.
- **One teams fetch.** `api/stats.ts` already has `fetchTeams` and `TEAMS_KEY`, pinned
  by `api/stats.test.ts`. The copies in `features/profile/api.ts` and
  `auth/ProfileSetupPage.tsx` go, and their callers use `api/stats`. No test imports a
  copy and the error text is identical (`api/ok.ts`), so nothing is re-exported.
  `features/compose/attachmentReads.ts` has no copy (checked), so it is left alone.
  `api/stats.ts` stays out of the entry: `ProfilePage` and `ProfileSetupPage` are both
  lazy (`stats-nav-lazy.test.ts` checks the entry can't reach `api/stats.ts`).
- **One media-URL join.** `src/lib/mediaUrl.ts` (beside `lib/teamColors.ts`, which
  `components/ui/TeamIcon` already imports; no isolation test restricts `lib/`) holds the
  feed's trimmed join. `features/feed/api.ts` re-exports it, because five feed, search
  and thread tests import `mediaUrl` from there. `MediaWidget`'s `thumbnailUrl` and
  `Avatar`'s untrimmed `config.mediaBaseUrl + "/" + key` use it. No test checks Avatar's
  `src`, and the output is identical for every key the API sends.
- **A scrim token.** `--color-scrim: #011d28` in `tokens.css`, light and dark (the
  semantic colours are hex and redeclared in the dark block, so the scrim is too).
  `Dialog.module.css`'s backdrop uses it. The rendered colour is unchanged.
  `tokens.test.ts` checks a fixed list and that no dark token is Teal, so it stays
  green.
- **Comments.** Fix `Button.tsx`'s "no `aria-pressed`" (the post card's Like and Repost
  carry it since UI-009, through `Button`). In the two search tests, `LikeButton`
  becomes `TogglePostAction`. Neither search test has an "aria-pressed" comment; their
  `aria-pressed` lines are assertions and stay. `Stats.module.css`'s header names the
  shared `ScrollTable`. `api/stats.ts`'s comments that say `features/profile` spells the
  key itself are corrected.

## Bundle

`ScrollTable` shared by the stats chunks, the picker and `PlayerPage` may become a new
shared lazy chunk. `api/stats.ts` gains the two profile importers. `lib/mediaUrl.ts`
joins the entry with `Avatar` and the feed. Measure on the finished implementation, then
declare every lazy output that appears, disappears or moves past the 100 B tolerance,
and any entry growth past tolerance, in `bundle-budgets/FRONTEND-052.ts`. Add no file if
nothing moves. Never touch `bundle-budget.ts` or `ENTRY_JS_RAW_HARD_MAX`: the room
FRONTEND-051 made is for later units. More than 200 B gzip on any lazy output, or 300 B
on the entry: stop and report.

## Amendment (Director): the msw comments are in scope

The human's rule allows comment-only msw edits in tests. Since msw 3, `setupTests.ts`
starts the server with `onUnhandledFrame: "error"`, but ten comments still say
`onUnhandledRequest: "error"`. Change each one to `onUnhandledFrame`, keeping the
sentence's meaning, in the test_agent commit:

- `features/compose/ComposePage.test.tsx`
- `features/feed/FeedRoute.test.tsx`
- `features/notifications/EmailPreference.test.tsx`
- `features/notifications/NotificationsPage.test.tsx`
- `features/profile/FollowButton.test.tsx`
- `routes/routes.test.tsx` (a `//` comment)
- `test/app-route.tsx`
- `test/compose.ts`
- `test/server.test.ts`
- `test/server.ts`

`test/app-route.tsx`, `test/compose.ts` and `test/server.ts` are test kit, under
`frontend/src/test/**`, which `test_agent` may write. Afterwards, `grep -rn
onUnhandledRequest frontend/src` finds only `harness.test.ts`'s assertion that
`setupTests.ts` no longer names it. That assertion stays. Check each file's diff before
committing: comment lines only.

## Out of scope (back to the backlog for the human)

The deliverable lists these, but under the no-test-changes rule none of them can be a
behaviour-unchanged tidy-up:

- **`features/games/format.ts` to `src/lib/`.** Many tests import `./format` or
  `../games/format`, and `games-isolation.test.ts` and `stats-nav-lazy.test.ts` pin
  `features/games/format` as the one shared formatter path. Moving it means changing
  those tests.
- **Deleting `GameScore`.** Its own test, `feed-css.test.ts`, `games-css.test.ts`,
  `RecentGames.test.tsx` and `search-isolation.test.ts` name it.
- **Deleting `UserIcon`.** `icons.test.tsx` pins it.
- **`ChevronDownIcon`** isn't caller-less: `Dialog.tsx` uses it (the Back icon), so
  there is nothing to delete.
- **`api/stats.test.ts`'s test name** ("TEAMS_KEY is the one features/profile and
  search spell") goes stale once `features/profile` imports the key. A test name isn't
  a comment, so it stays, and so does that file's header comment (the file isn't in
  `allowed_paths`). The assertion still holds.

## For the Director afterwards (deliverable 8; `FrontendUI/` is not unit-writable)

- `FrontendUI/tokens.md` §4: add `--color-scrim` (`#011d28`, light and dark, the modal
  backdrop at 0.6 opacity). `tokens.css` says it is copied verbatim from that table.
- `FrontendUI/components-shared.md`: in the `Dialog` row, "The backdrop is
  `--neutral-950` at 0.6 opacity: **there is no scrim token** … a styles unit may add
  one" becomes `--color-scrim`. Add a `ScrollTable` / `ColumnHeader` row (markup and
  roles shared, classes from the caller).
- `FrontendUI/components-map-pages.md`: the `features/players/PlayerPage` row's
  "**`ScrollTable` is copied in `stats` and `players`** … one shared table wrapper in
  `components/ui/` is the fix" becomes the shared `components/ui/ScrollTable`.
- `TODO/02-backlog.md`: the out-of-scope items above.

## Traps

- `prettier --write` on named files only: a glob also matches committed tests.
- Deleting a file is a change to its path, so both old `ScrollTable.tsx` paths are in
  `allowed_paths`. Guard-check each commit by its role.
- A CSS module is a Proxy under Vitest, with no own keys. Pass classes by property
  access (`styles.scroll`), not by spreading or iterating the module.
- `stats-nav-lazy.test.ts`: compose must reach no `components/stats-nav/` module, and
  the entry must reach neither `api/stats.ts` nor anything in `components/stats-nav/`.
  `components/ui/ScrollTable.tsx` is outside that folder, and none of its importers is
  eager.
- Run the frontend suite alone, in the foreground, sharded. A killed suite proves
  nothing.
