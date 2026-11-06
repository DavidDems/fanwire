# FRONTEND-037: compact game results and season-aware game views

Prose for the Manager. The contract is `task.json`.

## Why this task exists

The current team season view spends substantial space on dates and a point
margin chart/table. Game rows include full city-and-team names and are harder to
scan than a scoreboard. The compose stats picker repeats a separate game
summary, and the game page spells out a final result instead of letting the
reader switch directly between the result and each team's player list.

The human's examples (2026-11-05) establish a dense scoreboard treatment:
short team names, compact result labels, team records in parentheses on Recent
Games, and less visual weight for the losing side there. The team Stats page
keeps a separate win/loss contrast, and the game detail's contrast marks only
the selected team tab.

## Dependency

`EVENTS-013` adds the Recent Games section in the UI track. Its implementation
must merge to `main` before this task starts. Inspect its merged component and
use that component where appropriate; do not assume its final paths or props
before the merge. This task's `allowed_paths` includes the existing feature
trees that may contain that section, but excludes its own spec and all repo
governance files.

## Decided behavior

- Stats team games are cards in a responsive, newest-first, two-column grid on
  wide screens. The selected team is always first in the matchup, regardless
  of home/away status. The date is removed from this list; the game link itself
  leads to the date and full detail.
- The team header keeps overall, home and away records. The chart shows the
  team's cumulative record through the season, with month-only labels. There is
  no separate point-margin board and no repeated overall record in the chart.
- Recent Games cards show short team names, score and overall records. Their
  losing side is muted but remains readable. Team season cards instead use W/L
  and a light/dark win/loss contrast.
- The game detail heading links each team to that team's season page. The season
  selection travels with the game navigation and stays fixed when switching
  teams.
- The game detail has team tabs. The winning team starts selected and is on the
  left; its selected appearance is the only win/loss-related lighting cue.
  Selecting a team shows that team's player list and result context. A tie or
  unfinished result starts on the home team.
  A `?line=` address (a post preview's marked player line) starts on that
  line's team instead, so the marked row is not hidden behind the other tab
  (Director amendment, 2026-11-06).
- The compose picker reuses the same result-card design and makes the matchup
  row the game link. Preserve the picker's existing radio/select behavior for
  attaching a final score or a player line.

## Traps

- Preserve chronological game order for cumulative values even though the
  visible result cards are newest first. A bar after game N must represent the
  record after that game, including playoff games only if the existing season
  dataset includes them.
- Keep visual order and accessible reading order aligned. CSS grid must not
  reorder DOM items; the newest game remains first for keyboard and screen
  reader users.
- Use `TeamSeasonGameOut`'s selected-team scores and opponent data, not inferred
  home/away wording, when building the matchup/result text.
- The game is still reached by the same canonical game route. Carry season
  context separately (query or router state) and make team links work after a
  copied/direct game URL as well.
- Team tabs must be real accessible tabs with correct roles, relationships,
  keyboard behavior and focus; do not imply a tab interaction with decorative
  buttons.
- A cumulative record chart needs a non-visual equivalent and must handle zero
  or one game without fake points or misleading axes.
- Add the bundle budget alongside the failing tests, following the existing
  `FRONTEND-0xx.ts` declarations. The implementation role cannot edit the test
  commit's tests/budget file.
- Read current frontend UI decisions and module behavior before changing
  styling. Use tokens and existing icon/typography patterns; no team-color
  winner/loser palette.

## Not in this task

- Changes to API payloads, database schemas, game identity or canonical routes.
- New Recent Games functionality beyond applying the compact card contract to
  the section introduced by PR #329.
- Removing or hiding any box-score, line-score or player statistics.
- New dependencies, external imagery or changes to global design tokens.
