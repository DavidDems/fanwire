# EVENTS-005 — game list pagination and the game detail

## Why this exists

`EVENTS-004` (#144, deployed and migrated 2026-10-14) made box scores a table
of their own, but the API still serves only `GameOut`: no teams, no line
score, no box score. And `GET /events/games` returns every game in one
response. A full load is 29,646 games; at roughly 220 bytes of JSON each that
is 6–7 MB, over the 6 MB a Lambda response may carry, so the route (and the
compose `#` picker that calls it) would fail. The human's order, 2026-10-14:
this unit first, then `EVENTS-002` loads the live database.

`Prompts/06-nba-data.md` "`EVENTS-005`" is the plan this spec makes precise.

## Things to get right

- **The list stays a list.** `GET /events/games` keeps returning `GameOut[]`,
  so `frontend/src/features/compose/MentionAutocomplete.tsx` compiles and
  works unchanged; it now gets the 50 newest games instead of all of them.
  A narrower picker is the frontend pass's, not this unit's.
- **Stable order.** `date` is not unique (a dozen games share an evening), so
  order by `date desc, id desc`. Without the tie-break, `offset` pages can
  repeat or drop games.
- **Validate at the boundary.** `season` is `YYYY-YY`; `game_type` is one of
  `regular`, `cup-final`, `play-in`, `playoffs`; dates are ISO dates. Every
  bad value is a 422 (FastAPI `Query` constraints or an explicit check), never
  a filter that silently matches nothing.
- **Dates.** `Game.date` is a naive US-Eastern timestamp. `date_to` is
  inclusive: compare against the start of the next day, not the date itself.
- **The detail is a read model, not the ORM row.** Build `GameDetailOut`
  in `app.events.service` (a function returning plain data) and keep the
  route thin. Two or three queries: the game with both teams, then every
  `PlayerGameStats` row of the game joined to its `Player`. Group in Python.
  A test counts statements (SQLAlchemy's `before_cursor_execute` event) for a
  game with a full box score.
- **Box-score order and split.** Per team: played rows (`seconds_played` not
  null) with starters first, then by `seconds_played` descending (then by
  player id, so the order is deterministic); DNP rows separately with their
  `dnp_reason` (which can be null).
- **Percentages are computed, never stored.** A fraction from 0 to 1 rounded
  to three places, as nba.com shows them (`0.462`); null when the attempts
  are 0. Totals are plain sums of the played rows. 19 team-games in the data
  have players' points that differ from the final score (`0x02-events.md`):
  the detail shows both numbers as they are.
- **No box score.** A game stored without box-score rows (the loader stores
  and reports one; none in today's data, since the two such games are 0–0 and
  skipped) still answers 200, with empty lists and zero totals.
- **Line score.** Return it as stored on the team's side. Do not split the
  "third overtime and later" figure or pad it; the wiki explains it.
- **Indexes.** The list sorts 29,646 rows at most; measure before adding an
  index. If one is needed, `backend/alembic/versions/**` is in the paths, and
  the PR says why.
- **Regenerate the contract.** `python scripts/export_openapi.py`, then
  `npm run gen:api-types` (`openapi-drift` checks both). The test kit under
  `frontend/src/test/**` only changes if a `GameOut` literal stops compiling,
  which it should not.

## Not in this task

Player routes (`EVENTS-006`), standings, champions and leaders
(`EVENTS-007`), loading the live database (`EVENTS-002`), and any frontend
beyond the regenerated types.
