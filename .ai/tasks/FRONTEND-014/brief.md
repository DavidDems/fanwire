# FRONTEND-014 — the three preview components, and details in the modal flow

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 5 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9, "Frontend"). `POSTS-006` puts a
typed `data_link_preview` on every `PostView`. This unit renders it, and it
finishes FRONTEND-011's navigation design: one modal surface switching
between thread, game and player details.

**Needs `POSTS-006` merged**, for the regenerated `schema.d.ts`. This unit
doesn't regenerate types. It only reads them.

## The design

- **Three components, one folder.** Something like
  `features/feed/previews/{GamePreview,PlayerGamePreview,PlayerCareerPreview}.tsx`,
  each typed from the generated union member. `PostNode` picks one by
  `type`. The preview's detail link is its own element: the card's thread
  navigation is its timestamp and reply control (FRONTEND-010/011), and it
  must not be nested inside, or swallowed by, the preview's link.
- **Honest gaps** (§9: "source gaps stay visible and are never invented"):
  - a DNP line shows its reason;
  - a null figure is an em dash;
  - a link with no preview is "Stats unavailable".
- **Details in the flow.** `routes/modal-flow.tsx` already says a new kind of
  detail is "a new overlay route, not a change here". Add `games/:gameId`
  and `players/:playerId` to `routes.tsx`'s `overlays` list, rendering the
  existing page bodies inside the thread modal's dialog surface:
  - Factor out the body if `GamePage`/`PlayerPage` own their `<h1>` layout.
  - Keep the pages list unchanged, so a direct load is still a full page.
  - Exactly one dialog: switching from a thread to a game swaps the
    content, never stacks a second dialog. If `ThreadModal` owns the
    dialog today, lift the shell so all three details share it.
- **`?line=<line_id>`** is read by the game detail. The row gets a highlight
  that isn't colour alone (a left rule or weight plus a `--color-accent` tint,
  from `FrontendUI/tokens.md`) and `aria-current="true"`, and is scrolled
  into view once its data has loaded.

## Sibling units

- `FRONTEND-017` edits `features/games/**` and `features/players/**` too.
- `FRONTEND-015` (stage 6) builds on these components.
- `FRONTEND-012` (lifecycle UI) edits `PostNode`, if it's open at the same
  time.

Test any open combination on a merged preview.

## Traps

- **`modal-flow.tsx`'s state shape must not change.** Its tests pin it, and
  FRONTEND-011's acceptance said a game or player detail could join
  "without changing it". Use `useDetailLinkState` for every new link.
- **Focus restore** goes to the opener: the preview link, or the box-score
  name a nested detail was opened from.
- **The feed isolation tests**: `features/feed` may not import
  `features/games` or `features/players`. The preview components link by
  address. The overlay routes import the pages, and they live under
  `routes/`, which may.
- **`prettier --write` on named files only.**

## Not in this task

The complete-card reveal, preloading and skeletons (`FRONTEND-015`), the
composer, and any backend change.
