---
type: prompt
---

# 41 (part) — The Elo model: specification and backtest method

Part of [`41-predictions-3-elo-model.md`](41-predictions-3-elo-model.md). A
proposal until track 41 lands it in `0x09-predictions.md`. Disclosure rules:
[ADR 0039](../Decisions/0039-our-prediction-disclosure-and-immutability.md).
Dated 2026-11-19.

## Sources

The parameters are FiveThirtyEight's published NBA Elo method, Nate Silver
and Reuben Fischer-Baum, "How We Calculate NBA Elo Ratings" (2015). The site
is gone (its links redirect to `abcnews.com`). **The human pasted the archived
article on 2026-11-19, without its footnotes**, and the quotes below come from
that paste.

- "We found the optimal K for the NBA to be 20."
- "Home-court advantage is set as equivalent to 100 Elo rating points. One
  hundred Elo points is equivalent to about 3.5 NBA points."
- "In our NBA ratings, by contrast, they keep three-quarters of it":
  `(.75 * 1754) + (.25 * 1505) = 1692`.
- "Each franchise begins with an Elo rating of 1300 in its inaugural
  professional season."
- "They include both regular-season and playoff games", with no separate
  playoff parameter.
- "The system is zero-sum."
- "Teams retain their prior Elo ratings when they change cities or
  nicknames." 538 links the 1988–2002 Charlotte Hornets with New Orleans
  (today's Pelicans), so today's Charlotte franchise is the 2004 expansion
  team.
- The margin-of-victory formula is "in the footnotes", which the paste lacks.

**Not settled by the article**, so check against 538's own data rather than a
blog: the margin-of-victory formula, restated by
[DiPerna (2023)](https://luke-lite.github.io/blog/how-to-build-an-NBA-Elo-rating-system),
who says it matches 538's constants. 538's game-by-game file
([`fivethirtyeight/data`, `nba-elo`](https://github.com/fivethirtyeight/data/tree/master/nba-elo))
gives each team's rating before (`elo_i`) and after (`elo_n`) every game, with
the score and 538's forecast.

**Deliverable 0 of track 41** (no human step): replay a few hundred 2004–2015
games of that file with the formula below, starting from its `elo_i` values,
and require `elo_n` to match to 0.1. Then check that `forecast` matches the
win-probability formula with `H` = 100. A mismatch means the formula is fixed
until it matches, and the fix is recorded here. Keep the file outside the repo.

## Model `elo-mov-1`

| Element | Value | Source / status |
|---|---|---|
| Start | 1500 for every team at its first game from 2003-04 (our data begins there; 538's history from 1946 doesn't exist in it); a franchise whose first game comes later (Charlotte, 2004-05) starts at 1300 | 538 article (1300 for a new franchise); the 1500 start is ours, absorbed by the burn-in |
| Home advantage `H` | +100 to the home rating; 0 on a neutral floor (`game_type = 'cup-final'` only in v1) | 538 article; the article doesn't address neutral floors |
| Win probability | `p_home = 1 / (1 + 10^(−(R_home + H − R_away) / 400))` | standard Elo; checked against 538's `forecast` in deliverable 0 |
| K | 20 | 538 article |
| Margin-of-victory multiplier | `M = (MOV + 3)^0.8 / (7.5 + 0.006 × D)`, with `D` = winner's rating − loser's rating, home advantage included (negative for an upset, which raises `M`) | DiPerna; **checked against 538's data in deliverable 0** |
| Update | `Δ = K × M × (S − p_home)`, `S` = 1 for a home win and 0 otherwise; the home team gains `Δ`, the away team loses it | 538 article (zero-sum) |
| Between seasons | before a team's first game of a season: `R ← 0.75 R + 0.25 × 1505` | 538 article |
| Expected margin | `(R_home + H − R_away) / 28.6` points, home minus away | derived from the article's "100 Elo points ≈ 3.5 points"; stored, not shown in v1 |
| Expected total | not produced (`expected_total` null) | Elo has no scoring level |
| Playoffs, play-in | same parameters | 538 article (both included, no separate parameter) |
| Relocations | the franchise id carries its rating (Seattle→Oklahoma City 2008, New Jersey→Brooklyn 2012, the Charlotte and New Orleans renames) | 538 article; the loader keys teams by nba.com franchise id, which splits Charlotte and New Orleans the way 538 does |

**Not in v1, each a candidate for a later version:**

- rest and back-to-backs (538's later model had fatigue, travel and altitude
  terms; their values are unverified);
- neutral sites other than the Cup final (Cup knockout games in Las Vegas,
  international games);
- a points model for totals: each team's exponentially weighted points scored
  and allowed, relative to the season's average.

A candidate ships only if a holdout backtest improves the Brier score, and only
as a new version (ADR 0039).

**The margin divisor** (28.6) is checked, not fitted: report the mean absolute error
of the expected margin. The margin is stored but not shown in v1
([ADR 0040](../Decisions/0040-predictions-track-answers.md) item 10).

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
