# EVENTS-017: season leader boards and an in-season qualifier

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-07)

1. Records > Seasonal should have more records: at least points, assists,
   rebounds, blocks, steals, FGM, 3PT FGM, FG%, 3PT FG%, FGA, 3PT FGA, each
   with its top three and a "view all" for the top ten (FRONTEND-043 draws it).
2. The current season shows no leaders until players reach 65 games (the NBA's
   award rule). Show standings as the season progresses. Once the season has a
   champion, filter by the 65-game minimum.

## Where it is

`GET /events/seasons/{season}/leaders?stat=` serves one stat a read (six stats
exist, no shooting totals or percentages). `_qualifier` applies 65 games from
2023-24 and, before that, 70 % of the most team games, rounded up. Before that
date the rule already scales with games played; from 2023-24 it does not, so
2026-27 is empty.

## Decided (Director, 2026-11-07)

- **In progress means on pace.** No minimum at all would put a one-game player
  first. `ceil(65 × T / 82)` with T the most team games so far is the NBA's own
  in-season practice and equals 65 once the regular season is over. A champion
  marks the season complete, per the human.
- **Percentages need a made minimum** (else 1 of 1 is 100 %): the NBA's 300
  field goals and 82 threes, prorated the same way while in progress.
- **One route for all eleven boards**, regular season only (what the tab shows).
  One GROUP BY sums every column per player and the boards are ranked from it,
  so eleven boards cost one read, not eleven.
- The old per-stat route stays (and gets the new rule) so nothing else breaks;
  FRONTEND-043 stops reading it.
- Counts are per-game averages, matching today's boards and the NBA's leader
  pages. Order is the human's list.
