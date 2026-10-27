# FRONTEND-022: game storytelling

## Outcome

Make a game result feel like one readable story from the feed preview through
the full game page. The preview currently names both teams and scores but has
no period breakdown. `GamePage` already has period scores and box scores, but
the narrow table can show only its first columns until the reader scrolls it.
The local browser pass showed this at 360 px on `/games/502`.

## Scope and implementation notes

- Extend `GameFinalPreview` in `events/` with the stored line-score arrays and
  carry them through `feed/views.py`'s existing post preview response model.
  Keep the existing
  batched query count and return null when that game has no line scores.
- Regenerate both committed OpenAPI artifacts from their sources. Do not hand
  edit either generated file.
- In the test-only commit, update the typed `frontend/src/test/previews.ts`
  game-final factory to return `null` for both new fields by default. This
  keeps existing preview fixtures aligned with the generated API contract;
  the implementation role must not edit this test kit file.
- The test-only commit must also declare this unit's measured lazy bundle
  changes in `frontend/src/test/bundle-budgets/FRONTEND-022.ts`. The bundle
  gate requires each changed async output and entry allowance to be declared;
  keep the unit within the measured limits in this task's acceptance criteria.
- Give the game preview and detail a shared scoreboard hierarchy. Show regular
  periods and overtime periods from the source data; totals and winner text
  must agree with the canonical final score.
- Draw the matchup treatment as original inline SVG/code from generic court
  geometry. Text remains the source of truth. Use the existing tokens and
  avoid team identity graphics or team-color comparisons.
- Make the box-score scroll region discoverable and keyboard operable on
  narrow screens. Keep all statistics available; do not silently hide columns.
- No dependencies, remote fonts, images, or new raster files.

## Branch and merge order

This unit is independent. Create `agent/FRONTEND-022` from `main` only after
this Director PR reaches `main`; it must not be based on another visual task
branch. Suggested review order is FRONTEND-022, FRONTEND-023,
FRONTEND-024, then USERS-004, but none depends on another and each may merge
directly to `main` after its own checks.

## Tests and browser evidence

The test commit covers backend preview serialization and frontend card/detail
rendering, overtime and missing periods, accessible semantics, and no extra
query. Then measure the bundle and include the before/after table. Browser rows
are light/dark at 360 and 1280, a keyboard scroll of the box score, and actual
versus synthetic data clearly identified. Run `npm test`, typecheck, lint,
build, and the container frontend suite per the repository gates.

## Module note

The event preview interface changes, so the context maintainer updates
`0x02-events.md`; exposing the new fields on feed preview responses also
changes the feed contract, so update `0x06-feed.md`. The frontend game and
preview behavior belongs in `0x08-frontend.md`. The workers receive neither
GeneralContext nor FrontendUI write access.
