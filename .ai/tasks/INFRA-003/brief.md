# INFRA-003 — a production migration runner

## Why this exists

`alembic` is a runtime dependency, `backend/alembic/` is real, and
`docker/backend.Dockerfile`'s `lambda` target does not copy it or run it
anywhere. A real deploy today brings up RDS with **no tables in it** and four
Lambdas that expect the full schema.

Recorded as a known gap in `0x00-architecture.md` ("Still deferred … no
production migration runner exists") since Phase 4. It is now on the critical
path: `TODO/04-first-deploy.md` cannot reach a working API without it.

## Prerequisite the Director must land first

**`docker/backend.Dockerfile`'s `lambda` target must copy `alembic/` and
`alembic.ini` into the image.** `docker/**` is denied to the code agent on
purpose (dependency and build decisions are not retry-loop decisions), so this
task is **unsatisfiable until that lands**.

Check it before starting. If the image does not contain `alembic/`, stop and
report it rather than working around it — a handler that shells out to a file
that is not in the image is a green test and a broken deploy.

## The design, and the two decisions inside it

**Same image, different command.** All four existing functions share one
`DockerImageAsset` with per-function `cmd` overrides, for the reasons in
`build-deployment.md`. The migration runner is a fifth override, not a fifth
image. The acceptance criterion is written as "the template contains no second
image asset" because adding one is the easy wrong answer.

**Nothing invokes it automatically.** Not a CDK custom resource, not a rule, not
a schedule. A human invokes it once, after `cdk deploy`, before the API is
expected to work.

That is a deliberate choice against the more automated option. A custom resource
that runs DDL on every deploy makes every stack update a schema change, makes a
rollback ambiguous, and puts `alembic upgrade head` inside CloudFormation's
timeout and failure semantics. The cost of the manual step is one documented
command in the runbook; the cost of the automatic one is a class of outage.
Criterion 3 is written so that a later "improvement" to auto-invoke it fails the
build rather than shipping quietly.

**Reserved concurrency 1**, because two concurrent `alembic upgrade head` runs
against one database is a lock fight at best.

## Networking

RDS is in the data subnets and reachable only from the Lambda security group.
The migration function therefore needs the same VPC, the same app subnets and
the same security group as the api function — which also means it needs the same
six ENI actions, already covered by the `lambda-vpc-eni` allow-list entry. If
the IAM gate reports a *new* wildcard, read `infra-cdk`'s "IAM gate" section
before reaching for the allow-list; prefer a narrow hand-written statement.

## The handler

`backend/app/migrate.py`, running Alembic's API programmatically
(`alembic.config.Config` + `alembic.command.upgrade`) against
`Settings.database_url`. Not `subprocess`, which gives you an exit code and no
diagnostics.

It **raises on failure**. A handler that catches the exception and returns
`{"ok": false}` produces a successful invocation in the console, which is
precisely the signal an operator will read as "migrations applied".

It does not log the database URL. `DATABASE_URL` carries the password inline —
that is the known gap in `0x00-architecture.md`, and this function must not
widen it by writing the string to CloudWatch.
