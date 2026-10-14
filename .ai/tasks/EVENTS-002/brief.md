# EVENTS-002 — load the live database: data bucket and SportsDataLoad

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

The live database has no teams or games. `EVENTS-004` built the loader
(`app.events.nba_history`) and `EVENTS-005` (#146, merged 2026-10-14) paged
`GET /events/games`, so a full load no longer breaks the API's 6 MB response
limit. What is missing is a way to run the loader against RDS. RDS sits in
isolated subnets, and no session ever points a loader at it
(`Prompts/06-nba-data.md` "Limits"). So the loader runs as a Lambda on the
shared image, the same way `Migration` runs `alembic upgrade head`, and the
human invokes it.

`Prompts/06-nba-data.md` "`EVENTS-002`" has the plan. The human decided two
things on 2026-10-14:

1. **A new private bucket**, not a prefix of an existing one. The quarantine
   bucket has GuardDuty scanning and expiring lifecycle rules, and the public
   media bucket is a CloudFront origin.
2. **`seasons` is required.** An event without it is refused, so a full
   reload has to be asked for on purpose (all 23 seasons listed).

## What 'done' looks like

- A `SportsDataBucket` in `Fanwire-Storage` and a `SportsDataLoad` function
  in `Fanwire-App`, both synthesising, with every infra test green.
- `app.events.load_handler.handler`: it validates the event, takes the
  advisory lock, downloads the four files to a temporary directory, runs
  `load_nba_history`, returns the report and always cleans up.
- A runbook in `build-deployment.md` that the human follows after the deploy.
- A `0x02-events.md` section on the function, and a line in
  `0x00-architecture.md` "AWS account state" if the unit changes what the
  account holds.

## Sizing (measured by the Director, 2026-10-14)

Measured on a local Docker Postgres from a Windows host, with the dataset of
2026-06-15:

| Run | Time | Peak working set |
|---|---|---|
| one season (2025-26) | 18 s | 99 MB |
| 2003-04 to 2025-26 | 73–139 s | 709 MB |

The four files are 437 MB on disk. `PlayerStatistics.csv` alone is 390 MB,
and the dataset grows each season. This is why the function gets 1024 MB of
ephemeral storage (the 512 MB default is too small) and 2048 MB of memory,
which is about three times the full run's peak and also buys CPU. A full run
inside a 15-minute timeout is likely, even on `db.t4g.micro`. The runbook
still has the human load one season first and read its time before running
the rest.

## Known constraints

- **Same image, different `cmd`**, through `backendFunction`, like
  `Migration`. Do not add a second image or a Dockerfile stage. `boto3` is
  already a backend dependency.
- **Nothing invokes it.** Extend the invoker sweep in `app-stack.test.ts`
  ("App stack: migration runner") to cover the new function. Keep its
  positive control.
- **One grant.** `s3:GetObject` on `arnForObjects('nba-eoin/*')`. The
  function knows the four file names, so it needs no `ListBucket`. The CMK
  that encrypts the bucket is the one `DecryptEnvironmentAndData` already
  names: the storage stack imports `data.key`. Check this rather than assume
  it. If it is a different key, add `kms:Decrypt` for that key only.
- **The network is already in place.** Lambdas run in the app subnets, and
  `Fanwire-Network` gives those subnets an S3 gateway endpoint. Confirm that
  no endpoint policy blocks the new bucket.
- **No IAM file changes.** `cdk-cfn-exec-role-policy.json` already grants
  `s3:*` and `lambda:*`, and the role boundary allows `s3:GetObject*`. If the
  unit finds it needs a change under `infra/iam/**`, it stops and reports.
  That is a Director PR and a human rollout before any deploy
  (`build-deployment.md` "The live-IAM check").
- **Validate before side effects.** Validate the event before calling
  `boto3` or opening a connection, and test it with a client that fails if it
  is called. Reuse `nba_history`'s own season validation; do not write a
  second rule.
- **The advisory lock is required, not optional.** The AWS CLI's default
  read timeout is 60 s, and on a timeout it retries the invocation, which
  starts a second, concurrent load. The lock makes that second load fail
  fast. The runbook also sets `--cli-read-timeout 900` and
  `--cli-connect-timeout 60`. Use a lock key distinct from `app.migrate`'s,
  named as a constant.
- **Never emit `DATABASE_URL`.** `app.migrate` explains why (Lambda prints the
  whole exception chain) and how (`raise ... from None` with a redacted
  message). Reuse its redaction. Making `_redact` public in `app/migrate.py`
  is in scope, and the migrate tests must stay green.
- **Raise on failure.** Never return `{"ok": false}`: the console shows that
  as a successful invocation.
- **Settings.** Read `SPORTS_DATA_BUCKET` through `app.settings.Settings`
  (optional there; the handler fails fast when it is unset), built at
  invocation time like `app.migrate`, never through the cached accessor.
- **Tests.** Use moto for S3 (see `tests/test_moto_s3.py`), the shared
  Postgres from `tests/conftest.py`, and the synthetic dataset in
  `tests/fixtures/nba_data/`, never the real dataset.
- **PowerShell 5.1 strips the double quotes from a JSON argument passed to a
  native exe.** The runbook writes the event to a file
  (`Set-Content -Encoding ascii`) and passes `--payload fileb://<path>`.
- **No migration.** The tables exist since `d9f3b6a1e2c4`. The PR still says
  plainly that this deploy adds no migration, and that the load is the
  human's step after it.

## Not in this task

A scheduled or automatic refresh (`EVENTS-008`), downloading from Kaggle,
any frontend, and running the load against the live database. The human
does that, following the runbook, after the deploy.
