---
type: prompt
---

# 39 (part) — Predictions: data model, settlement, events and API

Part of the predictions tracks (`39`–`44`): the draft the backend tracks build
from. **A proposal until track 39 lands it**; the landed shape is then
`wiki/CodeContext/Modules/0x09-predictions.md` and this part stops being read.
Rules: [ADR 0037](../Decisions/0037-predictions-module-and-batch-lambda.md)–[0039](../Decisions/0039-our-prediction-disclosure-and-immutability.md).

## Keys

**`nba_game_id` is the game key**, stored as a plain bigint with no foreign
key.

- A pick is made while the game exists only in `scheduled_games`, and those rows
  are deleted and re-added when a season's file is replaced
  (`0x02b-events-loading.md` "The schedule").
- `games.id` only exists after the result.
- The scraper maps its own game ids to this same nba.com id (`38-results-scraper.md`
  deliverable 2).
- `ScheduleGameOut` and the game detail already expose `nba_game_id`.

Team and user columns are real FKs to `teams.id` and `users.id`, like
`users.preferred_team_id`.

## Tables (bigint identity keys everywhere)

| Table | Columns | Notes |
|---|---|---|
| `prediction_models` | `key` (unique, `elo-mov-1`), `name`, `description`, `params` jsonb, `code_ref`, `status` (`backtest`/`live`/`retired`), `featured` bool, `created_at` | Partial unique index: one `featured` row, the model shown as "Our prediction" |
| `prediction_backtests` | `model_id`, `first_season`, `last_season`, `games`, `accuracy`, `brier`, `log_loss`, `calibration` jsonb (bins: low, high, n, mean forecast, observed), `code_ref`, `ran_at` | One row per run; the page shows the latest for the featured model |
| `team_ratings` | `model_id`, `team_id`, `nba_game_id`, `game_date`, `season`, `rating_before`, `rating_after` | Unique (`model_id`, `team_id`, `nba_game_id`). Derived, so it can be rebuilt; not public record |
| `model_predictions` | `model_id`, `nba_game_id`, `season`, `home_team_id`, `away_team_id`, `tipoff_at` timestamptz, `home_win_prob` numeric(5,4), `expected_margin` numeric(5,1) (home − away), `expected_total` numeric(5,1) null, `inputs` jsonb, `computed_at`, `status` (`open`/`final`/`void`), `home_won` bool null | Partial unique (`model_id`, `nba_game_id`) where `status <> 'void'`. **Trigger:** once `OLD.tipoff_at <= now()`, only `status` and `home_won` may change, and only `open`→`final`, `open`→`void` or `final`→`void`; `DELETE` is refused. Before then, an upsert may refresh it |
| `picks` | `user_id`, `nba_game_id`, `season`, `game_date` (ET), `picked_side` (`home`/`away`), `picked_team_id`, `model_prediction_id` null, `model_prob` numeric(5,4) null (for the picked side), `points_if_correct` smallint, `status` (`open`/`won`/`lost`/`void`), `created_at`, `updated_at`, `settled_at` | Partial unique (`user_id`, `nba_game_id`) where `status <> 'void'`, so a rescheduled game can be picked again. Indexes: (`nba_game_id`, `status`), (`user_id`, `season`) |
| `points_ledger` | `user_id`, `pick_id`, `delta` (signed int), `kind` (`award`/`reversal`), `season`, `game_date`, `created_at` | Append-only. Index (`season`, `game_date`, `user_id`). A losing pick has no row |

There is no leaderboard table (ADR 0038).

## Settlement (safe to rerun)

One run, under an advisory lock (`PREDICTIONS_LOCK_KEY`, not the load's):

1. **Read** the open picks' and open predictions' games through
   `app.events.service.game_outcomes(session, nba_game_ids)`. It returns a final
   (teams, scores), a scheduled game (its current tip-off), or absent.
2. **Decide each game:**
   - **final**, with the same teams → `won`/`lost`, and the prediction becomes
     `final`;
   - **final with other teams**, **absent from both tables**, or **not final
     48 h after its lock** → `void`.
3. **Reconcile the ledger per pick.** The target is `points_if_correct` for
   `won` and 0 otherwise. If the ledger's sum differs, insert one entry with
   the difference. A second run inserts nothing.
4. **Corrections.** The loader never applies a changed final score silently
   (`GameConflict`). When the human resolves one, the next run moves the pick
   from `won` to `lost` and writes a `reversal`.
5. **Commit, then publish** one `PicksSettled` per user whose picks changed in
   this run.

"Refunded" means the voided pick counts for nothing and any award is
reversed; nothing was staked. A postponed game that comes back with a new date
reopens: picks are made again, and a new prediction is written. Proposal: a
scraper `postponed` status could void sooner. That would be a later events unit;
`38` doesn't expose one.

## Events

- **Consumed:**
  - `SportsDataLoaded` `{seasons, source, games_written}`, published by
    `app.events.load_handler` after its commit (track 40). The scraper's loads
    and the Kaggle refresh both publish it.
  - The `PredictionsDailyRun` schedule (proposal: 15:00 UTC, before the earliest
    tip-off), so predictions exist even on a day without a load.
- **Published:** `PicksSettled` `{user_id, won, lost, voided, points, season}`.
  `notifications/` adds the type `picks_settled`, in-app only, with
  `reference_id` null, and the click goes to the user's picks.
- **Feed:** a shared pick is a post whose `data_link` type is `pick`.
  - `ref_id` is the pick's id, validated by
    `app.predictions.service.validate_pick_link(session, pick_id, author_id)`:
    the author's own pick, not void.
  - It is previewed in batches by `pick_previews(session, ids)`, computed live,
    so a shared pick shows its result later.
  - `posts/` and `feed/` call only these functions.

## API contract (fixed by track 39, deliverable 1)

Every route is under `/predictions`, in the OpenAPI schema always, and answers
404 while `PREDICTIONS_ENABLED` is false. Guests can read but not pick.

| Route | Answer |
|---|---|
| `GET /games?season=&date_from=&date_to=&team_id=` | Per game: `nba_game_id`, `lock_at`, `state` (`open`/`locked`/`settled`/`void`), `our_prediction` {`model_key`, `home_win_prob`, `expected_margin`, `computed_at`} or null, `points_if_correct` {home, away}, `my_pick` or null, `community` (after the lock only) |
| `GET /games/{nba_game_id}` | One of the above; 404 if unknown |
| `PUT /picks/{nba_game_id}` `{side}` | 200 with the pick. 409 `{"detail": "pick_locked"}` after the lock or once final; 404 unknown game; 422 bad side; 429 over the limit |
| `DELETE /picks/{nba_game_id}` | 204 before the lock, 409 after it |
| `GET /me/picks?season=&state=&before_id=` | The caller's picks, newest first |
| `GET /users/{user_id}/record?season=` | `{won, lost, voided, points, accuracy, vs_model: {won, lost}}`, and settled picks only |
| `GET /leaderboards?board=points\|beat_model&period=month\|season&key=2026-11\|2026-27&scope=global\|following&before_rank=` | `{entries: [{rank, user, points, won, lost, accuracy}], me, minimum, model_row}`. `following` needs auth |
| `GET /model` | The featured model: `{key, name, description, backtest: {...}, live: {since, games, accuracy, brier, calibration}}` |

The frontend generates its types (`npm run gen:api-types`) from this
contract, so tracks 42–43 never wait on implementation.
