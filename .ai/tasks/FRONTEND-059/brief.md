# FRONTEND-059: typography and counts

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5b takes three of track 5's leftover backlog rows (`TODO/02-backlog.md`,
"Frontend"). Each is a small text-level fix:

- **"Italic `.unavailable` lines against 'No italics in the UI'"**
  (`typography.md` §2). The human decided on 2026-11-25 to **drop the italic**
  rather than document an exception.
- **"Three UI strings with a straight apostrophe"** (`typography.md` §2 names
  the three).
- **"Profile counts are bare, the feed's are localised"**: the profile prints
  "1200 followers", the feed "1,200 likes". FRONTEND-055 left this open for
  the human.

The Director checked each fact in the code at the tip of `outstanding-track-5b`:

- `font-style: italic` occurs twice in `src`: `.unavailable` in
  `features/feed/PostNode.module.css` and in
  `features/feed/previews/Previews.module.css`. No other stylesheet, no
  `fontStyle` in TSX, and no `<em>`, `<i>`, `<cite>` or other element that is
  italic by default.
- The three strings are in `features/account/AccountSettings.tsx` (not
  `src/AccountSettings.tsx`) and `features/compose/attachmentReads.ts`
  (`describeBareLink` and `checkAddressLink`). **No existing test pins any of
  them.** `attachments-context.test.tsx` compares against `describeBareLink`'s
  own output, so it follows whatever the function returns.
  `AttachmentPicker.test.tsx`'s `"Player's game"` checks that a button is
  absent, which is a different thing. `prefilled-link.test.tsx` checks only
  that a note exists. So the unit adds the pins instead of editing them.
- `ProfileSummary.tsx` renders `` `${followerCount} …` `` and
  `` `${followingCount} following` `` bare. `features/feed/counts.ts`'s
  `countText` formats with `new Intl.NumberFormat()` (default locale), and
  `counts.test.ts` pins "1,000 likes". `src/lib/` has no count or number
  helper (`teamColors`, `mediaUrl`, `messages`).

## Decisions (Director's)

- **The italic test is a stylesheet sweep.** There is plenty of precedent for
  testing CSS from disk here: every `*-css.test.ts`, and `styles/base.test.ts`'s
  src-wide "no keyframes" and "no `url(` or `@import`" sweeps. jsdom applies no
  styles, so reading the files is the honest check. A new
  `styles/no-italics.test.ts`, rather than a new block in `base.test.ts`,
  keeps the rule in one file named for it. It covers `font-style` and the
  `font` shorthand, with fixtures, so it can't pass vacuously. Markup that is
  italic by default (`<em>`, `<i>`) isn't used and isn't pinned. Add that if
  one ever appears.
- **Apostrophes: new pins at the lowest level that shows the string.**
  `describeBareLink` and `checkAddressLink` are exported pure(ish) functions,
  so a plain `.test.ts` calls them, with `attachServer()`'s handlers for game
  501's box score. Line 79999 is the one `prefilled-link.test.tsx` already uses
  as "not in that game". The account string only shows when `emailVerified`
  rejects. `FakeAuthService.failWith` doesn't reach that method (it never calls
  `enter`), so the test spies on it, which keeps the change out of the test
  kit.
- **Counts: profile-local `Intl.NumberFormat()`, no shared helper.** The feed's
  `countText` is in `features/feed`, so the profile can't import it (the
  connection rule). Lifting it into `src/lib/` would mean changing the feed
  and its tests for one standard-library call. The noun rules differ too: the
  profile has "following", which has no singular. And FRONTEND-058, running at
  the same time, adds `src/lib/format.ts`. So the profile formats its two
  numbers itself, the same way (default locale, no argument). If a third
  caller ever wants "N nouns" with locale formatting, a `src/lib/` helper both
  can use is the moment to share it. The feed doesn't switch now.

## The unit

1. **Tests, red, one commit** (`test_agent`; frozen afterwards):
   - `styles/no-italics.test.ts` (new): red, listing the two stylesheets.
   - `features/account/AccountSettings.test.tsx`: one new test, red (no element
     with the ’ text).
   - `features/compose/typographic-apostrophes.test.ts` (new): red (the
     straight apostrophe comes back).
   - `features/profile/follower-count.test.tsx`: two new cases, red ("1200
     followers").
2. **Implementation** (`code_agent`): two CSS lines deleted, three strings, and
   `ProfileSummary`'s two numbers with its doc comment.
3. **Docs** (`context_maintainer`): the `ProfileSummary` sentence in
   `0x08b-frontend-auth.md`.

## Bundle (Director's prototype, then reverted)

Prototype: the italic dropped, the three strings, and a module-level
`new Intl.NumberFormat()` in `ProfileSummary`. Against the tip: entry JS +6 B
gzip (−10 raw), entry CSS −14 B, `ProfilePage` +26, `ComposePage` +5,
`AccountSettings` +3, and every other output within 3 B (hash noise). Nothing
was added or removed. **No bundle-budgets file.**

## Running beside FRONTEND-058

The two units share no path. FRONTEND-058 writes `src/lib/format*`,
`features/games/`, `features/stats/`, `features/players/PlayerPage.tsx`,
`components/stats-nav/`, `components/ui/GameScore*` and `icons/`,
`feed-css.test.ts`, `api/stats.test.ts`, and `0x08`, `0x08f`, `0x08h` and
`0x08i`. This unit writes none of those, and each unit forbids the other's
paths. **They can run in parallel.** FRONTEND-058's prototype moved no output
at all.

## Traps

- Type the apostrophe as the literal ’ (U+2019) in both source and test. Don't
  write `’` in one and the character in the other, and check the diff
  shows `’`. Test names and comments stay ASCII (`typography.md` §2).
- `getByText` / `findByText` with a string is an exact, whole-text match. Keep
  it exact. A regex would let the straight apostrophe through.
- The locale comma: the test environment writes "1,200", which `counts.test.ts`
  already relies on. Don't pass `"en-US"`: the feed uses the viewer's locale,
  and the profile should match it.
- `follower-count.test.tsx`'s `expectOneTextNodeLi` must still pass. Format
  inside the one template literal, not as a separate node.
- `prettier --write` on named files only: a glob also matches committed tests.
- Run the frontend suite alone, in the foreground, sharded. A killed suite
  proves nothing.

## For the Director after merge (not unit-writable)

- **`TODO/02-backlog.md`**: delete the apostrophe, italic and "Profile counts
  are bare" rows.
- **`FrontendUI/typography.md` §2**: "No italics in the UI. There is none in
  the app today" becomes true. Name `styles/no-italics.test.ts` as its pin.
  Delete the "Three strings still use a straight apostrophe" sentence.
- **`FrontendUI/components.md`**: if it lists the profile's count text ("12
  followers"), add the formatted form.
- **Browser check**, the last criterion.
