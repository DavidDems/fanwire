# EVENTS-013: recent games in the home page's right column

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-05)

Under the search column, a small "recent games" section: the latest results in
the database, ordered by relevance. Prioritise games where the sum of both teams'
standings is lowest, so bad team against bad team comes last.

The human is about to refresh the game data. Today most teams have only about
two games this season, because the database has not been updated for nearly two
weeks.

## Decided

- **Standing means league-wide rank, 1 to 30.** Conference ranks would let two
  conference leaders tie with a 1 and a 1 while ignoring which conference is
  stronger, and a game between conferences would mix two scales.
- **Ranks from the game's own season, as standings stand now**, not as they
  stood on the game's date. The site's standings page shows the same thing, and
  replaying history per date costs a query per date.
- **The window is the three newest dates with a completed game**, about 15 to 30
  games in season. One date would be thin on light nights; a fixed number of
  days would be empty after a long gap in loading. Then the best five are
  chosen by rank sum.
- **Every game type counts.** A playoff game is still ranked by regular-season
  standing, which is what makes it notable.
- **Early in a season the order is noisy.** With two games each, many teams are
  tied on win percentage and the name tie-break decides their ranks. That is
  accepted, and it fixes itself as the data grows.
- **Ranks are in the response but not shown.** They make the order checkable
  from a test or a browser row, and leave room for showing them later.

## Reuse

- `_records` (one GROUP BY) and standings' `order` key in `events/service.py`.
  Factor the key out rather than copy it.
- `Game.completed`, `TeamRefOut`, `TeamIcon`, `GameScore`, `Skeleton`,
  `InlineAlert`, and the modal flow's link state as the game previews use it.

## Traps

- Route order: `/games/recent` must be registered before `/games/{game_id}`.
- Two seasons can sit in one window (the end of one and the start of the next):
  rank each game against its own season.
- Use the dev stats fixture for browser rows: the `backend-dev` database is
  empty otherwise.
