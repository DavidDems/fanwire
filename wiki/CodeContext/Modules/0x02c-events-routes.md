---
type: reference
---

# 0x02c — Events: API routes

**Agent-facing.** Part of [[0x02-events]] (index, the attachment interface and resolved decisions).

## API routes (Phase 2a)
"Create an API to serve the data of these game from the database to the website" (`wiki/GeneralContext/Architecture/business-rules.md` "Events") is served by `app.events.routes` (`APIRouter(prefix="/events")`), public, no auth (sports data is public read, matching the guest-feed requirement):
- `GET /events/teams`, `GET /events/teams/{team_id}`
- `GET /events/games` — **paged (`EVENTS-005`)**: `limit` (default 50, 1–200) and `offset`, ordered `date desc, id desc` (several games share an evening; without the id tie-break, pages could repeat or drop one). Optional filters, ANDed: `season` (`YYYY-YY`), `team_id` (home or away), `game_type` (`regular`, `cup-final`, `play-in`, `playoffs`), `date_from`/`date_to` (inclusive calendar days of the stored naive US-Eastern `date`: `date_to` compares against the start of the next day). A malformed value, an unknown `game_type`, or `date_from` after `date_to` is a 422, never an empty list. The response is still a list of `GameOut`, so the compose `#` picker keeps working on the 50 newest games; a narrower picker is the frontend pass's. Why paged: a full load is 29,646 games, over a Lambda response's 6 MB as one list.
- `GET /events/games/recent` is registered before the game-id route. Public; `limit` defaults to 5 and accepts 1-10 (otherwise 422). Candidates are completed games of every type on the newest `limit` distinct stored calendar dates (so the list fills whenever `limit` completed games exist), independent of today. Each team's league-wide rank uses its own season's regular record: exact win fraction, wins, then name; teams without a regular record follow recorded teams, by name. Results sort by stored calendar date descending, then rank sum ascending within a date, then timestamp and id descending (EVENTS-015). Each item carries teams, scores, type/label, date, season, ranks and overall `home_record`/`away_record` (wins/losses; 0/0 without a record). Empty returns `[]`. Three statements: indexed candidate/date read, teams, and `_records` batched by season/team; standings shares its ordering key. Migration `b9f4c7e2d610` adds `ix_games_completed_date` on `date(date)` for completed games.
- `GET /events/games/{game_id}` — a **`GameDetailOut` (`EVENTS-005`)**, the game page and the read side `posts/`'s `EventMention.game_id` links to. A read model built by `app.events.service.game_detail` (plain dataclasses), not the ORM row, in **two queries whatever the box score's size**: the game joined to both teams, then the game's `PlayerGameStats` rows joined to `Player`, grouped by team in Python. It carries the game's fields (label, sub-label, series game number, venue, both scores), `home_team`/`away_team` (id, name, abbreviation), `home_line_score`/`away_line_score` **as stored** (the figure after the second overtime stays "third overtime and later", not split or padded), and `home_box_score`/`away_box_score`:
  - `players`: rows with minutes (`seconds_played` not null, zero included), starters first, then by seconds played (most first), then player id; each with `line_id` (the `player_game_stats` row's id, a `player_game` attachment's target, `EVENTS-009`), player id and names, starter and starting position, seconds, every counting stat, plus-minus and the three shooting percentages.
  - `did_not_play`: rows without minutes, by player id, with player id, names and `dnp_reason` (may be null).
  - `totals`: sums of the played rows only (seconds and counting stats; no plus-minus), percentages computed from the sums. **Never adjusted to the final score**: the 19 team-games where players' points differ from the score show both numbers as they are.
  - Percentages are **computed, never stored**: made ÷ attempted, a fraction from 0 to 1 rounded to three places (`0.462`, as nba.com shows them), null when nothing was attempted.
  - A game without box-score rows answers 200 with empty lists, zero totals and null percentages.
- **No index for the list (measured, 2026-10-14):** on a full 2003-04 to 2025-26 load (local Docker Postgres), the newest page is a sequential scan plus a top-N sort in 15 ms, `offset` 29,000 in 25 ms, a team-and-season page in 2 ms; the box-score query uses the `(game_id, player_id)` constraint's index in under 1 ms. Over HTTP: 50 games are 10 KB, 200 are 40 KB, a Finals detail is 12.5 KB. Revisit on `db.t4g.micro` only if a measured page is slow.

- **Players (`EVENTS-006`).** Read models built in `app.events.service` (`list_players`, `player_detail`, `player_games`), computed at read time from `Player`, `PlayerGameStats` and `Game`. No aggregate table (YAGNI: a career is at most ~1,600 rows).
  - `GET /events/players`: a bare list. `limit` defaults to 20 (1–100); `offset` ≥ 0. Ordered by last name, then first name, then id. Each item carries id, names, position, jersey, first and last season, and `latest_team_abbreviation`: the team of the player's newest box-score row by game date, DNP rows included, or null when there is none.
    - `q` is trimmed, then must be 1–100 characters. Every whitespace-separated word must be a prefix of the first name or of the last name, matched as `lower(unaccent(name)) LIKE lower(unaccent(:word)) || '%' ESCAPE '\'`. `\`, `%` and `_` in the input are escaped, and every value is a bound parameter.
    - `season` keeps players with at least one **played** row that season. `q` and `season` are ANDed.
    - Two queries: the page, then the latest team of each paged player in one `DISTINCT ON`.
  - `GET /events/players/{player_id}`: the stored attributes, `career_regular`, `career_playoffs` and `seasons`, in four queries whatever the career's length. Those are the player, then a `GROUP BY` game type for the career lines, a `GROUP BY` season and game type for the season lines, and the season teams.
    - A line has games played and started, seconds, the totals of every counting stat, per-game averages (points, rebounds, assists, steals, blocks, turnovers, threes made, minutes) to one place, and the three percentages from the totals.
    - **Only played rows of `regular` and `playoffs` games count.** Play-in and cup-final games are in no line, the NBA's own rule, but they are in the game log.
    - A player without playoff games has a playoff line of zeros, with null averages and percentages.
    - `seasons` has one row per season and game type played, newest season first. `teams` lists the abbreviations in the order first played, and the stats are summed across teams, like nba.com's "TOT" row.
    - Unknown id: 404.
  - `GET /events/players/{player_id}/games`: the game log, played and DNP rows, newest first by game date, then game id. `limit` defaults to 50 (1–200). Optional `season` and `game_type` filters.
    - Each row carries the game id, date, season, type and label; `team` and `opponent` (id, name, abbreviation); `is_home`; `team_score`/`opponent_score`; starter and starting position; seconds (null for a DNP); every counting stat; plus-minus; the three percentages; and `dnp_reason`.
    - Two queries: the existence check, then the page. An unknown player is a 404.
  - **One percentage rule.** `_shooting_from_totals` hands the sums to `_pct`, the only three-place rounding in `app/events`, for the box score and the player lines alike. Percentages are rounded in Python, never by SQL `ROUND`: Postgres rounds half away from zero (0.0625 → 0.063), and the box score would then disagree with the career line (0.062). `tests/events/test_player_detail.py` pins both.
  - **`unaccent`.** Migration `e6b2f8a4c7d1` runs `CREATE EXTENSION IF NOT EXISTS unaccent`, which needs the master user (the Migration Lambda's). `unaccent()` is not `IMMUTABLE`, so it can't sit in an index expression. The names in the 2026-06-15 dataset are stored without accents anyway (`Doncic`, `Jokic`: none of 1,018 players in three loaded seasons has one), so the extension is for the query side: `DONČIĆ` finds `Doncic`.
  - **No index (measured, 2026-10-15).**
    - On a synthetic full-size set (2,426 players, 741k box-score rows), the two-word search is a sequential scan plus a sort in 3.3 ms, and the whole list call takes 18–51 ms over a Windows-host connection.
    - On three real seasons (2018-19, 2023-24, 2024-25) in a throwaway Postgres, the warm search takes 8–17 ms, Dončić's detail 43 ms and his log 18 ms.
    - His lines there match nba.com: 2023-24 regular, 70 GP, 33.9 PPG, .487 FG. The one exception is 2024-25, which shows 48 games, not his 50. The dataset itself has only 27 Lakers rows for him, one of them a DNP.

- **Seasons (`EVENTS-007`).** Read models in `app.events.service` (`standings`, `champion`, `leaders`, `team_season`), computed at read time. Each route takes a fixed number of queries whatever the season's size, and the aggregation is a `GROUP BY` in Postgres. **A malformed value is a 422; a well-formed season with no stored games, or an unknown team, is a 404**, and every route's docstring says so, so it reaches `openapi.json`.
  - `GET /events/seasons`: every season with a stored game, newest first, as a list of `"YYYY-YY"` strings. It reuses `distinct_seasons`, which `search/` keeps using unchanged. 1 query.
  - `GET /events/seasons/{season}/standings`: `{season, tie_break, conferences: [{conference, divisions: [{division, teams}]}]}`. Conferences and divisions are sorted by name.
    - Each row has `team`, `wins`, `losses`, `win_pct` (three places, through `_pct`), `games_behind` and the home/away splits.
    - **Only `regular` games count**, NBA Cup group and knockout games included. `cup-final`, `play-in` and `playoffs` don't count.
    - Within a conference the order is the exact win fraction, then wins, then team name. `win_pct` is rounded for display only.
    - `games_behind` is `((leader_w - w) + (l - leader_l)) / 2` from the first team in that order, so it can be a half game.
    - **NBA tie-breakers are not applied.** `tie_break` says so: "Win percentage, then wins, then team name (NBA tie-breakers not applied)". Real tie-breakers are a later decision for the human.
    - 2 queries: the season check, then one `GROUP BY`.
  - `GET /events/seasons/{season}/champion`: `{season, champion, runner_up, result}`. **Computed, never stored**: among the season's `playoffs` games labelled `NBA Finals` (the dataset's spelling, checked on the full load: 7 games in 2015-16 and in 2024-25), the team with four wins. `result` is its wins, then the runner-up's (`"4-2"`). With no such team yet (a season in progress, or a season without Finals games), the same shape comes back with nulls, a 200. 2 queries. The leaders' games rule reads the same rule (`_finals`/`_crowned`) to tell a complete season from one in progress.
  - `GET /events/seasons/{season}/leaders?stat=`: `stat` is one of `points|rebounds|assists|steals|blocks|threes`; `threes` means three-pointers made. `limit` defaults to 10 (1–50). `game_type` is `regular` (the default) or `playoffs`.
    - The response is `{rule, minimum_games, leaders: [{player_id, first_name, last_name, teams, games_played, average}]}`.
    - Only played rows of the requested game type count. Rows are ordered by the exact average (descending), then player id (ascending). `average` is rounded to one place through `_per_game`.
    - **Qualifier** (`_games_rule`, shared with leader-boards). T is the most regular-season games any team has played; a season is **complete** once it has a champion (`champion`'s rule, through the same `_finals` helper).
      - From 2023-24, 65 games once complete: the NBA's rule for awards and leaderboards.
      - From 2023-24 while in progress (`EVENTS-017`), the games on pace for 65: ceil(65 × T / 82), at most 65 (52 team games: 42).
      - Before 2023-24, 70 % of T, rounded up and computed in integers, complete or not. This is the proxy the human accepted for the NBA's old minimums per stat, which aren't reproduced.
      - The playoffs have no minimum (0).
    - `rule` names the rule applied: "65 games (NBA rule from 2023-24)", "On pace for 65 games: 42, with 52 team games played", "70% of 82 team games, rounded up: 58" or "No minimum in the playoffs".
    - 4 queries for the regular season (the season check, the Finals, the most team games, one `GROUP BY`); 2 for the playoffs.
  - `GET /events/seasons/{season}/leader-boards` (`EVENTS-017`): every regular-season board in one read, for Records > Seasonal. `limit` 1–10, default 10.
    - The response is `{season, complete, rule, minimum_games, boards: [{stat, rule, minimum_made, leaders: [{player_id, first_name, last_name, teams, games_played, value, made, attempted}]}]}`.
    - `boards` is always, in the human's order: `points`, `assists`, `rebounds`, `blocks`, `steals`, `field_goals_made`, `threes`, `field_goal_pct`, `three_point_pct`, `field_goals_attempted`, `three_pointers_attempted`.
    - Every board applies `/leaders`' regular-season games rule (`complete`, `rule`, `minimum_games` are that rule).
    - Count boards rank by the exact per-game average over played rows, then player id; `value` is rounded to one place, `made`/`attempted` are null, `minimum_made` is null.
    - Percentage boards rank by the exact total made / total attempted (a `Fraction`, not the rounded value), then player id; `value` is 0–1 to three places, with `made` and `attempted`. They also need a made minimum: 300 field goals (`field_goal_pct`) or 82 threes (`three_point_pct`) when complete, ceil(base × T / 82), at most the base, while in progress, whatever the season. `minimum_made` is that number and the board's `rule` names it. A player with no attempt is never on one.
    - 4 queries whatever the season's size: the season check, the Finals, the most team games and one `GROUP BY` per player summing all nine columns; the eleven boards are ranked in Python from that result.
  - `GET /events/teams/{team_id}/seasons/{season}`: the team (with conference and division), its regular-season `record` with home and away splits, and every one of its games that season of every stored type, newest first.
    - Each game has its id, date, type, label, sub-label, `opponent` (id, abbreviation), `is_home`, `team_score`/`opponent_score` and `won`.
    - A known team with no games in a stored season gets a 200 with a 0-0 record.
    - 4 queries.
  - **No index (measured, 2026-10-15).** On the full 2003-04 to 2025-26 load (29,646 games, local Docker Postgres, Windows host), the median warm call over the app is:

    | Call | Median |
    |---|---|
    | seasons | 11 ms |
    | standings | 16 ms |
    | points leaders, regular season | 58–66 ms |
    | points leaders, playoffs | 21 ms |
    | a team's season | 29 ms |

    On that load:
    - Champions match the real results: 2015-16 CLE over GSW 4-3, 2023-24 BOS over DAL 4-1, 2024-25 OKC over IND 4-3.
    - BOS's 2023-24 record is 64-18 (37-4 at home, 27-14 away).
    - The 2023-24 scoring leaders are Dončić 33.9, Antetokounmpo 30.4 and Gilgeous-Alexander 30.1. Embiid is out: he played under 65 games.


- **Records** (`EVENTS-010`, `EVENTS-012`): the catalog, holders and record-list routes are [[0x02d-events-records]]; the season schedule route is [[0x02b-events-loading]] "The schedule".
