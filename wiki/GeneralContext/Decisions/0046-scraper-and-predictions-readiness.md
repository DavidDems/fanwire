---
type: decision
---

# 0046 - Scraper and predictions: readiness answers

Decision: 2026-11-27, the human, answering the Director's readiness review of
the scraper and predictions briefs (`Prompts/38`–`44`). Builds on ADRs
[0037](0037-predictions-module-and-batch-lambda.md)–[0040](0040-predictions-track-answers.md).

## Context

The briefs were written on 2026-11-19. Tracks 5 to 8, the final track and the
docs graph landed after that. The review checked every brief against `main`.
It found that only the results scraper (`38`) and the predictions tracks
(`39`–`44`) are documented and not built, apart from briefs parked for API cost.
It also found facts that had gone stale and two gaps:

- account deletion went live on 2026-11-26 and doesn't know about picks;
- brief 40's reserved concurrency contradicts the infra rule against
  reservations.

## Choice

**The human's answers**

1. **Tracks 39–42 run while the scraper is in shadow.** The scraper (`38`)
   needs at least 14 game days of shadow running before it loads. The
   predictions backend, batch, model and pick UI build and test on the
   Kaggle refresh's results meanwhile, with `PREDICTIONS_ENABLED` off. **Only
   track 43's launch unit waits for `38` to be live.** Settlement is timely
   only then.
2. **Briefs 12–15 are retired**: agent evals, the worker shell, the learning
   loop and the context graph. Each needed metered API runs (ADR 0035). The
   docs graph (track 49) built the doc half of 15. Git keeps their text, and
   reviving one takes a new brief. **Brief 44 stays parked** as the
   predictions follow-on.
3. **The daily Kaggle refresh is loading 2026-27** (the human, 2026-11-27).
   `38`'s shadow comparison and its schedule-file id mapping rely on it.

**Defaults the Director took, from rules already recorded (not asked)**

4. **Deleting an account removes its picks and ledger rows.** This is a new
   `app.predictions.service.remove_account_predictions(session, user_id)`,
   called from `app.account_deletion._cleanup` after `remove_account_posts`
   (a shared pick's post points at the pick) and before `remove_account_user`,
   the same way posts, media and notifications are removed. Boards and the
   community split are computed on read, so they lose the account with no
   other change.
7. **A shared pick is stored the way ADR 0030 stores attachments.** It is a
   nullable `posts.linked_pick_id` foreign key to `picks.id`, joined into
   `ck_posts_one_data_link` and `ck_posts_no_data_link_on_reply`. It is
   exposed as a `{"type": "pick", ...}` member of the `data_link` union. It
   is not a generic type-and-id pair. Only the author's own picks can be
   shared, so deleting an account removes the posts before the picks they
   point at.
5. **`PredictionsBatch` reserves no concurrency.** `0x00b` records why
   reservations are refused: they couple the template to an account quota.
   The settlement advisory lock (`PREDICTIONS_LOCK_KEY`) is what stops two runs
   overlapping, and the SQS event source's `maxConcurrency` (2, its minimum)
   bounds the number of invocations.
6. **The verified-email flag syncs from the ID token on authenticated
   requests.** The API already verifies only Cognito ID tokens, and those carry
   `email_verified`. The flag is written only when the claim differs from what
   is stored. That covers both sign-in and a verification made later, after
   the SPA refreshes its token.

## Consequences

- `29`'s order, the backlog's predictions rows and briefs `39`–`43` say
  "parallel with 38's shadow"; brief 43's launch unit has the start gate.
- `39` gains the deletion hook in its tables unit. `40` drops the reservation,
  and its shared-picks unit adds the column.
- The scraper's own ADR is the next free number after this one (`38`
  deliverable 1).
- `.ai/tests/test_prompt_lifecycle.py` moves 12–15 from parked to retired.
