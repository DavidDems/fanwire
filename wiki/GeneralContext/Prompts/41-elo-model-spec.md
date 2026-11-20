---
type: prompt
---

# 41 (part) — The Elo model: specification and backtest method

Part of [`41-predictions-3-elo-model.md`](41-predictions-3-elo-model.md). A
proposal until track 41 lands it in `0x09-predictions.md`. Disclosure rules:
[ADR 0039](../Decisions/0039-our-prediction-disclosure-and-immutability.md).
Dated 2026-11-19.

## Sources (verify first)

The parameters below are FiveThirtyEight's published NBA Elo method
("How We Calculate NBA Elo Ratings", 2015). **That page could not be read on
2026-11-19:** fivethirtyeight.com redirects to `abcnews.com/politics`, and this
session's fetch tool refuses `web.archive.org`. The values come from search
summaries and two third-party restatements:

- [Nic Dobson, "FiveThirtyEight's Elo Ratings and Logistic Regression" (2019)](https://nicidob.github.io/nba_elo)
  gives the 100-point home bonus and the 1300 start for new teams.
- [Luke DiPerna, "How to build an NBA Elo rating system" (2023)](https://luke-lite.github.io/blog/how-to-build-an-NBA-Elo-rating-system)
  gives the margin-of-victory multiplier, which he says matches 538's
  constants, and 0.75/1505 as his own reversion.
- [538's data README](https://github.com/fivethirtyeight/data/tree/master/nba-elo)
  documents the columns only.

**Deliverable 0 of track 41:** the human opens
`https://web.archive.org/web/2020/https://fivethirtyeight.com/features/how-we-calculate-nba-elo-ratings/`
in a browser and pastes the relevant paragraphs. The session records exact
quotes here, and a value that differs from the archive is replaced by the
archive's. The point-spread divisor (28) and the playoff rule were not found in
any source reached; they are unverified until then.

## Model `elo-mov-1`

| Element | Value | Source / status |
|---|---|---|
| Start | 1500 for every team at its first game from 2003-04; a franchise whose first game comes later (Charlotte, 2004-05) starts at 1300 | 538 convention for new teams (Dobson); verify |
| Home advantage `H` | +100 to the home rating; 0 on a neutral floor (`game_type = 'cup-final'` only in v1) | 538 (Dobson, search summary: "about 3.5 points") |
| Win probability | `p_home = 1 / (1 + 10^(−(R_home + H − R_away) / 400))` | standard Elo |
| K | 20 | 538 (search summary) |
| Margin-of-victory multiplier | `M = (MOV + 3)^0.8 / (7.5 + 0.006 × D)`, with `D` = winner's rating − loser's rating, home advantage included (negative for an upset, which raises `M`) | DiPerna, "matches 538"; verify |
| Update | `Δ = K × M × (S − p_home)`, `S` = 1 for a home win and 0 otherwise; the home team gains `Δ`, the away team loses it | standard Elo, zero-sum |
| Between seasons | before a team's first game of a season: `R ← 0.75 R + 0.25 × 1505` | DiPerna's and widely cited as 538's; verify |
| Expected margin | `(R_home + H − R_away) / 28` points, home minus away | recalled 538 rule, **unverified**; see below |
| Expected total | not produced (`expected_total` null) | Elo has no scoring level |
| Playoffs, play-in | same parameters | no source reached says otherwise; one unofficial page claims K = 24 in the playoffs, unverified |
| Relocations | the franchise id carries its rating (Seattle→Oklahoma City 2008, New Jersey→Brooklyn 2012, the Charlotte and New Orleans renames) | the loader keys teams by nba.com franchise id |

**Not in v1, each a candidate for a later version:**

- rest and back-to-backs (538's later model had fatigue, travel and altitude
  terms; their values are unverified);
- neutral sites other than the Cup final (Cup knockout games in Las Vegas,
  international games);
- a points model for totals: each team's exponentially weighted points scored
  and allowed, relative to the season's average.

A candidate ships only if a holdout backtest improves the Brier score, and only
as a new version (ADR 0039).

**The margin divisor** is checked, not fitted: report the mean absolute error
of the expected margin. The UI shows a margin ("by about 4") only if the human
accepts that number.

## Running it

- **Deterministic replay:** every stored final game from 2003-04, in tip-off
  order, then `nba_game_id`. It reads only through
  `app.events.service.final_games(session, from_season)`.
- About 30,000 games run in seconds in pure Python, so each batch run replays
  everything in memory. It writes the `team_ratings` rows that are new; when a
  stored past row differs (a resolved correction), it rewrites that model's
  rows and logs it.
- Each run then upserts an `open` prediction for every scheduled game with both
  teams decided and a tip-off within 7 days that hasn't passed. Its `inputs`
  hold both ratings, `H`, and the last game included.
- A team whose previous game isn't loaded yet gets a prediction from older
  ratings. The next load's run refreshes it before tip-off, and if none comes,
  the stale forecast is the one recorded (ADR 0039).

## Backtest method

- **Walk forward** over Kaggle history: each game is predicted from the ratings
  as they stood before it, then the ratings are updated.
- **Burn-in:** 2003-04 and 2004-05, never scored.
- **Scored:** 2005-06 to 2025-26, 21 seasons, about 26,000 games.
- **No fitting:** the parameters come from the published method, so the record
  is out of sample in time and in parameters. Any tuned version fits on
  2005-06–2014-15 and reports only 2015-16–2025-26.
- **Metrics:**
  - accuracy (the favourite won; `p = 0.5` exactly counts as half);
  - Brier score, with 0.25 for a coin flip and the home-win-rate baseline beside
    it;
  - log loss (for track 44);
  - calibration in bins by the favourite's probability: 50–55, 55–60, …,
    85–90, 90–100, each with n.

  Splits: regular season and playoffs, and per season, for a sanity table in
  the PR, not the UI.
- **Reproducible:** `scripts/predictions_backtest.py --model elo-mov-1` runs
  locally against a full load (port 5433). The batch Lambda runs the same code
  when a model version is registered and stores the `prediction_backtests` row
  with `code_ref`.
- **Expected:** NBA Elo usually picks about two-thirds of winners. The backtest
  decides the number shown; don't quote it before it runs.

## Wording (proposal for tracks 42–43)

> **Our prediction** — Boston 64 %. Our model rates teams from past results
> only (no player or injury data). Tested on 21 past seasons (2005-06 to
> 2025-26, 25,9xx games), each forecast made only from games before it: the
> favourite won 6x %. When we gave a team 70–80 %, it won 7x % of 3,1xx games.
> Since launch (date): x of y (z %).

The numbers are filled from `GET /predictions/model`, never typed in.
