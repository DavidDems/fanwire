# FRONTEND-055: "1 follower"

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5, deliverable 5 (`Prompts/34`, ADR 0035), "Singular counts", and the backlog
row "**"1 followers", "1 likes"**: singular and plural" (origin the `UI-005` and
`UI-008` browser passes). That row already says the feed half is `UI-009`'s and that
what's left is the profile's "1 followers". The Director checked both halves:

- **Feed: done.** `features/feed/counts.ts`'s `countText` picks the singular at
  exactly one ("1 like", "1 reply", "1 repost"), pinned in
  `features/feed/counts.test.ts` (`UI-009`).
- **Profile: not done.** `features/profile/ProfileSummary.tsx` renders
  `` `${followerCount} followers` ``, so one follower reads "1 followers".
  The other count, `` `${followingCount} following` ``, has no singular form ("1
  following" is right), and the header has no other count. Nothing else in
  `features/profile/` renders a count.

## Decision (Director's): a profile-local ternary

`"follower"` at exactly 1, `"followers"` otherwise, "0 followers" included, in one
template-literal text node as today. It stays in `features/profile`:

- **Not `countText`.** The feed's helper is in `features/feed`, and features may not
  import each other (the connection rule).
- **Not `src/lib/`.** One noun with one regular plural doesn't make a shared helper
  worth having, and FRONTEND-054, running at the same time, writes `src/lib/`.
- **No locale formatting.** `countText` puts the number through
  `Intl.NumberFormat` ("1,000 likes"); the profile has always printed the bare
  number. Changing that is a separate decision, listed below for the Director, not
  part of a singular fix.

## The unit

- **Red first, one commit** (`test_agent`): `features/profile/follower-count.test.tsx`
  (new) renders `ProfileSummary` directly with 0, 1 and 2 followers (and 1
  following) and matches the whole text of each count exactly. Only the count of
  one fails today, and that's the red reason.
- **Implementation** (`code_agent`): `ProfileSummary.tsx`, the follower `li` and its
  doc comment.
- **Docs** (`context_maintainer`): the `ProfileSummary` sentence in
  `0x08b-frontend-auth.md`.

## Existing tests

None change. Every existing exact match ("3 followers", "12 followers", "0
followers", "N following") is for a count other than one, so all of them stay green.

## Running beside FRONTEND-054

FRONTEND-054 (one 429 line) runs at the same time. It writes `src/lib/messages*`,
three compose and feed files, two of their tests, `0x08-frontend.md` and
`0x08c-frontend-compose.md`. Each unit forbids the other's paths. Neither declares a
bundle output. The Director's separate prototypes measured `ProfilePage` +9 B here
and `ComposePage` -19 B there, both well inside the 100 B tolerance.

## Traps

- `getByText("1 follower")` is an exact, whole-text match by default, so it doesn't
  match "1 followers". Keep it exact. A regex would let the bug through.
- `prettier --write` on named files only: a glob also matches committed tests.
- Run the frontend suite alone, in the foreground, sharded. A killed suite proves
  nothing.

## For the Director after merge (not unit-writable)

- **`TODO/02-backlog.md`**: delete the "1 followers", "1 likes" row (both halves
  done: `UI-009` and this unit).
- **FrontendUI** (deliverable 8's PR): `components.md`'s "Text that tests read stays
  one text node" names "12 followers". Still true. Add "1 follower" only if the
  map lists the singular forms.
- **Open, for the human:** the profile prints counts bare ("1200 followers") while
  the feed formats them by locale ("1,200 likes"). Matching them would be a small
  unit of its own.
- **Browser check**, the last criterion.
