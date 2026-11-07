# FRONTEND-044: the Schedule page

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-07)

A new page, **Schedule**, showing the games played or to be played today, with
a way to move backwards and forwards.

- Max-width desktop: 5 day cells, two days before today, today, two after.
  Mid width (860–1248 px): yesterday, today, tomorrow. Mobile: today only.
- The middle cell always starts on today. Arrows go back or forward, and
  clicking a day jumps to it.
- Each cell compacts its games with the same card as the Recent Games column.
- A nav link in the sidebar and the bottom bar, after Stats and before
  Notifications/Search. Not inside the Stats page.
- No filters for now: upcoming and completed games only.
- Built **last**, after `EVENTS-014` and `EVENTS-015`, once the database holds
  the schedule (the human uploads the extra LeagueSchedule CSV files).

## Where it is

`EVENTS-014` serves `GET /events/seasons/{season}/schedule`: played games
(`final`, with scores and `game_id`) and upcoming ones (`scheduled`, with
`time_tbd`, undecided teams as null), with optional `date_from`/`date_to`.
The compact card is inside `features/games/RecentGames.tsx`. The nav is
`routes/AppLayout.tsx`; Search is sidebar-only, so the bottom bar reads Home,
Stats, Schedule, Notifications, Sign out.

## Decided (Director, 2026-11-07)

- **Breakpoints are the shell's**: 53.75em (860 px) and 78em (1248 px), so
  860 px itself shows three cells.
- **The centre day is in the address** (`?date=`), so Back, reload and a shared
  link keep the place; no date means today.
- **"Click the day"** is the day heading of each visible cell as a button. On
  one cell (phones) that leaves the arrows and a Today button; a date picker or
  a week strip is a later spec if wanted.
- **One read per season**, sliced on the client, so the arrows are instant.
  `EVENTS-014` records the season response's size; if it proves too large,
  amend this to `date_from`/`date_to` windows.
- **No team records on schedule cards**: the schedule route has none. Adding
  them is a backend change for a later spec.
- **Times in Eastern** with "ET", as the data is stored; local-time display is
  a later choice.
- Scheduled games are not links: they have no game page yet.
