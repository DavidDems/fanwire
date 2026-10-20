# EVENTS-009 — events/' read interface for attachments

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 1 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9). A non-reply post will carry one
sports-data attachment: `game_final` (a game's final score), `player_game`
(a player's line in one game) or `player_career` (career averages, regular
season or playoffs, computed live). `POSTS-005` validates the target on
create and `POSTS-006` puts an assembled preview in every read response.
Both cross into `events/` through this unit's functions only
(`0x00-architecture.md` "Connection rule"): `posts/` never imports
`app.events.models`.

## The design

- **Plain functions in `app.events.service`**, frozen dataclasses for the
  read models, as the module already does (`GameRef`, `PlayerDetail`).
  Errors in `app.events.errors`.
- **Validation and previews are separate calls.** Create validates one
  target and wants a precise refusal; reads want many previews at once and
  must not fail a whole feed page because one target is odd.
- **Refusals.** `game_final` needs a completed game; `player_game` needs a
  played line (`PlayerGameStats.played`); `player_career` needs at least one
  played game in that scope. Every stored game is a completed result today
  (the loader skips a game with no score), so `Game.completed` is the one
  place the rule lives when unplayed games are ever loaded.
- **Previews are honest about gaps.** A preview that reaches a DNP row
  (possible only if the data were reloaded under a post) returns it as
  stored, with its reason. An empty career line has null averages, the same
  as `player_detail`'s `_NO_GAMES`. An id with no row is left out of the dict;
  the caller renders that as unavailable. Nothing is invented.
- **Bounded batch reads.** Each preview function does at most two queries
  whatever its input size (for example one query for the rows joined to both
  team aliases; for careers, players then one `GROUP BY player_id, game_type`
  over all requested players). Reuse `_line_columns`, `_stat_line` and
  `LINE_GAME_TYPES` for careers so the figures equal the player page's by
  construction. Query-count tests already exist to copy
  (`tests/events/test_game_detail.py`, `tests/feed/test_post_view_queries.py`).
- **`line_id` on the box score.** `player_game`'s `ref_id` is a
  `player_game_stats.id`. The composer (`FRONTEND-013`) picks a game, then a
  player from its box score, so `BoxScorePlayerOut` carries the line's id. No
  new route: the game detail, player detail and game list routes already give
  the frontend everything else it needs.

## Traps

- `frontend/src/features/games/player-links.test.tsx` builds typed
  `BoxScorePlayerOut` fixtures. Once `schema.d.ts` is regenerated they fail
  typecheck without `line_id`: add it there, in the test commit.
- The career rule counts `regular` and `playoffs` only. Play-in and
  cup-final games are in neither scope (0x02 "Only played rows of `regular`
  and `playoffs` games count").
- Percentages are fractions 0–1 with three places (`_pct`), not 0–100.

## Not in this task

Any `posts/` change, the `data_link` request schema (`POSTS-005`), assembling
previews into feed and thread responses (`POSTS-006`), historical stat
snapshots (out of scope by decision) and any frontend component.
