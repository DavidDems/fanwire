# EVENTS-007 — seasons: standings, champion, leaders, a team's season

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

`business-rules.md` "Events" asks for champions, team records during the
regular season, and stats leaders. The human wants a Stats page whose Seasons
tab shows, for a chosen season, the champion, the standings by conference,
the stat leaders and the season's games, with a small search bar that narrows
it to one team (the human's decision, 2026-10-14; `FRONTEND-009`). This unit
is the API behind that tab. `Prompts/06-nba-data.md` "`EVENTS-007`" is the
plan this spec makes precise.

Run it after `EVENTS-006` has merged. Both add routes to
`app/events/routes.py` and schemas to `schemas.py`, and both regenerate
`openapi.json` and `schema.d.ts`.

## Things to get right

- **Regular season only, for records.** `game_type = 'regular'` already
  includes NBA Cup group and knockout games (decision 5). `cup-final`,
  `play-in` and `playoffs` are excluded from standings.
- **Games behind**, within a conference:
  `((leader_w - w) + (l - leader_l)) / 2`, so it can be a half game.
- **No NBA tie-breakers.** They are a page of rules (head-to-head, division
  leader, conference record and more). Order by win percentage, then wins,
  then name, and say so in a `tie_break` field. It is honest and cheap. Real
  tie-breakers are a later decision for the human.
- **The champion is computed, not stored.** Among the season's `playoffs`
  games whose `label` is `NBA Finals`, the team that won four. Before the
  Finals end (a season in progress), the response holds nulls. The dataset's
  label spelling is "NBA Finals" (`0x02-events.md` "Game"). Check it against
  the fixture and the real data before relying on it.
- **Leaders' qualifier.** From 2023-24 the NBA requires 65 games for
  awards and leaderboards. Before that it used minimums per stat, which
  are not worth reproducing: 70 % of the most games any team played is the
  proxy the human accepted (Prompts/06). Round it up. Name the rule in the
  response (e.g. `"65 games (NBA rule from 2023-24)"`, or
  `"70% of 82 team games: 58"`) so the UI can show it. The playoffs have no
  minimum.
- **Threes** means three-pointers made per game.
- **Seasons list** replaces `distinct_seasons` for new callers.
  `search/` keeps using `distinct_seasons` unchanged.
- **422 or 404.** Make it consistent and say it in each route's docstring
  (it reaches `openapi.json`): a malformed value is a 422; a well-formed
  season with no games, or an unknown team, is a 404.
- **Tests on the synthetic fixture** (`tests/fixtures/nba_data/`). It covers
  2024-25 and 2025-26, a Finals game and a cup final. Extend the fixture only
  if a criterion cannot otherwise be exercised; a Finals series won 4-x needs
  four Finals games. The expected numbers come from the fixture files read
  independently in the test, never from the code under test.
- **Measure** one standings and one leaders query on a full load in a
  throwaway Postgres (Prompts/06 "Mechanics": `docker run` on port 5433), and
  record the times in `0x02-events.md`.

## Not in this task

Players (`EVENTS-006`), any frontend (`FRONTEND-009`), the NBA's tie-break
rules, and awards.
