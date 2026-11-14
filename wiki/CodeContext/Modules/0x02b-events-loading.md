---
type: reference
---

# 0x02b — Events: loading

**Agent-facing.** Part of [[0x02-events]] (index, the attachment interface and resolved decisions).

## The loader — `app.events.nba_history` (`EVENTS-004`)

`load_nba_history(session, data_dir, seasons=None) -> LoadReport` reads `Games.csv`, `PlayerStatistics.csv` (not `…Extended`, which has fewer rows), `TeamStatistics.csv` and `Players.csv` from a directory outside the repo (the human's copy: `C:\data\nba`, downloaded 2026-10-25, which adds the first 2026-27 games). CLI: `python scripts/load_nba_history.py --data-dir <dir> [--season 2025-26 ...]` with `DATABASE_URL` set (the script kept its name; `seed_dev.py` points at it). Never pointed at the live RDS (that is `EVENTS-002`). Tests use a synthetic fixture with the dataset's exact headers under `backend/tests/fixtures/nba_data/`.

- **Scope:** 2003-04 onward (every team is one of today's 30). `--season` before 2003-04 is a `DatasetError`.
- **One transaction per run**: every file is read and validated before the first write; any failure rolls back everything, teams and players included.
- **Fail fast:** an unknown team in a stored game or its box score is `UnrecognizedTeamError`; a box-score player absent from `Players.csv` is `UnrecognizedPlayerError` (`app.events.errors`). A box-score team that contradicts its home flag, a malformed value, a missing file or column, and duplicate game rows that disagree are `DatasetError`. Ids in skipped games (All-Star teams) are never checked.
- **Skipped and counted:** preseason, All-Star, and a game without a final score. **A 0–0 game counts as without a score** (the human's decision, 2026-10-13): 22400627 and 22400988 are written 0–0, have no box score, and their winner column contradicts their quarter points. Both are named in the report.
- **Reported, not corrected:** a stored game without box-score rows (stored with an empty box score); a team whose players' points differ from its score (19 team-games, mostly 2003-05, 1–3 points); a team-game whose minutes fit neither format. Named only for games the run writes.
- **Ignored:** a `TeamStatistics.csv` line with `teamId` 0 (two 2025-26 games carry one beside their two real lines, every field blank).
- **Duplicates:** a repeated game or `(game, player)` row keeps the first and is counted (none in the current data).
- **Existing rows keep their ids.** A game already stored whose teams and score agree is **updated**: its new fields set and its box score added. A game that already has its box score and the same fields is **already present**. A stored game whose teams or score disagree is a `DatasetError`: a corrected result is never applied silently. A second run over the same data writes nothing and reports nothing new.
- **Report per season:** games loaded / updated / already present; skipped preseason / All-Star / no score; box-score rows loaded / already present / skipped; duplicates; and the named games above.
- **Measured** (local Docker Postgres, Windows host, 2026-10-13): the whole 2003-04 to 2025-26 range in **one run in 133 s** (29,646 games, 745,466 box-score rows, 2,426 players); one season in about 28 s, almost all of it reading `PlayerStatistics.csv` (390 MB) once; a second full run in 36 s, writing nothing. Box-score rows go in with `COPY` on the session's connection: an ORM/executemany insert sent one statement per row and took 7 minutes for one season.

## The load function — `app.events.load_handler` (`EVENTS-002`)

The loader above, run against the live database as the `SportsDataLoad` Lambda: the shared image with command `app.events.load_handler.handler`, 15 min, 2048 MB, 1024 MB of `/tmp`. **Nothing invokes it.** The human uploads the four CSVs to `SportsDataBucket` (`Fanwire-Storage`, private, CMK, SSL only, no events) under `nba-eoin/`, and invokes it by hand. The step-by-step runbook is [[wiki/CodeContext/Standards/build-deployment-post-deploy|After a deploy]] "Load sports data". Its one grant beyond what every function has is `s3:GetObject` on `nba-eoin/*`.

- **Event:** `{"seasons": ["2025-26", ...]}`, exactly that key, a non-empty list of distinct seasons, checked by `nba_history.validate_seasons`. **Required** (the human, 2026-10-14): a full reload lists every season. A bad event raises `InvalidLoadEvent` before any S3 call or connection.
- **Order:** event → settings (`SPORTS_DATA_BUCKET`, `DATABASE_URL`; unset fails fast) → advisory lock `LOAD_LOCK_KEY` (not `app.migrate`'s) → download `Games.csv`, `PlayerStatistics.csv`, `TeamStatistics.csv`, `Players.csv` to a new temporary directory → `load_nba_history` (one transaction) → remove the directory, success or not → return `teams_created`, `players_created`, `seasons` (each `SeasonReport` as data) and `lines`, the per-season lines also logged.
- **The lock** exists because the AWS CLI retries an invoke when its read timeout fires (60 s by default): without it the retry is a second load running beside the first. With it, the second fails fast (`SportsDataLoadLocked`, "already running") and writes nothing.
- **Failures raise** `SportsDataLoadFailed`, never return an error value, with the message passed through `app.migrate.redact` and the cause chain broken (`from None`), so `DATABASE_URL` never reaches CloudWatch. A missing object names its key.
- **Sizing** (2026-10-14, local Postgres): one season 18 s at a 99 MB peak; all 23 seasons 73–139 s at 709 MB. The four files are ~440 MB, over the default 512 MB of `/tmp`.
- **Schedule files** (`EVENTS-014`): it also downloads `nba-eoin/LeagueSchedule<YY>_<YY>.csv` for each season in the event. A missing key (404, `NoSuchKey`, `NotFound`) means no schedule file for that season; any other S3 error fails the load as before. The result gains `schedules`. No infra change: the `nba-eoin/*` grant covers it.

## The schedule — `ScheduledGame` and `app.events.schedule` (`EVENTS-014`)

A season's published schedule, played and upcoming games, in a table of its own so that no existing read can see an unplayed game. Nothing references it.

- **`scheduled_games`** (migration `217f70776078`, after `b9e4d7c2a601`): bigint identity `id`; `nba_game_id` (unique); `season`; `date` (naive US Eastern, as written); `time_tbd`; `game_type`; nullable `label`, `sub_label`, `venue`, `series_game_number`; nullable `home_team_id`/`away_team_id` → `teams` (null: not decided yet). Index `ix_scheduled_games_season_date`.
- **Reading** (`schedule.py`, called by `load_nba_history` in its one transaction): for each loaded season, `LeagueSchedule<YY>_<YY>.csv` in the data directory if present (`seasons=None`: every file present from 2003-04). The rules shared with the games loader (prefix → `game_type`, season from id, team map, date parser, `DatasetError`) live in `app/events/dataset.py`, moved there unchanged from `nba_history.py`.
  - Only the 2025-26 / 2026-27 header shape. 2024-25's file (`hometeamId`, UTC offsets) is a `DatasetError` naming the file, and nothing is written. Its season is played, so the union below already gives its schedule.
  - Prefixes `2`, `6`, `5`, `4` are stored; `1` (preseason) and `3` (All-Star) are skipped and counted. A wrong-season id, malformed id or date, or disagreeing duplicate rows (compared on parsed fields) is a `DatasetError`. An identical duplicate keeps the first and is counted.
  - A team id of `0` or blank is null. Any other unknown team is `UnrecognizedTeamError`. A `00:00:00` start is `time_tbd` (the source's "not set yet"). A blank or `0` `seriesGameNumber` is null; "Game 7" is 7.
  - **Replaced as a whole** per season whose file was read: rows gone from the file are deleted, changed rows updated, new ones added. A season with no file keeps its rows. Changes are not errors, because schedules change and results do not.
  - **Report:** one line per season after its games line, giving rows stored, undecided-team rows and skipped preseason / All-Star / duplicate rows, or "no schedule file".
- **`GET /events/seasons/{season}/schedule`** (public) → `{season, games}`, ordered by date, then `nba_game_id`. It is the union of the season's stored games (`final`, with the game's fields and score, `game_id` for `/games/<id>`, `time_tbd` false) and its schedule rows that are not stored games (`scheduled`, no score, a team null until decided). Played wins: a game in both is listed once, from `games`. A stored game with no schedule row is listed (2025-26's Finals Game 5, `42500405`, is missing from its file). The optional filters `team_id`, `date_from` and `date_to` are inclusive Eastern calendar dates. A malformed season or date, or `date_from` after `date_to`, is 422. A season with neither a game nor a row, or an unknown team, is 404 ("Season or team not found"). Filters matching nothing return an empty list. **Four statements** whatever the filters (teams, season check, stored games, unplayed rows with `NOT EXISTS`), never box scores.
- **Measured** (2026-11-07, throwaway Docker Postgres on 5433, the real `C:\data\nba-refresh` loaded for 2025-26 and 2026-27, Windows host, in-process client, median of 5 warm runs):
  - The two-season load took 28.1 s. The schedule step alone (read both files, replace both seasons) took 0.17 s.
  - 2026-27: 1,207 rows stored, 7 with an undecided team; 67 preseason skipped.
  - 2025-26: 1,321 rows; 71 preseason and 7 All-Star skipped.
  - Full 2026-27 response: 1,207 games (121 final, 1,086 scheduled), 464 KB in 83 ms. Full 2025-26: 1,322 final, 503 KB in 122 ms. Both are far below a Lambda response's 6 MB, so there is no pagination.
  - One team (BOS): 80 games, 30 KB in 21 ms. One week: 51 games, 20 KB in 20 ms.
- **After deploy:** the steps, including the `LeagueSchedule` upload, are [[wiki/CodeContext/Standards/build-deployment-post-deploy|After a deploy]] "Load sports data".

## The scale generator — `scripts/generate_scale_fixture.py` (`EVENTS-010`)

A dev tool for measuring at full-load scale without the real CSVs: `python scripts/generate_scale_fixture.py [--seasons 23] [--games-per-team 82]`, cwd `backend/`, `DATABASE_URL` pointing at a migrated database. Never run in CI or in production.
- **Fail-closed:** refuses (exit 1, nothing written) unless `ENVIRONMENT` is exactly `development` or `perf`, and when any stored `nba_game_id` is below 9,000,000,000 (a real load).
- **Its own id range:** teams, players and games from 9,200,000,000, clear of `seed_perf.py`'s 9,000,000,000–9,199,999,999.
- **Deterministic and idempotent:** a fixed seed; a second run finds its range populated and writes nothing.
- **Shape:** the 30 franchises (the loader's names and divisions), seasons from 2003-04, every team playing exactly `--games-per-team` regular games, playoffs with an NBA Finals that makes a champion each season, about 26–27 box-score rows per game with about 20 % did-not-play rows. Written with `COPY` in one transaction. It prints its games, rows, triple-doubles, 50-point games and DNP share.
- Its distributions are synthetic: correctness at scale is proven only on the real load.
- EVENTS-010's measurements used the real load, not this generator.
