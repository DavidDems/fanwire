---
type: decision
---

# 0039 - "Our prediction": disclosure, and no change after tip-off

Decision: 2026-11-19, the human.

## Context

Every game will show "Our prediction", the app's own forecast, as a
probability. A forecast is worth showing only if its record can be trusted: a
record that can be revised after the result, or an accuracy measured on games
the model was fitted to, would mislead. The first model is Elo with a
margin-of-victory adjustment (`Prompts/41`), and a machine-learning model may
replace it later (`Prompts/44`).

## Choice

1. **Written before tip-off, never changed after it.** Each prediction is
   stored with its model version before the game's scheduled tip-off. From
   tip-off on, its probability, margin and inputs cannot change. The database
   refuses the update, not only the code. Only its outcome may be recorded, or
   the row voided when the game is postponed or cancelled. A prediction that
   misses tip-off is never written late.
2. **Picks lock at the scheduled tip-off**, enforced on the server, against
   the database clock, in the same statement that writes the pick. A game whose
   start time is not set yet locks at 00:00 US Eastern on its date.
3. **Two records, shown separately, never merged:**
   - the **historical record**, out of sample: Kaggle history replayed forward
     from 2003-04, each game predicted only from ratings as they stood before
     it. Burn-in seasons are not counted, and the model's parameters are not
     fitted to the seasons it is scored on.
   - the **live record**: every prediction written before tip-off since the
     launch.
4. **What is shown:**
   - the share of games whose favourite won;
   - a calibration table ("when we said 70–80 %, the team won N % of N games");
   - the Brier score, with the 0.25 of a coin flip beside it;
   - the number of games and the seasons covered.
   A live sample under 100 games says so.
5. **Plain wording.** The page says what the model is (team ratings from past
   results, no player data), which seasons it was tested on, that the
   historical record is a backtest and not live, and that the live record
   starts at the launch. It never calls a forecast a tip or a lock, never shows
   sportsbook odds, and makes no claim beyond the measured numbers.
6. **A new model is a new version.** It ships only as a new model version
   with its own backtest, shown against the current one. The featured version
   changes only from a game's prediction onward, and each version's record
   stays visible under its own name.

## Consequences

- `model_predictions` carries a database trigger that refuses changes to a
  locked row's forecast columns, with tests that prove it (track 39).
- The backtest is a script plus a stored summary per model version, and
  anyone can rerun it from the public code and the CC0 dataset (track 41).
- The methodology page is part of the frontend tracks (`Prompts/42`, `43`).
