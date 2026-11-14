---
type: reference
---

# 0x02d — Events: records

**Agent-facing.** Part of [[0x02-events]] (index, the attachment interface and resolved decisions).

## Records (`EVENTS-010`, `EVENTS-012`)

`app.events.records` holds `RECORDS`, a registry of 104 records in seven categories (`team-franchise`, `team-season`, `team-game`, `player-game`, `player-season`, `player-career`, `player-playoffs`), team records first; the ids are [`.ai/tasks/EVENTS-012/brief.md`](https://github.com/DavidDems/fanwire-archive/blob/b2807e9a2a4b59ed4f2ff74d174ceba0239fc908/.ai/tasks/EVENTS-012/brief.md)'s library table. Each has an id, group, category, title, unit, rule text, `value_kind`, search `keywords`, an optional `featured_rank` (1–16, `FEATURED`'s order) and a query builder (a Strategy, [[wiki/CodeContext/Standards/gof-patterns|GoF]]) returning its *candidates*: every qualifying row with its value, and the list's order. Families are built by factories (`_player_game`, `_season`, `_careers`, `_team_seasons`, `_team_games`, `_team_franchise`), and one read path ranks, caps and pages any record's candidates, so a new record is one more registry entry.
- **Aggregate tables (`EVENTS-012`).** Season, career and team-game records read two derived tables; single-game player records and the indexed `EVENTS-010` records read `games` and `player_game_stats` live. `player_season_totals`: one row per player, season and game type (`regular`/`playoffs`) with a played line, summing those lines (games, seconds, points, rebounds, offensive and defensive rebounds, assists, steals, blocks, turnovers, made and attempted FG/3PT/FT, double- and triple-doubles); a mid-season trade is one row whose `team_id` is the team of the last played game. `team_game_totals`: one row per team per completed `regular` or `playoffs` game (score, opponent, result, `streak` = length of the current same-result run within season and type, by date, and the team's box-score sums, null without a box score). Both have a bigint identity key, no foreign key and no other index. `app.events.record_totals.rebuild_record_totals(session)` (re-exported by `records`) is their one writer: it replaces both with DELETE + INSERT … SELECT in the caller's transaction and never commits. `load_nba_history` (so the load Lambda), `scripts/generate_scale_fixture.py` and `scripts/seed_perf.py` call it before their commit; `seed_dev.py` writes no games. Migration `a8d3e5f1c2b7` creates and populates them from a frozen copy of the same SQL.
- **Minimums**, stated in each rule: a percentage needs FG 15 / 3PT 8 / FT 10 attempts in a game, 500 / 200 / 150 in a season, 3,000 / 1,000 / 1,000 in a career; a player's average needs 58 games in a season, 400 in a career. Team records have none. `shot_pct` fills `made`, `attempted` and `pct` (= `value`); an `average`'s value is the mean to one place, no figure beside it.
- **Counting rules**, each stated in its rule text:
  - Single-game records count `regular` and `playoffs` games only (not play-in or the cup final), and played lines only.
  - Season records count `regular` games, and only seasons with a champion: a season in progress never holds one.
  - Championships use `champion`'s rule through one helper: `service.season_champions()` (one `ROW_NUMBER()` over every season's Finals wins) is built on the same `_finals_teams`/`_finals_wins`/`_finals_order` as `champion`, so they agree by construction. A player's title is a season with a played line for the champion in that season's NBA Finals.
  - Career records count played lines of `regular` games. A triple-double is 10 or more in at least three of points, rebounds, assists, steals and blocks.
  - Team records ignore a game without a result (`Game.completed`).
- **`value_kind` (`EVENTS-011`)** says what a record's value is: one of `count`, `win_loss`, `made_total`, `shot_pct`, `average`, with no default, so a record cannot be registered without one. `team-best-season` and `team-worst-season` are `win_loss` with unit `record`; `player-threes-game` and every made-shot total are `made_total`, every shooting percentage `shot_pct`, every per-game figure `average`, the rest `count`. `_entry_fields` is the one place a row becomes an entry, switching on the definition's kind (the cached `_holder_for` returns it beside the statement). A `win_loss` candidate also labels `losses` (`games - wins`, in SQL); a `made_total` one labels `attempted` (`three_pointers_attempted`, a fetched column, not a key, so `ix_player_game_stats_three_pointers_made_played` still serves it).
- `GET /events/records`, the catalog: `{since_season, through_season, records: [{id, group, category, title, unit, rule, value_kind, keywords, featured_rank}]}`, no holder. The window is the earliest and latest stored season. **1 query** (the window); the records are `CATALOG`, built at import. Search runs in the browser over it.
- `GET /events/records/holders?ids=a,b`: `{holders: {id: holder or null}}` for 1–24 distinct known ids (none, empty, more than 24, a duplicate or an unknown id is a 422). `holder` is the list's first entry plus `tied_count`, how many entries share its value (all of them, not only those inside the cap), and `top` (`EVENTS-016`), the list's first three entries (fewer when it holds fewer) exactly as `GET /events/records/{id}?limit=3` returns them, so a Historical card shows its top three from the same read; null when nothing qualifies. **One query per id**, each at most three rows; each holder statement is built once per process, on first use. Declared before `/{record_id}`. The client sorts `ids`, so a page is one edge entry.
- `GET /events/records/{record_id}?limit=&offset=`: `{id, group, title, unit, rule, value_kind, since_season, through_season, total, entries}`. A list holds at most its **top 100** (a tie at the 100th place is cut by the list's order); `total` is how many it holds; `limit` 1–100 (default 25), `offset` 0–99, so no call pages past the 100th entry. **2 queries**: the window, then the page with its total.
  - An entry has `rank` (competition ranking, `RANK()`: 1, 1, 3), `value`, `team` (id, name, abbreviation), `player` (id, names), `season` and `game` (id, date, type, opponent abbreviation), each null where the record has none. A player's single-game entry names the team he played for.
  - The figures behind `value` (`EVENTS-011`): nullable integers `wins`, `losses`, `made`, `attempted` and a nullable number `pct`, each null where the record's `value_kind` does not use it. `win_loss` fills `wins`, `losses` and `pct`; `made_total` fills `made`, `attempted` and `pct` (null when nothing was attempted); `count` fills none. `pct` is `service._pct`'s three places. `value` keeps its meaning (a season's win percentage, a line's threes made), so older clients still render.
  - Order: value (ascending for `team-worst-season`, descending otherwise), then wins for season records (more first for best, fewer first for worst), then date or season (earlier first), then team or player id.
  - Season values are win percentages through `_pct`, the one three-place rounding in `app/events`; the exact fraction ranks and orders, in SQL.
- An unknown id is a 404, a `limit` or `offset` out of range a 422; an empty database answers 200 with null holders and empty lists.
- **Cached at the edge for five minutes** (the human, 2026-10-23): all three routes answer a 200 with `Cache-Control: public, max-age=300`, and `infra/lib/cdn-stack.ts`'s `/api/events/records*` behaviour, ordered before `/api/*`, honours it with a cache key of `ids`, `limit` and `offset` only: no header, no cookie. That is safe only because the routes never read the caller (no user dependency, pinned by `test_records_contract.py`). Every other route under `/api/*` stays uncached. The latency ceilings are measured at the origin, uncached.
- **Query shape.** A list's top is `FETCH FIRST 100 ROWS WITH TIES` on the ranked value alone, then cut to 100 by the full order. A holder is `FETCH FIRST 3 ROWS WITH TIES` on the value, ranked (`RANK()`) and numbered by the full order as the list is, cut to position 3; `tied_count` is the count of that set's rank-1 rows (a window over the ranked subquery), and every value tied for first is inside it. Ordering the inner query by the full order instead (value, date, player, line) gave an incremental sort under a parallel Gather Merge that read about 1,000 index rows for a 100-row list. Season records group each side on `games` before the `UNION ALL`: about 1,400 rows reach the final grouping instead of 55,000. Holder statements take no parameters, so each is built once per process: rebuilding them on every call cost about 20 ms of Python per twelve.
- **Eight indexes (migration `b5e9c3a7d2f1`, measured, 2026-10-24).** `tests/events/test_records_indexes.py` pins each to the statement the app sends.

  | Index | Serves | Before → after (list at limit 100, HTTP median) |
  |---|---|---|
  | `ix_player_game_stats_{points,rebounds,assists,three_pointers_made}_played`, each `(stat) WHERE seconds_played IS NOT NULL` | the four single-game player records | 116–138 ms → 16–18 ms; holder 29,380 → about 20 buffers |
  | `ix_player_game_stats_triple_doubles`, `(player_id, game_id)` over played triple-double lines; its predicate is `models.TRIPLE_DOUBLE`, shared with the record | `player-career-triple-doubles` | 96 ms → 21 ms; 15,284 → 1,006 buffers |
  | `ix_games_margin`, `(abs(home_score - away_score))` | `team-largest-win` | 31 ms → 15 ms; holder 1,321 → 9 buffers |
  | `ix_games_nba_finals`, `(season)` over NBA Finals games | every championship rule | `player-championships` 2,687 → 1,461 buffers |
  | `ix_games_season`, `(season)` | the data window (min and max season) that every records call reads | 657 → 7 buffers, 6 ms → 0.1 ms |

  - **The measurement.** The real 2003-04 to 2025-26 load: 29,646 games and 745,466 box-score rows. That is 108.6 MB of `player_game_stats` (`pg_relation_size`) and 5.4 MB of `games`. Local Docker Postgres 16 on Windows, from the June 2026 CSV download.
  - **Upgrade** time: 3.0 s, and the indexes total about 18 MB. The full load took 490 s before the migration and 332 s after it. The first run read the CSVs cold, so compare season by season instead: a season that took 14–15 s without the indexes takes 14–15 s with them, so the indexes add no measurable load time.
  - **Medians after:**
    - local: the summary in 187–193 ms, `player-career-points` in 100–107 ms, every other list in 12–41 ms;
    - the `db.t4g.micro` proxy (`--cpus=1 --memory=1g`, `shared_buffers=256MB`, `work_mem=4MB`): the summary in 315–351 ms, `player-career-points` in 210–274 ms.
  - **Payloads:** the summary is 5.4 KB, a 100-entry list at most 27.5 KB.
  - **Unchanged:** the other events routes stay within 1.5 ms of their medians before the migration.
  - **Not indexed:**
    - `player-career-points` reads `player_season_totals`.
    - `team-most-points-game` reads `games` twice, as a `UNION ALL` of both sides: 1,765 buffers and 35 ms. Indexes on `home_score` and `away_score` were tried and gave no index plan, even with sequential scans off.
    - The season records read `games` through `ix_games_season` once per champion season, on each side: 1,649 buffers and 41 ms.
  - **One Baseline line is missed, and the human accepted it (2026-10-24):** the whole summary touches about 22,200 buffers against the skeptic's cap of 19,193 (1.25 × `player_game_stats`' heap plus 4 × `games`'). The overrun is all repeat reads of `games`. Every latency ceiling is met.
  - **The scale floor was not reached either, also accepted by the human:** the complete real dataset has 745,466 box-score rows, not the 800,000 the skeptic estimated.
- **Eight more indexes (migration `a8d3e5f1c2b7`, `EVENTS-012`).** Each is `(key) WHERE seconds_played IS NOT NULL` on `player_game_stats`, about 4.5 MB (about 36 MB in all), and serves one single-game player record's list and holder statements; `tests/events/test_records_indexes.py` pins each to them.

  | Index | Serves | Before → after (list at limit 100, HTTP median) |
  |---|---|---|
  | `ix_player_game_stats_plus_minus_played`, `(plus_minus)` | `player-plus-minus-game` | about 390 ms → 12.1 ms |
  | `ix_player_game_stats_free_throws_made_played`, `(free_throws_made)` | `player-free-throws-game` | about 390 ms → 13.1 ms |
  | `ix_player_game_stats_blocks_played`, `(blocks)` | `player-blocks-game` | about 390 ms → 13.1 ms |
  | `ix_player_game_stats_defensive_rebounds_played`, `(defensive_rebounds)` | `player-defensive-rebounds-game` | about 390 ms → 12.6 ms |
  | `ix_player_game_stats_steals_played`, `(steals)` | `player-steals-game` | about 390 ms → 12.5 ms |
  | `ix_player_game_stats_minutes_played`, `(seconds_played / 60)`; the expression is `models.MINUTES_PLAYED`, shared with the record, the 60 written into the SQL | `player-minutes-game` | about 390 ms → 14.6 ms |
  | `ix_player_game_stats_offensive_rebounds_played`, `(offensive_rebounds)` | `player-offensive-rebounds-game` | about 390 ms → 12.5 ms |
  | `ix_player_game_stats_field_goals_made_played`, `(field_goals_made)` | `player-field-goals-game` | about 390 ms → 13.9 ms |

  - **The measurement.** The perf profile: the scale fixture at `generate_scale_fixture.py`'s defaults (30,399 games, 808,551 box-score rows, a little more than the real load's 29,646 / 745,466), Postgres on the `db.t4g.micro` proxy (1 CPU, 1 GB, `shared_buffers=256MB`, `work_mem=4MB`), over HTTP at the origin, uncached, the median of 21–25 warm calls. Not measured on the real CSV load: the scale fixture stands in for it.
  - **Before** the eight indexes, each of those lists was a parallel sequential scan of `player_game_stats` with a sort spilling about 46 MB to disk.
  - **Medians:**
    - the catalog in 5.1 ms (39 KB, 104 records);
    - holders: 24 ids with the featured 16 in 262.5 ms, the featured 16 alone in 149.9 ms, the Records screen's 12 in 108.2 ms;
    - every one of the 104 lists under 300 ms, the median of their medians 15.4 ms. The slowest are the game percentages with a minimum, which have no index: `player-field-goal-pct-game` 282 ms, `player-three-pct-game` 106 ms, `player-free-throw-pct-game` 102 ms. Every other list is at most 38 ms.
  - **`player-career-triple-doubles`:** 14.4 ms, an Index Only Scan of `ix_player_game_stats_triple_doubles`. It counts distinct `game_id` (the same value: `(game_id, player_id)` is unique), so the aggregate needs its lines in `(player_id, game_id)` order, which only that index gives; with `count(*)`, the test fixture, where every line has the same `seconds_played`, planned it through the minutes index.
  - **Upgrade** from `c7a4e2f9b6d1` to `a8d3e5f1c2b7` with the fixture loaded: 6.35 s (about 0.7 s of it Alembic start-up), 3.31 s before the indexes were added to it.
  - **Totals tables:** `player_season_totals` 14,792 rows (2.53 MB in all), `team_game_totals` 60,516 rows (10.44 MB in all).
