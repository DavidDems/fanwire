---
type: decision
---

# 0037 - Game predictions: a `predictions` module and a batch Lambda

Decision: 2026-11-19, the human, answering the Director's predictions research
(briefs `Prompts/39`–`44`).

## Context

fanwire adds game predictions: before each NBA game users pick the winner, earn
points for a correct pick and are ranked on leaderboards, and every game shows
"Our prediction", the app's own forecast. The work is of two kinds. Requests
(make a pick, read a board) are small and per user. Computing ratings and
predictions and settling picks is batch work that must run after new results
are loaded, which the results scraper (`Prompts/38`, whose
first deliverable is ADR 0036) delivers within about an hour of a game ending. The project
already runs batch work as functions beside the API on the shared image:
`SportsDataLoad`, `SportsDataRefresh`, the notifications consumer
(`wiki/CodeContext/Modules/0x02b-events-loading.md`, `0x05-notifications.md`).

## Choice

- **A new `predictions` module inside the existing FastAPI app**
  (`backend/app/predictions/`), not a separate service. It owns its tables
  (picks, model versions, ratings, model predictions, the points ledger),
  every one with a bigint identity key.
- **It reaches other modules only through their interfaces**
  (`0x00-architecture.md` "Connection rule"): game results and the schedule
  through new `app.events.service` functions, follows and account state through
  `app.users.service`. It never imports another module's models.
- **Compute runs as a separate batch Lambda**, `PredictionsBatch`: the shared
  image, its own command and least-privilege role, in the VPC (it needs the
  database). It runs on a new `SportsDataLoaded` event that `SportsDataLoad`
  publishes on `PostEventBus` after its transaction commits, through an SQS
  queue with a DLQ, and on a daily schedule as a safety run. Each run settles
  picks, updates ratings and writes predictions for the coming games. Every
  step is safe to rerun.
- **`predictions` publishes `PicksSettled`** on `PostEventBus`, one per user per
  run. `notifications/` subscribes the same way as to `UserFollowed`, so it
  gains a notification type for settled picks (in-app only).
- **A shared pick is a post** with a new attachment type, validated and
  previewed through `app.predictions.service`, the same shape as the sports-data
  attachments of [ADR 0030](0030-post-deletion-deactivation-and-attachments.md).
- **Behind a switch.** `PREDICTIONS_ENABLED` (default off) keeps the routes in
  the OpenAPI schema but answers 404 until the frontend track switches it on.
- **Out of scope here:** whether a later machine-learning model runs in this
  Lambda, a container-image Lambda or an ECS task. The AI-model track
  (`Prompts/44`) decides that.

## Consequences

- Adds to the business rules: a predictions section, and a fourth notification
  type besides follow, reply and repost (`business-rules.md`, edited in
  track 40).
- The `events` module gains its first published event and read functions for
  results and the schedule; `posts/` gains an attachment type. Each is a unit
  of its own track (`Prompts/39`, `40`).
- New infra: one function, one rule each for the event and the schedule, one
  queue with a DLQ and its depth alarm. Idle cost is about zero.
- The scoring and leaderboard rules are [ADR 0038](0038-picks-scoring-and-leaderboards.md);
  the forecast's disclosure and immutability are
  [ADR 0039](0039-our-prediction-disclosure-and-immutability.md).
- The module reference will be `wiki/CodeContext/Modules/0x09-predictions.md`,
  created by the first unit that lands code.
