# FRONTEND-020: the compose modal

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 2 of `wiki/GeneralContext/Prompts/20-stats-navigation-and-compose-modal.md`.
Compose is a full page today, reached from a nav item. The human wants to
post from anywhere: a floating **+** opens compose over the page the reader
is on. The human also wants the attach flow to stop asking for a second
press:
- **today:** choose a file, wait while it shows "Preparing this image", then
  press Attach;
- **after this unit:** choose a file, wait on the image itself, and it is
  attached.

## Decided by the human

**2026-10-23, in the request and by `AskUserQuestion`:**
- **Compose is `/compose` over the current page**, like the thread modal.
  - Back or Escape closes it.
  - A direct load or a refresh opens it over the feed.
  - `/compose?link=…` keeps working.
- **The + replaces the Compose nav item**, in the header and in the phone's
  bottom bar. Only a signed-in active member sees it.
- **The image check:**
  - An overlay with a loading signal covers the image while it is checked.
  - On `processed` the image is attached with no second press.
  - On a refusal, or after 30 s, the image is removed, and a red line with
    an ✕ reads exactly "The image you attached is too large or cannot be
    accepted".

**2026-10-24, by `AskUserQuestion`:**
- **The reply box takes the same image flow.** The thread's `InlineComposer`
  uses the same `MediaWidget`, so it changes once, for both. Only the reply
  box's attach control changes. The thread's cards and layout don't.
- **A published post closes the modal.** The feed's data is refreshed, so on
  the feed the new post shows at the top.
- **The 30 s starts when the upload finishes**, not when the file is chosen.
  The skeptic's arithmetic: a 5 MB image on a 1.5 Mbit/s phone uplink takes
  28 s just to upload. The tile shows from the choice onward.

## Decided by the Director

- **The bar-chart button shows today's `AttachmentPicker` in place** until
  FRONTEND-021 replaces it with the picker modal. A link that is already
  attached always shows its summary.
- **Post waits for the image check.** A post sent mid-check would silently
  drop the image the reader is watching.
- **The loading signal is static.** `accessibility.md` A8 and UI-010's
  "no keyframes" scan both forbid animation. So the signal is a muted
  overlay with the words "Checking the image…".
- **The tile shows the file name, not the picture.** `MediaWidget` never
  uses `URL.createObjectURL`, by product decision: the served thumbnail,
  stripped and resized, is the first image anyone sees. The tile has a fixed
  size, so the swap to the thumbnail moves nothing.
- **The poll slows to once a second.** That's at most 31 polls in 30 s,
  instead of 100 at today's 300 ms. The skeptic kept it: each poll is a
  primary-key lookup, about 31 ms of database time per image. A 2 s interval
  would add half a second of average wait, and a backoff isn't earned.
- **Quick posts stay**, under the form inside the modal.

## How the overlay fits the modal flow (a sketch, not a contract)

`modal-flow.tsx` already keeps a page under the detail modal, with
`{ background, depth }` in history state. Compose isn't a detail, so it isn't
added to `DetailModal`. It's its own overlay route, using the same recipe.
Its state is read in `modal-flow.tsx` too, which stays the one reader of
history state (the skeptic's argument: it already has `flowOf` and
`isLocation`).
- **Its entry carries** `{ background?, composeOpenedInApp: true }`. A link
  on a page sets `background` to that page. A link inside the detail modal
  sets it to the flow's background, if there is one. So `BackgroundRoutes`
  renders that page underneath, and the detail modal unmounts.
- **Close** steps back one entry when the entry was opened by an in-app link.
  That returns to the page, or to the detail, whose own entry still carries
  its flow, so the detail modal comes back as it was. A direct load has no
  such flag, so Close replaces the entry with `/`.
- **`BackgroundRoutes` must match `/compose` as an overlay always,** and
  render the pages against `background ?? FEED`. A thread works the same way
  today.
- **The guard's redirects happen before any dialog renders.** Its other
  states (loading, deactivated, unavailable) render inside the dialog. Under
  an overlay, `RequireAuth` around the composer would otherwise render them
  below the page (the skeptic's C5).
- **The + uses `FloatingButton`'s `onClick` form** and calls `navigate` with
  the state. Its link form takes no state, and `components/` is out of
  bounds.

## The skeptic

**First pass, 2026-10-24: proceed with changes, all landed in this spec.**
The skeptic built a bare prototype and measured the entry at +807 B gzip:
+460 for the overlay and the +, +360 for the new image flow. 0.5 kB couldn't
be met. Its changes:
- the per-unit entry cap is 1 kB, and this unit may grow the entry by at most
  1,000 B gzip, 3,500 B raw and 300 B CSS;
- the compose ceilings are 5.6 kB JS and 0.7 kB CSS;
- the history state lives in `modal-flow.tsx`;
- the + uses `onClick`, and focus has a fallback when the opener is gone;
- the guard's in-place states render inside the dialog;
- a final poll at the bound, and none after it;
- the publish request count;
- 40 cards on the feed for the long-task row;
- CLS is measured on Fast 4G, plus the refusal swap.

Before the PR is handed over, it lists every Baseline line as met, missed or
unmeasured.

The risks it carries into this unit (Prompt 20 Progress):
- **R1 and R13:** the entry's raw ceiling is 480 kB. After this unit the entry
  is about 472 kB raw and 149.8 kB gzip, and FRONTEND-019 and -021 must add
  nothing to it (R19).
- **R4 and R14:** the long task, as a median of five alternating runs with a
  250 ms worst-run cap.
- **R12:** the bundle-budget file below.
- **R16:** the pipeline's production latency (GuardDuty → EventBridge → SQS →
  Lambda) has never been timed. A p95 over about 20 s would refuse good
  images. Time it on the live stack after deploy, as a row in the PR's
  follow-up.
- **R17:** a hidden tab pauses the poll, so a final poll at the bound stops a
  processed image from being refused.
- **The + over a card's "More options" at 360:** a browser row.

## Traps

- **The bundle-budget test reads per-unit files.**
  - This unit adds `src/test/bundle-budgets/FRONTEND-020.ts` in its **test
    commit**. It declares `entryJsGzipGrowth` (at most 1,000) and every lazy
    output it changes or adds, JS and CSS, with a gzip ceiling. If it
    imports `VisuallyHidden`, that chunk folds into another and is declared
    removed.
  - This unit owns `routes/lazy-routes.test.ts` in this stage.
  - FRONTEND-018 runs in parallel and declares the Stats chunks. The test
    refuses a chunk two units both declare, so check the merged preview
    before the second PR merges.
- **The page underneath must not re-mount.** `BackgroundRoutes` renders the
  pages at one position against an explicit location, and that is the whole
  trick (its comment). Rendering compose by swapping that position re-mounts
  the page and loses its scroll. `modal-flow.test.tsx` has the pattern for
  pinning it.
- **One dialog at a time.** "Post about this" inside a game detail must not
  open a second `<dialog>` over `DetailModal`. The new entry's background is
  the flow's, so the detail modal unmounts.
- **A guarded overlay.** `RequireAuth` returns a `<Navigate>` for a guest.
  It must sit inside the overlay element, so the redirect replaces the entry
  and no dialog flashes. `from` must be the `/compose` address, so sign-in
  returns to it.
- **The feed's key is spelled, not imported.** Compose may not import
  `features/feed` (the isolation tests). Invalidate the `["feed"]` prefix, as
  `features/profile` spells the teams key.
- **Local uploads never finish.** Local dev has no GuardDuty, so an upload
  stays `scanning` (`MediaWidget`'s own comment, MEDIA-002). The 30 s path is
  what local dev shows. To see the processed path in the browser, set the
  row to `processed` with a thumbnail key in the dev database while the tile
  waits. The Director does that row.
- **`Post` disabled mid-check also applies to the reply box.** Its tests
  pin today's enabled state with a pending image, if any do, and change in
  the test commit.
- **`prettier --write` on named files only.**

## Not in this task

- The stats picker modal, and `AttachmentPicker`'s replacement (FRONTEND-021).
- Any change to the post cards, the thread's layout, the shell's look beyond
  the nav item and `main`'s bottom padding, or `components/`.
- Any new dependency.
