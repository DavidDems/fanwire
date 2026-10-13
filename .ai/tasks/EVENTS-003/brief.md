# EVENTS-003 — retire the API-SPORTS path

## Why this exists

The human decided on 2026-10-13 (`Prompts/06-nba-data.md` "Decisions
already made") that the Eoin Moore Kaggle dataset is the one source of NBA
data, refreshed from the dataset, not from a live feed. The API-SPORTS path
never ran against a real response (`app/events/adapters.py`'s docstring), its
key is a placeholder, and keeping it means every later unit has to keep a
dead path working: the box-score table in `EVENTS-004` would otherwise have to
coexist with the adapter's JSONB `player_stats`. Removing it first makes
`EVENTS-004` a clean change.

## What goes, and what stays

**Goes (backend):** `adapters.py`, `factory.py`, `interfaces.py`,
`ingestion.py` (except what the loaders need, below), `proxy.py`,
`lambda_handler.py`, the live-score and API-SPORTS parts of
`events/dependencies.py`, the settings named in the criteria, the feed's
`LiveScoreView`, `live_scores` and `_live_scores_for_games`, and their tests.
`GameRef.api_sports_game_id` goes; `GameRef.date` stays only if `feed/` still
needs it.

**`UnrecognizedTeamError` stays**, because `app.events.nba_history` raises it.
Move it to a module that survives (e.g. `app/events/errors.py`) and keep
`nba_history`'s behaviour unchanged; `EVENTS-004` replaces that loader.

**Goes (frontend):** `features/feed/LiveScoreTickerDecorator.tsx`, its use in
`PostNode.tsx`, its tests and styles. This is a removal forced by the API
change, not new UI.

**Goes (infra), consumers only:** the `Ingestion` function, its
`CfnEventInvokeConfig`, the `IngestionRetryTrigger` mapping, the schedule and
its role and policy, and the api function's `LIVE_SCORE_CACHE_TABLE_NAME`
variable and DynamoDB grant.

**Stays (infra), deliberately:** the idempotency table, the live-score cache
table, the API-SPORTS secret and the ingestion-retry queue and DLQ.

## Things to get right

- **The export trap.** These resources are created in `Fanwire-Data` and
  `Fanwire-Messaging` and imported by `Fanwire-App` through CloudFormation
  exports that CDK makes automatically. If this unit removes both the
  resource and its last consumer, the deploy updates `Fanwire-Data` first,
  tries to delete an export that the *deployed* `Fanwire-App` still imports,
  and fails. Keep each export alive in the producing stack with
  `this.exportValue(...)` (same value, same logical id). Pin that with a test
  that the Outputs still exist. A later infra unit removes the resources and
  the exports once this one is deployed.
- **The migration.** Make `nba_*_id` NOT NULL, then drop the CHECKs and the
  `api_sports_*` columns. If any Team or Game row lacks an nba.com id, raise
  with a message that says which table and how many rows, and change nothing.
  The live RDS has no such rows (no game data was ever loaded there; the
  human checks `/api/events/teams` before deploying). A dev database that
  still holds `seed_dev.py`'s fixture rows fails here by design. The PR body
  tells the human how to clear them:
  `docker compose -p fanwire down -v` drops the dev volume, losing dev users
  and posts too; deleting only those rows is not possible once a post
  mentions one of those games.
- **`tests/test_migrations_nba_ids.py`** downgrades `-1` from head and will
  break once this migration is head. Re-point it at its own revision's
  parent, by name, in the **tests** commit.
- **`seed_dev.py`** creates only API-SPORTS-keyed Teams and Games. Either
  delete it or reduce it to nothing that touches events. `AGENTS.md` and the
  dev-setup docs name it: list every stale mention in the PR body (they are
  Director files).
- **`docker-compose.yml`'s `dynamodb-local`** may still be used by other
  modules' tests. Check before suggesting that it go; it is not in this
  task's paths either way.
- **Standards docs are not this task's to write.** No guard role may edit
  `wiki/CodeContext/Standards/**`, yet `gof-patterns.md` assigns Abstract
  Factory, Adapter, Proxy and Template Method to this path, and
  `aws-stack.md`, `security.md` and `build-deployment.md` describe the
  ingestion Lambda, the API-SPORTS secret and the live-score cache. List
  every stale passage in the PR body; a Director PR updates them after this
  merges. `media/`'s pipeline keeps Template Method.
- **`backend/pyproject.toml`** is no role's to write either. If a dependency
  is used only by the removed code, name it in the PR body rather than
  removing it.

## Not in this task

Deleting the Data and Messaging resources (the follow-up infra unit), the
new dataset loader (`EVENTS-004`), any new route.
