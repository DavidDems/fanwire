# PERF-001 — a local load test with P95/P99 as a regression gate

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

This is the human's request (2026-10-19): the site's main paths under load, with P95 and P99, run before a
production deploy, **locally**, at $0 AWS. It is run from
`wiki/GeneralContext/Prompts/16-performance-tests.md`. The human made three decisions on 2026-10-20
(`wiki/GeneralContext/Architecture/human-decisions.md` §8):

- **Virtual users authenticate with a local test JWKS.** The alternative was hand-minted dev pool tokens.
- **Games are synthetic.** The Kaggle CSVs are not used.
- **"Before a deploy" gets both** a PR-template line and an advisory CI job. Both are in `.github/`, so a
  later Director PR adds them. They are not part of this unit.

**What a local number means.** A local P95 measures the application and database code paths: slow
queries, N+1s, missing indexes and serialisation. It does not measure production latency, because there
is no API Gateway, no Lambda cold start, no CloudFront and no network hop to RDS. So the gate compares a
run with the previous run **on the same machine**. It is never compared with a production target.

## What the Director already put in place (the spec PR)

- **The compose `perf` profile in `docker-compose.yml`:** `postgres-perf`, `backend-perf` and `k6`.
  `code_agent` is denied `docker-compose.yml` on purpose, because a new image is a supply-chain call. So
  this unit builds against the profile and does not edit it. If the profile is wrong, stop and say so.
  - `backend-perf` serves on host port `${BACKEND_PERF_PORT:-8002}`.
  - It sets `ENVIRONMENT=perf`.
  - It reads `PERF_JWKS_PATH=/var/task/perf-results/jwks.json`, with `./perf/results` mounted read-only
    at `/var/task/perf-results`.
  - It raises `POST_RATE_LIMIT_PER_MINUTE`/`_PER_HOUR` far above any run.
  - It bind-mounts `backend/app` and `backend/scripts`, so a run measures the working tree.
  - It runs uvicorn without `--reload`.
- **`k6`** is `grafana/k6:2.3.0`, pinned by digest. It mounts `./perf` at `/perf` and reaches the backend
  at `http://backend-perf:8001`.
- **`postgres-perf`** has no volume and no host port, so `down` discards it. Every run seeds from empty,
  which keeps runs comparable.
- `perf/results/` is git-ignored.
- `.ai/policy.json` lets `code_agent` write `perf/**`.

## The design

- **Fail closed, twice.**
  - A `Settings` validator refuses `perf_jwks_path` unless `environment == "perf"`, case-sensitive. A
    deployed Lambda sets neither variable today (`infra/lib/app-stack.ts`).
  - The infra test (an acceptance criterion) makes that a property of the synthesized template rather
    than of today's code.
- **Reuse the verifier, don't write one.** `CognitoTokenVerifier` already takes an injected JWKS. That is
  how `tests/users/test_auth.py` works. The perf path builds it from the file, with a perf issuer and
  audience, and reads the file once per process (cache it like `_default_token_verifier`).
  - `auth.py` is forbidden. Every RS256, claim and `token_use` check stays exactly as it is.
  - The issuer and audience are constants, shared by the mint script and the verifier wiring through one
    module the script can import (`app.users.dependencies` or a small module beside it).
- **The mint script needs no new dependency.** PyJWT and `cryptography` are already installed (the tests
  sign with them). The private key exists only in the script's memory: it signs the tokens and is gone.
  The tokens go to `perf/results/tokens.json`, which is git-ignored, and are never printed.
- **The seed** follows `scripts/dev_process_media.py`'s refusal pattern.
  - Use bulk SQL (`INSERT … SELECT … generate_series`) so tens of thousands of rows take seconds.
  - Back-date every perf user, so the spam scorer's new-account rule doesn't apply.
  - Use team and game ids from a reserved range no nba.com id uses, and document it in the script.
  - "Idempotent" means a marker check, for example "perf-user-1 exists", then a no-op.
- **The scenarios** each tag requests with `endpoint` and weight the mix like real use. Most traffic is
  reads: feed, game page, search, profile. A small share is post creation.
  - Thresholds start generous, around p95 500 ms and p99 1000 ms locally. The real gate is the
  comparison, not the absolute numbers.
  - A failed threshold still writes the summary JSON (`handleSummary`).
- **The comparison is a separate stdlib script** under `backend/scripts/`, so it is unit-tested in the
  backend container. It reads only the summary JSON, with no k6 dependency. The baseline is per profile
  (`perf/results/baseline-<profile>.json`) and is local to the machine. That is the point: the gate
  compares the same hardware.
- **`run.ps1`** works in both Windows PowerShell 5.1 and pwsh 7, so the later CI job can call it on
  `ubuntu-latest`.
  - Run `docker compose --profile perf down` in a `finally` block.
  - The order matters: mint first, because the backend reads the JWKS on its first verify. Then up,
    then wait for `/health`, then seed, k6 and compare.
  - Exit non-zero on a k6 threshold failure or a regression.

## Amendment, 2026-10-20: the gate compares `load` only

**The human decided this after the first hand-run smoke runs.**
- **What happened.** Two smoke runs back to back, on unchanged code, failed the comparison: `post_create` p99 went from 24 to 84 ms, and `feed` p99 from 53 to 79 ms.
- **Why.** 1 VU for 1 minute gives about 50 samples per endpoint, so its p99 is roughly the single slowest request. Any hiccup on a busy machine reads as a regression.
- **The decision.**
  - smoke is a sanity run, judged by its thresholds and error rate only.
  - stress is judged by its thresholds only. It aborts, so its duration varies.
  - Only `load` is compared with its baseline.

The teardown is limited to the perf services (`rm -fsv` then `down` on `postgres-perf`, `backend-perf` and `k6`). A bare `--profile perf down` would also stop a running `backend-dev`, and without `-v` it leaks the throwaway database's volume on every run.

## Traps

- **`DuplicateContentCheck` refuses repeated text from one author**, so post text must be unique per VU
  and iteration.
- **The spam scorer refuses a link from a new account and three links from anyone.** Post text has no
  link.
- **Some tests scan the whole tree.** Run the full backend suite, not only the new files.
- **Windows bind mounts make every file look executable**: use `ruff check --extend-ignore EXE002` inside
  the container.
- **Never point k6 or `run.ps1` at `fanwire.daviddems.com` or any AWS endpoint.**

## Not in this task

- The PR-template line and the advisory CI job (a Director PR, after this one).
- Any production SLO.
- A deployed-site test.
- Frontend rendering performance.
- Any infra change beyond the one test.
