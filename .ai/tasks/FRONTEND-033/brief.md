# FRONTEND-033: profile route loading feedback

Prose for the Manager. The contract is `task.json`.

## Current observation

The human reports that the URL sometimes changes to a profile while the old
page remains visible for several seconds, then the profile appears. The site
does not show a loading indicator during that interval. The cause and duration
have not yet been measured.

## Scope

Trace the route transition and profile data load on the current main branch.
Record cold and warm navigation timings before changing code. Add an accessible
loading state that appears while a requested profile is unavailable, replaces
stale prior content, and yields to the profile or existing error state. Report
the same timings after the change; do not claim a numeric latency target that
has not been chosen.

Keep profile API, permissions, cache freshness and content unchanged. Prefer the
existing Skeleton and route-loading patterns. Respect reduced motion and avoid
unexpected focus movement.
