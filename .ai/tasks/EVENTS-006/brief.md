# EVENTS-006 — players: search, detail, game log

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Every season since 2003-04 is in the live database (`EVENTS-002`, loaded
2026-10-14). The human wants players to be searchable and to have their own
page, in a Stats section with a Players tab (`FRONTEND-009`). Nothing serves a
player yet. `Prompts/06-nba-data.md` "`EVENTS-006`" is the plan this spec
makes precise.

## Things to get right

- **Accent-insensitive search.** Names are stored as the dataset spells them
  (`Dončić`, `Jokić`, `Šarić`), and people type `doncic`. Postgres's
  `unaccent` extension does this. Adding it is a migration
  (`CREATE EXTENSION IF NOT EXISTS unaccent`), and the test container's
  `postgres:16-alpine` ships it. `unaccent()` is not `IMMUTABLE`, so it cannot
  go in an index expression as it is. With ~2,400 loaded players a sequential
  scan is fine: measure it, and add no index unless a measured query is slow.
  If the unit adds the migration, its PR says the Migration Lambda must be
  invoked right after the deploy (`build-deployment.md` "Run migrations"),
  and that the extension needs the master user, which is who the Migration
  Lambda connects as.
- **Prefix per word, either name.** `lu do` → `Luka Dončić`. Each word must be
  a prefix of `first_name` or `last_name` (after `unaccent` and `lower`).
  `LIKE` patterns are built from bound parameters, with `%` and `_` in the
  input escaped. Never string SQL.
- **Read-time aggregation** (Prompts/06, the human's YAGNI call): `GROUP BY`
  over `player_game_stats` joined to `games`. A career is at most ~1,600
  rows. Do not add an aggregate table.
- **What counts.** Played rows only (`seconds_played IS NOT NULL`;
  `PlayerGameStats.played` is the hybrid). `regular` and `playoffs` only:
  play-in and the NBA Cup final count in neither line. That is the NBA's own
  rule, and the human's decision 5 (Prompts/06) keeps `cup-final` out of
  standings for the same reason.
- **Reuse EVENTS-005's arithmetic.** `app.events.service._pct` and
  `Shooting` compute percentages for the box score. Season and career lines
  use the same rule: fraction, three places, null at zero attempts. Make the
  helper shared rather than writing a second one.
- **Season teams.** A traded player has rows for two teams in one season.
  `teams` lists each abbreviation in order of first appearance. The stats are
  summed across them, as nba.com's "TOT" row does.
- **The latest team** in the search list comes from the player's newest
  box-score row (by game date), so it is null for a player in `Players.csv`
  with no loaded game. The loader stores only players a box score names, so
  in practice this is never null today.
- **Route order.** `/events/players/{player_id}/games` and
  `/events/players/{player_id}` are new. Keep the routes thin; queries and
  read models live in `app.events.service`, as `game_detail` does.
- **Contract.** `python scripts/export_openapi.py`, then
  `npm run gen:api-types` (`openapi-drift`). New schemas only: no existing
  schema changes, so the frontend test kit should not need touching.

## Not in this task

Standings, champions, leaders and team seasons (`EVENTS-007`), any frontend
(`FRONTEND-009`), and player mentions in posts.
