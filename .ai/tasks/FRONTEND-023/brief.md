# FRONTEND-023: player and season insight

## Outcome

Give `/players/:playerId` and the team-season level under `/stats/seasons` a
quick visual comparison while keeping the full tables as the authoritative
text and data view. The current player page is all wide tables, and the local
360 px view shows only a slice of several columns. The Players tab is a
search-first screen; it should remain so.

## Chart contract

- Player chart: points in the 10 most recent completed games, oldest to newest;
  x is the short local game date, y is integer points. Zero baseline; ticks at
  0, 5, 10, and so on through the first multiple of 5 above the maximum.
- Team chart: point differential (team score minus opponent score) for every
  loaded game in the selected season, oldest to newest; x is game date, y is a
  symmetric range around zero with 5-point ticks. Label each win/loss in text.
- Both charts retain a semantic table with exactly the plotted points, a
  caption that names metric and scope, and no information conveyed only by
  color or hover. Existing game-log and season tables remain complete.
- Fewer than two points means no line: keep the data table and explain why the
  chart is not drawn. Loading, API error, and empty data stay distinct.
- On changing a settled filter, interpolate plotted positions for at most
  180 ms to make the new data relationship legible; no entrance animation and
  no animation when reduced motion is requested.

## Scope, branch, and merge order

This is frontend-only and independent of the other visual units. Create
`agent/FRONTEND-023` from `main` after the Director PR lands. Do not base it on
FRONTEND-022 or any other unmerged branch. Suggested review order is 022, 023,
024, USERS-004; there are no merge dependencies.

## Test and performance contract

Test the plotted sample/order, exact ticks and values, table equivalence,
empty and one-point behavior, delayed/error response, accessible names, filter
request count, and reduced motion. Add only to the designated lazy bundle
budget entry in the test commit. No dependencies, network assets, canvas-only
data, or pointer-only tooltip. The PR includes bundle measurements, a
before/after table, and browser rows in both themes at 360 and 1280.

The current local backend returned one season (2023–24), so a multi-season
comparison cannot be claimed from this audit. Use another existing test
fixture or a browser response override for wider season coverage and label it
synthetic. Update the frontend module page only if the documented UI contract
changed.
