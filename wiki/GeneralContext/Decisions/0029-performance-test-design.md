---
type: decision
---

# 0029 - Performance test design

Decision: 2026-10-20, the human (`PERF-001`).

## Context

A load test needs many signed-in virtual users and a body of games to read,
and the roadmap asked for a check "before a prod deploy". Real Cognito sign-ins test
Cognito and cap a run at a few users. Downloading the real game data makes a
run slow and keeps it out of CI. Timing on a shared CI runner is noise, and a
fresh runner has no baseline to compare with.

## Choice

- **Virtual users authenticate with a local test JWKS.** The verifier accepts a
  minted key's JWKS only when `ENVIRONMENT == "perf"`. It fails closed, and an
  infra test proves no deployed function sets it.
- **Hand-minted dev pool tokens are rejected**: they test Cognito and cap the
  run at a few users.
- **Games are synthetic**, under an id range no nba.com id uses, so a run needs
  no download and CI can run it.
- **"Before a prod deploy" gets both checks.** A line in the pull request
  template records the local `load` run and its result; that is the real gate,
  compared on the same machine. Beside it, an advisory, non-blocking CI job
  runs on pull requests touching `backend/app/`.

## Consequences

- The CI job is `perf-advisory` in `.github/workflows/test-agent.yml`. It runs
  the `smoke` profile, sits outside `gate`, is `continue-on-error`, holds no
  secret and never runs on `workflow_dispatch`.
- `infra/test/perf-env.test.ts` is the infra test, and `backend/app/settings.py`
  refuses a perf JWKS path under any other `ENVIRONMENT`.
- The PR template is `.github/pull_request_template.md`; the profiles and how to
  run them are `perf/README.md`.
