# FRONTEND-015 — complete-card reveal, and the bundle split by route

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 6 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9, "Complete-card reveal"): post cards
should appear complete in one go, never author first, then text, then a
late image pushing everything down.

**Cut this branch after `FRONTEND-014` merges.** That unit's preview
components are part of what a card reveals.

## Decided by the human (2026-10-22, by `AskUserQuestion`)

- **A fixed 4:3 frame for every post image**, frontend only.
  `MediaItemView` carries no width or height, so a true aspect ratio would
  need a MEDIA unit first. The frame is `object-fit: contain`, letterboxed in
  a surface token: a tall or wide image shows smaller inside it, and nothing
  shifts.
- **The bundle split goes in this unit.** Vite warns that the one chunk is
  513 kB. This unit is about load behaviour, so the route-level split belongs
  here.

## Settled in this spec (the brief leaves them to the Director)

- **Readiness**: every image on the card has loaded and `decode()` has
  settled. The author, text and preview are already in the response
  (POSTS-006), so images are the only thing a card waits for.
- **Bound**: 4000 ms per card, one named constant. A failed, missing or slow
  image becomes "Image unavailable" inside its frame. It's never dropped,
  because a dropped image is a layout shift.
  - This replaces `PostMedia`'s current behaviour of rendering nothing on
    error, which is exactly that shift.
- **Window**: an `IntersectionObserver` with one viewport height of
  `rootMargin` below.
- **Refetch**: a revealed card stays revealed. Key the readiness by post id
  plus its image keys, so a like (which changes counts, not images) never
  re-prepares a card.

## The design

- A `useCardReady(post, inWindow)` hook in `features/feed/`, and a wrapper
  (e.g. `PreparedPostNode`) that renders `Skeleton` until it is ready, then
  `PostNode`. Feed, search, profile and thread all use the wrapper, so no list
  re-implements the rule. `features/search`, `profile` and `thread` already
  import `PostNode` from feed (their isolation tests allow it).
- Preload with `new Image()` plus `decode()`, then render the real `<img>`
  with the same URL, so it paints from cache. Don't hide a mounted `<img>`
  with CSS until it loads: a hidden image still shifts layout when it's
  revealed in a list.
- **Lazy routes**: `React.lazy` with named-export adapters
  (`lazy(() => import(...).then((m) => ({ default: m.GamePage })))`) in
  `routes.tsx`, one `Suspense` around the page outlet in `BackgroundRoutes`,
  and one inside `DetailModal` for the game and player details. The feed and
  the thread stay eager: they are the first paint and the modal's own
  detail.

## Sibling units

`FRONTEND-012` (lifecycle UI) also edits `PostNode` and the feed's caches. If
both are open, test the combination on a merged preview.

## Traps

- **Lazy routes change the timing of every route test.** A test that
  expects a page synchronously after `renderAppAt` must `findBy…`. **The test
  step updates those existing tests in the test commit**:
  `allow_test_edits_during_impl` is false, and the implementation can't touch
  them.
- **jsdom has no `IntersectionObserver`, image loading or `decode()`.** Stub
  them in `src/test/` helpers. The stub must let a test resolve, reject or
  stall each image.
- **`styles/base.test.ts` forbids a keyframes at-rule anywhere**, test files
  included. Build that needle from fragments if a test names it.
- **The feed isolation tests**: `features/feed` may not import games,
  players or profile.
- **`prettier --write` on named files only.**

## Not in this task

Image dimensions from the backend, image formats or thumbnails
(`s3_key_thumbnail` stays unused), virtualised lists, and any backend
change.
