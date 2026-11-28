---
type: prompt
---

# 38 (part) — Results scraper: the balldontlie API and the PC's access

**Part of [`38-results-scraper.md`](38-results-scraper.md).** What the API
gives against the CSV contract, read 2026-11-19 from its OpenAPI spec
([nba.yml](https://www.balldontlie.io/openapi/nba.yml)), its
[docs](https://docs.balldontlie.io/) and its
[terms](https://www.balldontlie.io/terms). Re-read on 2026-11-27 (terms
dated 2026-10-20). The terms allow storing, publishing and displaying the
data, commercial use included, with no attribution required and no retention
deadline. They forbid sharing the API key, evading the rate limit, building a
substitute feed, and presenting the data as official league data. The data is
"best effort", and the terms say to verify it before using it to settle
anything. The shadow proof and the loader's conflict alarm are that check.

## Tiers

The docs' tier table, 2026-11-27: **Free, 5 requests/min, $0**: Teams,
Players and Games. **ALL-STAR, 60/min, $9.99 a month per league**: adds Game
Player Stats, Active Players and Player Injuries. GOAT (600/min, $39.99) adds
box scores and the rest. Over the limit, the answer is 429; an endpoint
outside the tier answers 401. A sweep is one or two requests, well under
5/min. The limiter allows at most 4 a minute.

## Phase 1: games, free tier

- **Endpoint.** `GET https://api.balldontlie.io/nba/v1/games` with
  `dates[]=YYYY-MM-DD`, `per_page` up to 100, `Authorization` header. Cursor
  paging: `meta.next_cursor` is absent on the last page.
- **Game fields** (the spec's `NBAGame`): `id`, `date`, `datetime`,
  `season`, `status`, `status_state`, `period`, `time`, `period_detail`,
  `postseason`, `home_team_score`, `visitor_team_score`, `home_team`,
  `visitor_team`, `ist_stage`. The docs' examples also show `postponed` and
  `home_q1`…`home_q4`, `home_ot1`…`home_ot3` (and the visitor's), "only
  available for 2023 season and beyond". The spec lists neither, so the first
  call decides. No arena, attendance or nba.com id. `status` is free text
  ("7:00 pm ET", "Final"): read `status_state`, never `status`.
- **Final.** Write a game only when `status_state` is `final`. The enum:
  `scheduled`, `in_progress`, `final`, `postponed`, `canceled`, `delayed`,
  `suspended`, `abandoned`, `unknown`. `period` can read 4 for an overtime
  final, so never infer overtime from it.
- **IDs.** balldontlie's own game and team ids. Games map through the
  schedule file (ET tip-off date + home + away); teams through a fixed table
  keyed on `abbreviation`, checked against `dataset.TEAMS`.
- **Time.** `datetime` is a date-time with no zone stated in the spec; the
  docs examples end in `Z` (UTC), for example `2025-01-05T23:00:00.000Z`. Convert to `America/New_York` for
  `gameDateTimeEst`; never trust `date` across midnight.

## What phase 1 writes

The fixture headers in `backend/tests/fixtures/nba_data/` are the column
lists; every column is written, unknown ones blank.

- **`Games.csv`**: `gameId`, `gameDateTimeEst`, `hometeamId`, `awayteamId`,
  `homeScore`, `awayScore` from the API and the mapping; `gameLabel`,
  `gameSubLabel`, `seriesGameNumber`, `arenaName` from the matched schedule
  row; team city and name from `dataset.TEAMS`.
- **`TeamStatistics.csv`**: one line per team with `teamScore` and
  `opponentScore`; quarter and overtime columns only if the first call shows
  the API has them, otherwise blank (the loader then stores no line score,
  and Kaggle's later load sets it).
- **`PlayerStatistics.csv`, `Players.csv`**: header only.
- **`LeagueSchedule<YY>_<YY>.csv`**: the copy the sweep used, so the load
  stores the same schedule.

## Phase 2 additions (ALL-STAR)

`GET /nba/v1/stats?game_ids[]=…` (one request per game at `per_page` 100):
`min` (string, "21:35" or whole minutes), `fgm`, `fga`, `fg3m`, `fg3a`,
`ftm`, `fta`, `oreb`, `dreb`, `reb`, `ast`, `stl`, `blk`, `turnover`, `pf`,
`pts`, `plus_minus`, and `player` under balldontlie's id. No DNP rows and no
starting position.

## The PC's permission set (proposal)

`FanwireResultsScraper`, in the workload account, created by the human in
IAM Identity Center: `s3:GetObject` and `s3:PutObject` on `nba-scraper/*`;
`s3:GetObject` on `nba-eoin/LeagueSchedule*` (the tip-off times);
`s3:ListBucket` on the bucket with an `s3:prefix` condition of
`nba-scraper/*`; `kms:GenerateDataKey` and `kms:Decrypt` on the bucket's
CMK; `lambda:InvokeFunction` on `SportsDataLoad` only. Nothing else: no
admin, no other prefix, no secret.
