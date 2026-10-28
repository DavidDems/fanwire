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

This task's implementation has no runtime dependency on the other visual
units, but the human requested a stacked review sequence. Create
`agent/FRONTEND-024` from the `agent/FRONTEND-023` PR head after its full CI
gate is green. `USERS-004` must then branch from the `agent/FRONTEND-024` PR
head after its full CI gate is green. The required merge order is #257,
FRONTEND-023, FRONTEND-024, USERS-004. Each PR body must name this order. No
task may be merged before its parent reaches `main`.

## Test, browser, and asset contract

Commit tests alone first, then implementation. Test each of the four states,
its text/role, decorative SVG semantics, token-only styles and zero external
requests. Browser-check each state at 360/1280 in both themes and inspect the
screenshots. Include the bundle table and run all frontend gates. No raster or
stock asset is authorized. If a need for raster emerges, raise a separate
Director proposal including exact purpose, provenance, dimensions/variants,
compression, storage, loading and alt-text treatment before proceeding.
