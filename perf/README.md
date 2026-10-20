# perf/: the local load test

A k6 load test of the site's main read and write paths. It reports P95 and P99
latency per endpoint. For the `load` profile it fails when either one regresses
past a set percentage against **the previous `load` run on the same machine**. It runs entirely locally and
generates no AWS or Cognito traffic. Unit PERF-001.

## What it measures, and what it does not

It measures the application and database code paths: slow queries, N+1s, missing
indexes and serialisation. It runs uvicorn against its own Postgres, seeded with
synthetic data.

It does **not** measure production latency. There is no API Gateway, no Lambda
cold start, no CloudFront and no network hop to RDS. So it is a **local
regression gate, not a production SLO**. A number from it is only ever compared
with an earlier number from the same machine, and never with a production
target. It does not test the deployed site or frontend rendering.

## Run it

From the repository root, with Docker running:

```powershell
powershell -File perf/run.ps1 -Profile smoke
```

`-Profile` takes `smoke`, `load` or `stress`. The optional `-MaxRegression <percent>`
sets the regression limit for `load` (default 20). The script works in Windows PowerShell
5.1 and in pwsh 7.

`run.ps1` does these steps in order:

1. It mints 300 ID tokens and their JWKS into `perf/results/` with
   `backend/scripts/mint_perf_tokens.py`. It generates a fresh RSA key each run,
   and the private key is never written down.
2. It brings up `postgres-perf` and `backend-perf` (the compose `perf` profile)
   and waits for `/health`. `backend-perf` serves on host port
   `${BACKEND_PERF_PORT:-8002}`.
3. It seeds the database with `backend/scripts/seed_perf.py`: 300 users, 30
   teams, 600 games, 20,500 posts, plus follows, likes and game mentions.
4. It runs `fanwire.js` in the compose `k6` service.
5. For `load` only, it compares the run with the baseline using
   `backend/scripts/perf_compare.py`. For `smoke` and `stress` it prints that the
   comparison is skipped, and k6's exit code alone decides the result.
6. It always runs the teardown, even on failure.

It exits non-zero when a k6 threshold fails, when a `load` endpoint regresses,
or when any step fails.

### Profiles

| Profile  | Shape                                                        | Judged by |
|----------|--------------------------------------------------------------|-----------|
| `smoke`  | 1 VU for 1 minute: checks every path works                   | k6 thresholds and error rate |
| `load`   | 20 VUs, steady, for 3 minutes: the one to compare before a deploy | k6 thresholds and the baseline comparison |
| `stress` | ramps 0 → 150 VUs over 4.5 minutes, aborted once `http_req_failed` crosses 1% | k6 thresholds |

Only `load` is compared with a baseline. `smoke` gives about 50 samples per
endpoint, so its p99 is roughly the single slowest request and any hiccup reads
as a regression. `stress` aborts, so its duration varies from run to run.

## How virtual users sign in

The backend accepts tokens signed by the local key only when `ENVIRONMENT` is
exactly `perf` and `PERF_JWKS_PATH` is set. `app.settings.Settings` refuses
`PERF_JWKS_PATH` anywhere else, and `infra/test/perf-env.test.ts` proves that no
deployed Lambda sets either variable. Every check the Cognito verifier makes
still applies: RS256 only, the required claims, `token_use` `id`, and the perf
issuer and audience. VU *n* uses token *(n-1) mod 300*, so it is
`perf-user-<((n-1) mod 300) + 1>`.

## Scenarios

Each iteration runs one scenario. The scenarios are weighted like real use:
mostly reads, with a small share of posting. Every request is tagged with its
`endpoint`.

| `endpoint`        | Request                     | Weight |
|-------------------|-----------------------------|--------|
| `feed`            | `GET /feed` (signed in)     | 8      |
| `game`            | `GET /events/games/{id}`    | 4      |
| `profile`         | `GET /users/{id}`           | 3      |
| `search_posts`    | `GET /search/posts?q=`      | 2      |
| `search_accounts` | `GET /search/accounts?q=`   | 1      |
| `post_create`     | `POST /posts`               | 2      |

Post text is unique per VU and iteration and contains no link, because the
duplicate-content check and the spam scorer would refuse it otherwise. `setup()`
finds the game ids and user ids from the API instead of hardcoding them. It then
warms the backend up with ten rounds of every scenario. Those requests are tagged
`warmup`, so they stay out of every endpoint's numbers. Iterations are 0.1 s
apart: the test measures latency under concurrency rather than a person's
reading time, and more samples make each endpoint's P95/P99 steadier.

Each endpoint has its own thresholds: p(95) under 500 ms, p(99) under 1000 ms,
and at least one request. The whole run must also keep `http_req_failed` under
1%. These limits are deliberately generous, because the real gate is the `load`
comparison.

## Results and the baseline

Everything is written to `perf/results/`, which is git-ignored:

- `summary-<profile>.json` is the k6 `handleSummary` output of the latest run.
  k6 writes it even when a threshold fails.
- `baseline-load.json` is the `load` run the next one is compared against.
  **The first passing `load` run becomes the baseline.** A failed run never
  becomes a baseline. Later runs never overwrite the baseline. `smoke` and
  `stress` have no baseline and never write one.
  - To re-baseline, for example after a deliberate change or on new hardware,
    delete the file and run again.
- `tokens.json` and `jwks.json` come from the latest mint.

The baseline is per machine. That is the point, because the gate compares the
same hardware. A baseline copied from another machine means
nothing.

The comparison fails when any endpoint's p95 or p99 is more than
`-MaxRegression` percent slower than the baseline. It also fails when an
endpoint in the baseline is missing from the run. An endpoint that is new in the
run passes, and is reported as new. Local runs are noisy, so run `load` on a
quiet machine.
