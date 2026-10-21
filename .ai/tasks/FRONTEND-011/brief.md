# FRONTEND-011 — modal navigation as one flow

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 2 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9: "Back steps through modal details. X
and Escape close the modal and return to the originating page and its scroll
position"). Today `ThreadModal`'s `close()` is `navigate(-1)`: from a nested
thread (a reply's timestamp opens that reply's thread in the same modal) it
goes back one thread, not to the page the reader came from. Runs on
react-router 7 (`FRONTEND-016`, merged).

## The design

- **Keep the background-location recipe** (`routes/BackgroundRoutes.tsx`):
  the origin page stays mounted under the modal, which is what keeps its
  DOM, data, loaded pages and scroll. This unit changes how the flow is
  entered, stepped and left, not how the page underneath is kept.
- **A flow is `{ background, depth }` in history state**, owned by one
  module (for example `src/routes/modal-flow.ts`): build the state for
  opening a first detail from a page (`depth` 1, `background` = this page)
  and for opening a detail from inside the flow (`depth` + 1, the same
  `background`), and read the current flow. `PostNode`'s `useThreadState`
  and `ThreadModal` move onto it. `FRONTEND-014` adds game and player
  details to the same module without changing its shape.
- **Leaving.** Close and Escape go back `depth` entries (`navigate(-depth)`)
  when there is a real background: that lands on the origin's own history
  entry, so its search string and the page's state are the ones the reader
  left. With no background (a direct load or a reload), go back `depth - 1`
  entries to the flow's first entry, then replace it with `/`: never step
  past the app's own first entry into an unrelated one.
- **Back.** An in-modal Back control (an icon button, 44 px, accessible name
  "Back") in the dialog header when `depth > 1`; it is `navigate(-1)`.
  `Dialog` gains an optional slot or `onBack` prop for it; keep its existing
  contract otherwise and record the change in `components.md`.
- **Focus.** `Dialog` already returns focus to its opener when it closes,
  provided it stays mounted for the whole flow. Make sure switching details
  re-renders the same dialog rather than re-mounting it (a `key` on the route
  element, or the Dialog lifted above the detail), so the opener it
  remembered is still the first one.
- **One surface.** Details switch inside the one `<dialog>`; never a second.

## Traps

- **`createMemoryRouter` tests** (`src/test/app-route.tsx`, `renderAppAt`)
  are where history behaviour is observable: `router.state.location` and
  `router.state.historyAction`. A memory router started with
  `initialEntries: ["/unrelated", "/posts/5"], initialIndex: 1` is how "never
  reach an unrelated entry" is tested.
- **Scroll in jsdom** is `window.scrollY`/`scrollTo`, which jsdom stubs:
  `src/setupTests.ts` shows what exists. Test that the page underneath is
  never re-mounted and its scroll is not reset, and leave real scroll to the
  browser row.
- **`POSTS-004` runs in parallel** and changes `ThreadModal.tsx` to render a
  deleted root (`root` null) as a "Post deleted" line. Keep this unit's
  change there to navigation; the second of the two PRs resolves the
  conflict.
- Run prettier on named files only. A glob over a feature folder also
  matches the committed tests.

## Not in this task

Game and player details in the modal (`FRONTEND-014`), the post menu
(`FRONTEND-012`), and any backend change.
