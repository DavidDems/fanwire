# EVENTS-012: the records library

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why an aggregate table now

`0x02-events.md` says no aggregate table until a measured query is too slow.
This unit meets that rule. `player-career-points` already measures 210–274 ms on
the `db.t4g.micro` proxy because it reads every line, about 15,300 buffers. Season
and career records all have that shape, so a page of 24 would take about 6 s
uncached. The old summary shape, one holder per record on every miss, would be
over 100 statements. Two tables fix both: about 12,000 player-season rows and
about 59,000 team-game rows, rebuilt only when data loads.

## Why the catalog and the holders are separate

Search runs in the browser over the catalog: about 100 rows, one statement, no
per-keystroke request, and no public route that does work per search term. A page
then asks for at most 24 holders in one call. Sort `ids` on the client so the same
page hits the same edge entry.

**Trap:** the CDN's cache key today is `limit` and `offset` only. Without adding
`ids`, the first holders answer would be served for every later `ids` value.

## The featured sixteen, in order

1. `team-best-season`
2. `player-points-game`
3. `team-championships`
4. `player-career-points`
5. `player-threes-season`
6. `player-three-pct-season`
7. `player-ppg-season`
8. `team-worst-season`
9. `player-rebounds-game`
10. `player-assists-game`
11. `player-threes-game`
12. `team-longest-win-streak`
13. `player-career-triple-doubles`
14. `player-championships`
15. `team-most-points-game`
16. `team-largest-win`

## The library

Counting rules stay as `records.py` states them: single-game is regular season
plus playoffs, season is regular season in seasons with a champion, career is
regular season, and playoff records say so. Ids below are the contract; titles are
free. ★ marks an existing id.

**Player, single game (15):** `player-points-game`★, `player-rebounds-game`★,
`player-offensive-rebounds-game`, `player-defensive-rebounds-game`,
`player-assists-game`★, `player-steals-game`, `player-blocks-game`,
`player-threes-game`★, `player-three-pct-game`, `player-field-goals-game`,
`player-field-goal-pct-game`, `player-free-throws-game`,
`player-free-throw-pct-game`, `player-minutes-game`, `player-plus-minus-game`.

**Player, season (21):** totals `player-points-season`,
`player-rebounds-season`, `player-offensive-rebounds-season`,
`player-assists-season`, `player-steals-season`, `player-blocks-season`,
`player-minutes-season`, `player-triple-doubles-season`,
`player-double-doubles-season`; shooting `player-threes-season`,
`player-three-pct-season`, `player-field-goals-season`,
`player-field-goal-pct-season`, `player-free-throws-season`,
`player-free-throw-pct-season`; averages `player-ppg-season`, `player-rpg-season`,
`player-apg-season`, `player-spg-season`, `player-bpg-season`, `player-mpg-season`.

**Player, career (20):** totals `player-career-points`★,
`player-career-rebounds`, `player-career-assists`, `player-career-steals`,
`player-career-blocks`, `player-career-minutes`, `player-career-games`,
`player-career-triple-doubles`★, `player-career-double-doubles`; shooting
`player-career-threes`, `player-career-three-pct`, `player-career-field-goals`,
`player-career-field-goal-pct`, `player-career-free-throws`,
`player-career-free-throw-pct`; averages `player-career-ppg`, `player-career-rpg`,
`player-career-apg`, `player-career-spg`, `player-career-bpg`.

**Player, playoffs (14):** `player-championships`★; single game
`player-playoff-points-game`, `player-playoff-rebounds-game`,
`player-playoff-assists-game`, `player-playoff-threes-game`,
`player-playoff-steals-game`, `player-playoff-blocks-game`; career
`player-playoff-career-points`, `player-playoff-career-rebounds`,
`player-playoff-career-assists`, `player-playoff-career-threes`,
`player-playoff-career-steals`, `player-playoff-career-blocks`,
`player-playoff-career-games`.

**Team, franchise (5):** `team-championships`★, `team-finals-appearances`,
`team-playoff-appearances`, `team-most-wins-all-time`, `team-best-win-pct-all-time`.

**Team, season (18):** `team-best-season`★, `team-worst-season`★,
`team-most-wins-season`, `team-most-losses-season`, `team-longest-win-streak`,
`team-longest-losing-streak`, `team-highest-ppg-season`,
`team-lowest-opp-ppg-season`, `team-best-point-diff-season`,
`team-most-threes-season`, `team-three-pct-season`, `team-field-goal-pct-season`,
`team-free-throw-pct-season`, `team-apg-season`, `team-rpg-season`,
`team-spg-season`, `team-bpg-season`, `team-fewest-turnovers-season`.

**Team, single game (11):** `team-most-points-game`★, `team-fewest-points-game`,
`team-largest-win`★, `team-most-threes-game`, `team-most-assists-game`,
`team-most-rebounds-game`, `team-most-steals-game`, `team-most-blocks-game`,
`team-highest-combined-points-game`, `team-playoff-most-points-game`,
`team-playoff-largest-win`.

That is 104.

## Minimums

Attempts, stated in the rule text, and deliberately flat across seasons: a
short season simply qualifies fewer players.

| Scope | FG | 3PT | FT | Averages |
|---|---|---|---|---|
| Game | 15 | 8 | 10 | — |
| Season | 500 | 200 | 150 | 58 games |
| Career | 3,000 | 1,000 | 1,000 | 400 games |

Team shooting records have no minimum, since every team qualifies.

## Shape notes

- A player-season row with a mid-season trade sums across teams, like the `TOT`
  row the player page already shows, and `team_id` is the team of that player's
  last played game that season.
- Streaks are gaps-and-islands over `team_game_totals` ordered by date within a
  season. The streak is the `value`, and the entry carries the season.
- A record is still one more registry entry. Use factories for the families, so
  the read path stays free of branches (`records.py` module docstring).
- The per-process `@cache` on holder statements stays. Build them on first use.

## Deploy

This adds a migration. Code that reads the new tables fails until it runs, so the
human runs the `Migration` function straight after approving the deploy
(`build-deployment.md`, "Run migrations"). Put that step in the PR body. Records
routes alone are affected during the gap.

## Not in this unit

The grid, search box and featured page are `FRONTEND-030`.
