# INFRA-006: the zip Lambdas on Python 3.15

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 2, unit 5 (`wiki/GeneralContext/Prompts/31-outstanding-work-2-dependencies.md`,
ADR 0036). Renovate's `python runtime` group moves `setup-python` and the Lambda base
image (`public.ecr.aws/lambda/python`) to 3.15, but it cannot see the two
`lambda.Runtime.PYTHON_3_12` in `infra/lib/`. This unit moves those; the group's PR then
merges unchanged.

## What the Director probed (main 6060e4d)

- `aws-cdk-lib` 2.277.0 (the lockfile's) has `Runtime.PYTHON_3_15`.
- `public.ecr.aws/lambda/python:3.15` exists (Python 3.15.2). The backend test image built
  on it: dependencies install, `mypy app` and `mypy app --python-version 3.15` are clean,
  and the 722 tests that need no database pass, the same count as on 3.12. On this
  machine every database test errors at testcontainers' Reaper **on 3.12 too**, so CI on
  the Renovate PR is the proof for those.
- `ruff` gives the same result on 3.12 and 3.15.

## The unit

- **Red first:** the two existing runtime assertions flip to `python3.15`, and one sweep
  over every stack pins that no zip function of ours is left on another runtime. The
  Lambdas `aws-cdk-lib` adds itself (cross-region export writer and reader, bucket
  deployment) run on a runtime CDK picks, so the sweep names them as its only exceptions
  (this line was corrected at the track's close-out; the first wording missed them).
- **Implementation:** two lines.
- **The synth diff is the review.** Only `Runtime` on the origin-verify authorizer (App)
  and the pre-sign-up trigger (Auth) changes.

## Order with the Renovate PR

Independent: the zip functions and the image share nothing at deploy time. Merge this
unit first; then the human ticks `python runtime` on the dashboard and merges its PR once
CI (backend-test on the 3.15 image) is green. A Director PR then moves mypy's
`python_version` and the docs that name 3.12.

## Traps

- Guard-check the test commit as `test_agent` and the `infra/lib` commit as `code_agent`,
  from the unit's own worktree.
- Pre-sign-up is a Cognito trigger: a broken runtime there blocks sign-up. Its code is
  three lines with no imports.
