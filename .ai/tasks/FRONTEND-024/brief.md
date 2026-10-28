# FRONTEND-024: Fanwire quiet-state artwork

## Outcome

Add a small original visual signature to empty/quiet states where the reader
currently sees mostly text: the empty feed, a profile with no posts, a player
search with no matches, and record groups with no qualifying result. The local
feed had no member-uploaded images but did contain text and seeded game posts;
do not turn ordinary text-only posts into decorated cards. On a public profile
with an empty post list, add the concise message “No posts yet.” before the
motif; the audit showed the profile summary followed by a large empty region.

## Art direction and accessibility

Use one reusable court/scoreboard motif built as original inline SVG/CSS from
simple geometry. Keep it neutral and inside the existing Fanwire palette. No
logos, marks, jerseys, team colors, player likenesses/photos, gradients,
external image/font requests, or third-party assets. Store the source beside
the shared UI component, not as a generated image. Record authorship in the PR.

The SVG is decorative (`aria-hidden`, no focusable children). Existing state
headings and explanatory copy remain accessible and continue to distinguish
empty, loading, error and no-results. Artwork adds no motion and never replaces
an action or accessible text equivalent.

## Scope and merge order

This task is independent and can be cut from `main` after the Director PR
lands. Do not base `agent/FRONTEND-024` on another task branch. Suggested
review sequence is FRONTEND-022, FRONTEND-023, FRONTEND-024, USERS-004; none
depends on the others.

## Test, browser, and asset contract

The allowed paths include `frontend/src/components/stats-nav/RecordsLevel.tsx`
and `frontend/src/components/stats-nav/StatsNav.module.css` because that
component owns the record cards and their empty-holder rows.

Commit tests alone first, then implementation. Test each of the four states,
its text/role, decorative SVG semantics, token-only styles and zero external
requests. Browser-check each state at 360/1280 in both themes and inspect the
screenshots. Include the bundle table and run all frontend gates. No raster or
stock asset is authorized. If a need for raster emerges, raise a separate
Director proposal including exact purpose, provenance, dimensions/variants,
compression, storage, loading and alt-text treatment before proceeding.
