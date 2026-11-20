---
type: decision
---

# 0038 - Game predictions: what users pick, scoring and leaderboards

Decision: 2026-11-19, the human, choosing among the options researched in
`Prompts/39-predictions-design.md`.

## Context

Three scoring rules were compared for a pick game with no stakes.

- **Flat points** are easy to follow, but everyone picks favourites, so ties are
  common and skill barely shows.
- **Odds-weighted points** (a correct pick pays in proportion to 1/p, where p is
  the model's probability for the picked side) give every pick the same
  expected value under a calibrated model. Underdog picks therefore cost
  nothing on average and add variance, and on a leaderboard, where only the top
  matters, variance wins: short periods would be topped by people who always
  pick the underdog.
- **Confidence picks scored by a proper rule** (Brier or log) cannot be gamed,
  but they add a slider, give negative scores and are hard to explain.

## Choice

1. **Users pick the winner only** in version 1: home or away, one pick per user
   per game, changeable until the lock. Margin and total picks are later
   additions, each a new pick type with its own rule and its own ADR.
2. **Scoring: flat points with a capped upset bonus.** A correct pick earns
   **10 points**, plus an **upset bonus of `round(20 × (0.5 − p))`, at most 10**,
   when "Our prediction" gave the picked side a probability `p` below 0.5
   (rounded half up). A wrong pick earns 0, and nothing is ever deducted.
   - `p` is the prediction in force when the pick was last saved. The pick's
     value is shown when it is made, and fixed then.
   - A pick made while no prediction exists is worth 10.
   - At `p = 0.30` a correct pick is worth 14, so its expected value is
     0.3 × 14 = 4.2 points, against 7 for the 70 % favourite. Picking against
     the model pays only for someone who beats it.
3. **Points are non-monetary.** They can't be bought, sold, transferred,
   redeemed or exchanged for anything, and there are no prizes and no entry
   fees. Changing any of that needs a new ADR and legal advice first
   (`Prompts/39-predictions-design.md` "Legal").
4. **Leaderboards in version 1:**
   - Two periods: the **calendar month** and the **season**. A pick belongs to
     the period of its game's US Eastern tip-off date.
   - Two scopes: **global**, and **following** (the viewer and the people they
     follow).
   - A season **"Beat the model"** board: each user's won–lost record on the
     picks where they took the side "Our prediction" rated below 50 %.
   - Ranks are shared on a tie (1, 2, 2, 4). Global boards have a minimum
     number of settled picks to appear; the exact minimums are set in track 39
     and documented in the module reference.
   - Weekly, playoff and all-time boards are later additions.
5. **Points are kept in a ledger** of signed entries per pick, so a correction
   is a new entry, never an edit. Settlement is safe to rerun. A postponed or
   cancelled game's picks are **voided**: they count for nothing, and any
   points already awarded are reversed.

## Consequences

- The rule is a Strategy (`ScoringRule`) in `app.predictions`, so a later rule
  is a new class plus an ADR, not a branch.
- Picks store the model probability and the points value they were made with,
  so a board can always be recomputed exactly.
- Boards are computed on read in plain Postgres. A materialized table waits for
  a measured slow query.
