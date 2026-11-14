---
type: reference
---

# 0x02 — Events

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized. Covers the `events/` module: `Team`, `Game`, `Player` and `PlayerGameStats` (the box score). The `Team`-before-`Game` seeding order is already documented in [[0x00-architecture]] — not repeated here. **One source:** NBA data comes from a Kaggle dataset, Eoin Moore's "NBA Dataset: Box Scores and Stats" (CC0), 2003-04 onward, loaded into Postgres; nba.com ids are the only sports-data keys, and players and box scores are tables of their own. The API-SPORTS path is retired ("Resolved decisions" below).

Business rules driving this module (full detail in [[wiki/GeneralContext/Architecture/business-rules|Projects]] "Events"): import an existing NBA game-results database (only NBA, only this source, for now), serve it via an API, provide a stats section (champions, team records during the regular season, stats leaders), and posts with a game link must click through to that game's stats page ([[0x03c-posts-likes-mentions]]'s `EventMention` references `Game` for this).

## The attachment interface — `posts/`' read of sports data (`EVENTS-009`)

`posts/`' sports-data attachments ([[wiki/GeneralContext/Decisions/0030-post-deletion-deactivation-and-attachments|ADR 0030]]) reach `events/` through these `app.events.service` functions only; `posts/` never imports `app.events.models`.

- **Validation, one target, a precise refusal.** `validate_game_final(session, game_id)`, `validate_player_game(session, line_id)`, `validate_player_career(session, player_id, scope)` return `None` or raise a `LinkTargetError` subclass (`app.events.errors`): `LinkTargetNotFoundError`, `GameNotCompletedError`, `PlayerDidNotPlayError`, `NoGamesInScopeError`. A scope outside `CAREER_SCOPES` (`regular`, `playoffs`, which is `LINE_GAME_TYPES`) is a plain `ValueError`: the request is wrong, not the target.
- **`Game.completed`** (a hybrid, row and query): `home_score + away_score > 0`, the loader's "a 0–0 game has no score" rule in one place. Every loaded game is completed today; the property is where the rule changes if unplayed games are ever loaded.
- **Previews, in batches, honest about gaps.** `game_final_previews(session, game_ids)`, `player_game_previews(session, line_ids)`, `player_career_previews(session, [(player_id, scope)])` return dicts of frozen dataclasses (`GameFinalPreview`, `PlayerGamePreview`, `PlayerCareerPreview`). `GameFinalPreview` includes nullable `home_line_score` and `away_line_score` arrays copied from the matched `Game`; the existing single batched game query supplies them. An id with no row, or a career key with an unknown scope, is absent rather than an error, so one odd target never fails a page. A DNP line is returned as stored. An empty career scope has null averages. **Query cost: none for no ids; one query for games and for lines, two for careers, whatever the number of ids** (pinned by query-count tests).
- **Careers are computed live**, by `player_detail`'s own helpers (`_line_columns`, `_stat_line`), so a career preview equals the player page's `career_regular`/`career_playoffs` by construction. No snapshot (out of scope by decision).

## Resolved decisions
- **Season format — settled as text, `"YYYY-YY"`** (e.g. `"2025-26"`). Implemented in `app.events.models.Game.season` (`Text`, not null); the loader derives it from digits 2–3 of the game id.
- **`Player` and `PlayerGameStats` replace `Game.player_stats` (`EVENTS-004`).** The JSONB box score (four stats per player, no player identity) and its GIN index `ix_games_player_stats_gin` are dropped by migration `d9f3b6a1e2c4`, which also adds the two tables and the game columns ([[0x02a-events-schema]]); existing teams and games keep their rows and ids. Its downgrade restores `player_stats` as `[]` on every row. `EVENTS-006` serves players ([[0x02c-events-routes]]).
- **API-SPORTS retired (`EVENTS-003`).** Removed: `adapters.py` (`ApiSportsAdapter`), `factory.py`, `interfaces.py`, the ingestion pipeline, `proxy.py` (`CachedEventProxy` and its caches), `lambda_handler.py` (the `Ingestion` function), `events/dependencies.py` (`get_live_score_proxy`, key resolution), the `api_sports_*`/`idempotency_table_name`/`live_score_cache_table_name` settings and the `api_sports_*` columns. Migration `c5e8a2d4f9b1` makes the nba ids NOT NULL; it **refuses to run, changing nothing, while any team or game row lacks an nba.com id**, naming the table and count (e.g. a dev database still holding the old `seed_dev.py` fixtures). `UnrecognizedTeamError` lives in `app.events.errors`. `scripts/seed_dev.py` seeds no teams or games; it prints how to load them.
- **Decisions carried over from the first dataset** (`EVENTS-001`: Nathan Lauga's "NBA games", to December 2022, since deleted; its 3,637 loaded games match the current dataset on game id, teams and both scores): nba.com ids get their own columns, `game_type` is stored, play-in games are loaded, duplicate rows keep the first and are counted, one transaction per run.
- **`feed/`'s read interface.** `app.events.service.game_ids_for_team(session, team_id) -> list[int]` (the team-scoped feed) — see [[0x06-feed]]. `games_by_ids(session, ids) -> dict[int, GameRef]` (`GameRef` is just `id`) exists but has no caller in app code.
- **`search/`'s sports-data filter.** `app.events.service.filter_games(session, *, season, team_id, position, limit, offset) -> list[Game]` (plain `WHERE`-clause filtering, all filters optional and AND'd, `team_id` matches home or away) and `distinct_seasons(session) -> list[str]` (for the year dropdown). `position` is an `EXISTS` on `PlayerGameStats`: a game matches when any player in its box score **started** at that position (bench rows have none). `ALLOWED_POSITIONS` (`PG, SG, SF, PF, C, G, F`) is the allow-list `GET /search/games`' `position` query param is validated against; the data's starters only ever have `G`/`F`/`C`, so `PG`…`PF` match nothing. See [[0x07-search]].

No pagination on `GET /events/teams` (YAGNI — `Team` is a small, static ~30-row table).

## Parts

The module's sections live in one part file each:

- [[0x02a-events-schema]]: the tables: `Team`, `Game`, `Player` and `PlayerGameStats`, with their design, pattern, AWS and security notes
- [[0x02b-events-loading]]: the dataset loader, the `SportsDataLoad` function, the schedule (`ScheduledGame` and its route) and the scale generator
- [[0x02c-events-routes]]: the public API routes: teams, games, the game detail, players and seasons
- [[0x02d-events-records]]: the records library: the registry, aggregate tables, the three records routes, the edge cache and the indexes
