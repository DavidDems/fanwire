---
type: prompt
---

# 34 — Outstanding work, track 5: frontend fixes, tidy-ups and the browser rows

**Brief for a Director session.** Shared rules: [29](29-outstanding-work.md).

**Objective:** close every row under "Frontend" in `TODO/02-backlog.md`
except the two tracks 4 and 6 own. The units edit `frontend/src/**`; the UI
documentation follow-up is a Director PR.

## Read first, in this order

1. `TODO/02-backlog.md` "Frontend": every row names its origin and a note.
2. `wiki/CodeContext/Modules/0x08-frontend.md` and the part for the feature
   you touch; `FrontendUI/index.md`, `verification.md`, `verification-browser.md`.
3. `Architecture/director-sessions.md` "Browser rows".

## Where things stand (2026-11-17), verify, don't trust

- The entry chunk is 478.88 kB against a 480 kB raw limit: the next unit
  that grows it fails the bundle-budget test.
- After track 1, the database follows the Kaggle dataset, so the browser rows
  can run on real, current data.
- Browser checks use Chrome or Playwright Chromium on localhost against
  `backend-dev`; the dev database is empty, so load a stats fixture first
  (`director-sessions.md` "Browser rows").

## Deliverables (in this order; one unit each unless said)

1. **Make room in the entry chunk**: move one lazy-loadable thing out of it,
   so later units fit. Do this first, before any unit that adds to the entry.
2. **Tidy-ups, one spec, behaviour unchanged:** `features/games/format.ts` to
   `src/lib/`; one shared `ScrollTable`; one `fetchTeams` in `api/`; one
   media-URL join; delete the caller-less `GameScore`, `ChevronDownIcon`,
   `UserIcon`; a scrim token for `Dialog`'s backdrop; the stale `LikeButton`
   comments; the test comments that still say msw runs with
   `onUnhandledRequest: "error"` (since msw 3 it is `onUnhandledFrame`,
   `setupTests.ts`; `grep -rn onUnhandledRequest frontend/src` lists ten, and
   `harness.test.ts`'s assertion that `setupTests.ts` no longer names it stays). Tests are the behaviour's proof: none may change.
3. **`Field` layouts:** a checkbox layout (then delete `EmailPreference`'s
   `.preference > div` exception) and a row layout for search.
4. **A friendlier 429:** a "slow down" line in the composer and repost
   errors, with its own test.
5. **Singular counts:** "1 follower", "1 like" (profile and feed). Each has
   its own red test. This was an `auto` item; it is `hand` now.
6. **Home rail order:** a skip link to the rail, or the rail before the feed in
   DOM order (take the one that needs fewer changes). Browser check: Tab count.
7. **The shell's `scroll-padding-bottom`:** about 5 px short. Browser check.
8. **UI documentation (Director PR):** verify what `FrontendUI/components*.md`
   and `layout.md` already document of the Track D components; write what is
   missing; correct what the units above changed.
9. **The browser rows left NOT DONE:** axe and forced colours on the shell,
   rail, Recent Games, result cards, team tabs and chart; a full 82-game
   season chart; the picker at 320 and 768 px. Report each as DONE or NOT
   DONE with evidence; fix what fails as a unit.

## Mechanics learned the hard way

- Run `frontend-test` alone; beside other suites it times out.
- Stop dev servers only by the port you started.
- Signed-in checks: read the host Playwright notes; localhost only.
