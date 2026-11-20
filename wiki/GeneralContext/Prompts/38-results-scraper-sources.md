---
type: prompt
---

# 38 (part) — Results scraper: the source research and the PC's access

**Part of [`38-results-scraper.md`](38-results-scraper.md)**, whose "Design
notes" carry the ranking. This is the evidence behind it, gathered
2026-11-19 by reading each source's terms, robots.txt and at most one sample.
Nothing was bulk-fetched. Terms change: **re-read the chosen source's terms
before its first unit**, and again at cutover.

The human's legal position (results are facts, free to record) is settled
and not re-argued here. What follows is **acquisition terms only**.

## The candidates

| Source | Terms on automated access and public display | Rate limit | Verdict |
|---|---|---|---|
| **balldontlie API** ([terms](https://www.balldontlie.io/terms), [docs](https://docs.balldontlie.io/), [pricing](https://www.balldontlie.io/)) | §6: "You may use Data you lawfully obtain for any lawful personal or commercial purpose"; storing, caching, publishing and displaying are listed as allowed; "No attribution … required". §6 forbids only building "a sports-data API or equivalent data feed that serves as a substitute". §7(d) forbids automated collection "except through our official interfaces". §5: keys may not be shared. §7(f): may not "state or imply that Data is official league data". robots.txt: `Allow: /`. | Free 5/min; ALL-STAR (NBA, $9.99/mo) 60/min; GOAT 600/min | **Primary** (ALL-STAR, the human's choice) |
| **hoopR-nba-data** ([repo](https://github.com/sportsdataverse/hoopR-nba-data), [licence](https://github.com/sportsdataverse/hoopR-nba-data/blob/main/LICENSE.md)) | CC BY 4.0: credit, link the licence, note changes; commercial use allowed. Upstream is ESPN (README "source: ESPN"), whose terms forbid scraping: the same kind of residual risk the human accepted for Kaggle (`06-nba-data.md` decision 1). | n/a (GitHub releases) | **Fallback**, a day late: the daily job runs 07:00 UTC Nov–Jun |
| TheSportsDB ([terms](https://www.thesportsdb.com/docs_terms_of_use.php), [docs](https://www.thesportsdb.com/documentation)) | "You cannot publish apps to an appstore unless you are a paid subscriber"; paid use "must mention us as the source". "Please do not scrape our website." NBA box scores on the free key are not documented. | Free 30/min | Weak; not ranked |
| NBA.com, stats.nba.com, cdn.nba.com ([terms](https://www.nba.com/termsofuse), [robots](https://www.nba.com/robots.txt)) | §1: no use of content, "statistics, updated scores" included, "for public or commercial purposes … without the written permission of the Operator". §9 (read from a summary, recheck if ever needed): statistics only for news or "private, non-commercial purposes", and not in a service featuring "comprehensive, regularly updated statistics". robots.txt disallows `/api/*` and `/stats/events/`; cdn.nba.com timed out. | none published | **Rejected**: the terms forbid the use |
| ESPN site API ([Disney terms](https://disneytermsofuse.com/english/), [robots](https://www.espn.com/robots.txt)) | §2.B(x): no access "using a robot, spider, script, or other automated means", no "data mining or web scraping". §2.A: "personal, noncommercial use only". robots.txt disallows `*/boxscore?`; the API host answered 403. | none published | **Rejected** |
| Basketball-Reference ([terms](https://www.sports-reference.com/termsofuse.html), [data use](https://www.sports-reference.com/data_use.html), [bot traffic](https://www.sports-reference.com/bot-traffic.html)) | Data use: "you should not create websites or tools based on data you scrape from Sports Reference". Terms §5: no automated access "without our express written permission"; no database "that competes with or constitutes a material substitute". | 20/min, breach "in jail for up to a day"; `Crawl-delay: 3` | **Rejected** |

Retired or not candidates: API-SPORTS (retired, `06-nba-data.md` decision 3)
and Kaggle itself (the 24–48 h lag this track exists to fix). Licensed feeds
(Sportradar, SportsDataIO) were not researched: their pricing is for
businesses, outside a hobby budget.

## balldontlie against the CSV contract

The contract is the four files' headers in
`backend/tests/fixtures/nba_data/` (the dataset's exact headers) and the
columns `nba_history.REQUIRED_COLUMNS` and `schedule.SCHEDULE_COLUMNS` read.

- **Endpoints.** `GET /v1/games?dates[]=YYYY-MM-DD` (free tier): one request
  returns a date's games (`per_page` up to 100). `GET /v1/stats?game_ids[]=…`
  (ALL-STAR): one request per game at `per_page=100`. Cursor paging:
  `meta.next_cursor` is **omitted**, not null, on the last page. A finished
  night of 12 games is about 13 requests, far under 60/min.
- **Final.** `status_state` is one of `scheduled`, `in_progress`, `final`,
  `postponed`, `canceled`, `delayed`, `suspended`, `abandoned`, `unknown`.
  Write a game only on `final` (`status` "Final" says the same).
- **IDs.** balldontlie's own game, team and player ids; **no nba.com id
  anywhere**. Games map through the schedule file (date + home + away); teams
  through a fixed 30-row table; players through a person map (Design notes).
- **Time.** `datetime` is UTC (`…Z`); `date` is a calendar date with no zone
  stated. Convert `datetime` to `America/New_York` for `gameDateTimeEst`.
- **Games.csv.** Scores: yes. `gameLabel`, `gameSubLabel`,
  `seriesGameNumber`, `arenaName`: from the matched schedule row. Other
  columns (attendance, officials): blank.
- **TeamStatistics.csv.** `home_q1`–`q4`, `ot1`–`ot3` (2023 season on):
  q1–q4, `ot1Points`, `ot2Points`; `otAllPoints` = score − q1..q4 (covers a
  fourth overtime the API lacks). `numMinutes`: the team's summed player
  minutes, in decimal minutes. Team totals: summed from player rows.
- **PlayerStatistics.csv.** `min` (string, "21:35" or whole minutes; write
  decimal minutes), `fgm`/`fga`, `fg3m`/`fg3a`, `ftm`/`fta`, `oreb`, `dreb`,
  `reb`, `ast`, `stl`, `blk`, `turnover`, `pf`, `pts`, `plus_minus`: all
  present. **Gaps:** `startingPosition` (blank: the app shows no starters
  for scraped games until a source has it) and DNP rows ("Player stats do not
  include participation-status classifications"). A zero-minute row is
  written with blank `numMinutes`, the loader's "did not play", no reason.
- **Players.csv.** Name, height, weight, college, country, draft: present
  under balldontlie ids. A player new to the league needs a row the loader
  accepts (`personId` plus blanks); see the person map.

## The PC's permission set (proposal)

`FanwireResultsScraper`, in the workload account, created by the human in
IAM Identity Center: `s3:GetObject` and `s3:PutObject` on `nba-scraper/*`;
`s3:GetObject` on `nba-eoin/Players.csv` and `nba-eoin/LeagueSchedule*` (the
person map's seed and the tip-off times); `s3:ListBucket` on the bucket with
an `s3:prefix` condition of `nba-scraper/*`; `kms:GenerateDataKey` and
`kms:Decrypt` on the bucket's CMK; `lambda:InvokeFunction` on
`SportsDataLoad` only. Nothing else: no admin, no other prefix, no secret.
