---
type: prompt
---

# 39 (part) — Predictions: product rules, abuse and legal research

Part of the predictions tracks (`39`–`44`). It holds the research behind
[ADR 0038](../Decisions/0038-picks-scoring-and-leaderboards.md) and the open
details the backend track settles. The data model, events and API are
[`39-predictions-data.md`](39-predictions-data.md); the Elo model is
[`41-elo-model-spec.md`](41-elo-model-spec.md). Dated 2026-11-19.

## What users pick (decided: winner only)

The model gives a win probability and an expected margin, so a later version
can score:

- **Margin buckets**: "wins by 1–5 / 6–10 / 11+", worth 5 bonus points, scored
  only when the winner is right.
- **A total**: higher or lower than the model's total. This needs a points model
  that Elo doesn't give (`41-elo-model-spec.md`). It is also the most
  betting-like pick, so word it as "higher or lower than our forecast", never
  "over/under".

Each one is a new pick type and a new ADR.

## Scoring (decided: flat plus a capped upset bonus)

ADR 0038 gives the rule and why. Facts for the implementation:

- Points if correct, by the model's probability `p` for the picked side:

  | p | 0.50+ | 0.45 | 0.40 | 0.35 | 0.30 | 0.25 | 0.20 | 0.10 | ≤ 0.00 |
  |---|---|---|---|---|---|---|---|---|---|
  | points | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 18 | 20 |

  Compute with `Decimal` and round half up, so 0.475 gives 10.5, rounded to 11.
  A test pins every column.
- **Gaming checks:**
  - Always picking the underdog loses expected points against an honest pick.
  - Always copying the model is the baseline anyone can reach. The boards show
    it as a ghost row ("Our prediction, if it picked every game"), so a user can
    see whether they beat it.
  - Picking every game earns more points than picking a few, which is intended:
    it is an engagement game, and accuracy is shown beside the points.
- **Community split** ("64 % of fans picked BOS"): decided (ADR 0040), shown
  only after the lock, so it never herds picks.

## Leaderboards (decided: month and season, global and following, Beat the model)

Decided where marked (ADR 0040); the rest are proposals for track 39 to
record in `0x09-predictions.md`:

- **Minimums (global only, decided):** 15 settled picks for the month, 50 for
  the season, and 10 disagreements for Beat the model. A user below the minimum
  sees their own row, marked "N more picks to qualify". Following boards have
  no minimum.
- **Order:** points, descending, with a shared rank on a tie. Inside a tie,
  rows are listed by accuracy, then username. Ties are never broken by time,
  because the picks of a night settle in the same run.
- **Beat the model:** settled picks where the stored `p` was below 0.5, ranked
  by net wins (won − lost) with a shared rank. Picks made with no prediction,
  or at exactly 0.5, don't count.
- **Who appears:** active accounts only. A deactivated or removed account is
  left out through the users interface (`users.lifecycle`), and so are its
  picks in the community split.
- **Computed on read:** one grouped query per board over the ledger and the
  picks, with an index on (season, game date). Expected size is thousands of
  users × ~1,300 games. Track 39 measures a seeded season (10,000 users,
  100 picks each) and materializes only if p95 passes 300 ms.

## Abuse cases

1. **Picking after tip-off.** The pick write is one statement, with
   `WHERE now() < lock_at` against the database clock. `lock_at` is computed in
   that request from the current schedule (naive US Eastern, converted with
   `zoneinfo`, never a fixed offset). A game that is already final is refused
   whatever the schedule says. A time-TBD game locks at 00:00 ET on its date
   (ADR 0039). Tests use a fixed database clock and both 2027 DST switches.
2. **Many accounts.** Nothing stops them today:
   - self-signups are auto-confirmed (`0x01b-users-auth.md`);
   - email verification never gates use (ADR 0031);
   - the only limits are WAF's 1,000 requests per IP per 5 minutes and the
     API stage throttle (`Standards/security.md`).

   The attack is to cover every combination of outcomes with many accounts, so
   that one of them is perfect. The minimums make that cost 2^N accounts for N
   picks. **Decided** (ADR 0040): global boards also need a verified email,
   which gates a public listing, not use, so ADR 0031 stands. Account
   lifecycle (track 6) adds no sign-up limit.
3. **Bots.** A per-user limit on pick writes (decided: 300 an hour, the same
   counting shape as `PostCountRateLimiter`), behind WAF. A bot that picks
   every game with the model only reaches the ghost row.
4. **Leaking picks.** Another user's open picks are hidden until the lock.
   After it, picks are public on the user's record. A pick a user chose to
   share is visible earlier, as their own choice.

## Legal (Canada and the U.S., not legal advice)

- **Gambling and lotteries need three things: a prize, chance and
  consideration** (payment). Remove one and the activity is generally outside
  the law.
  - Canada: Criminal Code s. 206, where commentators read every listed
    combination as needing all its elements
    ([AHBL](https://www.ahbl.ca/playing-by-the-rules-legal-considerations-concerning-promotional-contests-in-canada/),
    [Gowling WLG](https://gowlingwlg.com/en/insights-resources/articles/2023/demystifying-contest-laws-in-canada),
    [IMGL on Quebec](https://imgl.org/publications/imgl-magazine-volume-3-no-1/void-in-quebec-sweepstakes-contests-in-la-belle-province)).
  - U.S. states
    ([Sheppard Mullin](https://www.SheppardMullin.com/assets/htmldocuments/Make%20Sure%20Your%20Virtual%20Currency%20Doesnt%20Enter%20Illegal%20Gambling%20Territory1.pdf),
    [California gaming law](https://calgaminglaw.com/what-constitutes-gambling)).

  fanwire charges nothing and awards nothing of value, so it lacks two of the
  three.
- **Prize-contest rules don't apply without a prize:** the Competition Act
  s. 74.06 disclosure rules, Quebec's publicity-contest regime, and U.S.
  sweepstakes registration and bonding (New York, Florida) for large prizes.
  This is an inference from how those rules are framed; no source says it in
  those words.
- **What would change it:**
  - any prize, even merchandise or a gift card;
  - an entry fee, a paid boost or a paid extra pick;
  - points that can be redeemed, transferred or converted;
  - in-game credit that can be re-wagered (some states count that as a prize);
  - sportsbook ads or affiliate links (Ontario's AGCO advertising standards).

  Any of these needs counsel first.
- **What to verify:** the statute text (Justice Laws, s. 206) before launch.
  The sources above are law-firm commentary, and none addresses a no-prize
  game directly.

## FiveThirtyEight's method

FiveThirtyEight's site is gone. The human pasted its archived Elo article on
2026-11-19; it is quoted in `41-elo-model-spec.md` "Sources".
