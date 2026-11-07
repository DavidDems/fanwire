# EVENTS-015: Recent Games, newest day first

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-07)

Keep ranking Recent Games by standings (the lower the two teams' rank sum, the
higher the game), but always show newer games before older ones. Priority:
date, then standings sum. If 8 games were played on the latest day, show that
day's top 5. If only 3 were played, show all three in rank order, then the
best 2 from the day before.

## Where it is

`service.recent_games` (EVENTS-013) takes every completed game on the newest
**three** dates and sorts them all by rank sum, so a strong matchup from two
days ago can outrank yesterday's games.

## Decided (Director, 2026-11-07)

- "Date" is the calendar date of `games.date` as stored (naive US Eastern),
  the same `func.date` expression the `ix_games_completed_date` index serves.
- The date window becomes the newest `limit` dates. Each date has at least one
  game, so `limit` dates always fill the list; the old fixed three could not
  when the latest days were thin (for example around the All-Star break).
- The response shape does not change, so the frontend needs no change.
