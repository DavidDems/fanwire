# FRONTEND-016 — react-router v6 → v7

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

`TODO/02-backlog.md` "react-router v6 → v7": 6.30.6 carries two moderate
advisories fixed only on the 7 line. `Prompts/18`'s `FRONTEND-011` rewrites
modal routing, and **the human decided (2026-10-20) that this migration runs
first, as its own unit**, so the navigation work is written once, against v7.

## Why 7 and not 8

react-router 8 exists (8.5.0, 2026-10-19), but it needs React 19.2.7 and
Node 22.22. That is a React major as well, a different unit. 7.18.4
(2026-09-15) supports React 18 and Node 20, and has the fixes.

## The design

- **A version bump with no behaviour change.** v7 is v6 with every
  `future.v7_*` flag on. This app uses `createBrowserRouter` +
  `RouterProvider` (`src/App.tsx`) with no loaders, actions or fetchers, so
  the flags that matter are `v7_startTransition` (navigation state updates
  are wrapped in `startTransition`) and `v7_relativeSplatPath` (relative
  links inside a splat route). Read the v7 upgrade guide's section for each.
- **Keep the `react-router-dom` package name.** In v7 it re-exports
  `react-router`. Renaming ~60 imports is churn this unit doesn't need, and
  the test files that import it can't change in the implementation commit.
- **The red test is the version test.** It fails on 6.30.6 and passes on
  7.x. The existing suite is the safety net for "no behaviour change".

## Traps

- **Existing tests may break for v7 reasons**, most likely
  `startTransition` timing (a navigation's render lands a tick later) or a
  `MemoryRouter` that relied on v6 relative-path resolution.
  `allow_test_edits_during_impl` is false: the implementation agent reports
  each such test rather than editing it, and the Director reproduces it and
  fixes it as its own commit, named in the PR (`director-sessions.md` "Take
  objections seriously"). A fix may change waiting or setup, never an
  expected value.
- `npm install` regenerates the lockfile. Check `git diff --stat
  package-lock.json` for unrelated upgrades: only react-router,
  react-router-dom and their own dependencies should move.
- `BackgroundRoutes.tsx` renders a `<Routes location={background}>`. Check it
  by hand in the browser as well as in the tests.

## Afterwards (Director, not this unit)

The backlog row is closed in the stage's Director PR. `npm-audit` gates
`frontend/` at `high` partly because of these two advisories. Lowering the
gate to `moderate` is a `.github/` change, so it goes in a Director PR once
this merges and `npm audit` is clean at moderate.

## Not in this task

React 19, react-router 8, the `react-router` package rename, data routers'
loaders and actions, and any navigation behaviour change (`FRONTEND-011`).
