# INFRA-007: RDS on Postgres 18

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why 18, not 19

ADR 0036 says 18. Renovate's `postgres runtime` group now offers the docker tag 19, so
`Prompts/31` unit 6 asked for a probe first. `aws-cdk-lib` 2.277.0 (the lockfile's) has
`PostgresEngineVersion` up to `VER_18_3` and no `VER_19` (the `VER_19_*` names in
`instance-engine.d.ts` are Oracle 19c). The brief's rule for that case: do 18 and hold the
docker tag below 19: `allowedVersions: "<19"` on the `postgres runtime` rule in
`.github/renovate.json`, so Renovate re-offers 18. That is a Director edit of its own,
landed before the human ticks the group (not in this spec's PR).

## What changes, and what does not

- `VER_16` becomes `VER_18`, with `allowMajorVersionUpgrade: true`. CloudFormation upgrades
  an `AWS::RDS::DBInstance` in place when `EngineVersion` moves ("some interruption"), not
  by replacement; the test pins the logical id, so a replacement would be red.
- There is no custom parameter group, so the default group follows the engine family.
- The one extension the schema uses is `unaccent` (alembic `e6b2f8a4c7d1`), which RDS
  Postgres 18 ships.
- Local Postgres has no volume, so Postgres 18's image moving `PGDATA` changes nothing.
- `backend/tests/conftest.py:65` is the suite's real database (one testcontainers server).
  `docker-compose.yml`'s two `postgres:16-alpine` come in Renovate's PR.

## Not checked here: whether RDS takes 16 straight to 18

The Director has no AWS CLI. Before approving the deploy, the human reads the live minor
version and checks that 18 is a `ValidUpgradeTarget` for it in `ca-central-1`. If it is
not, hold the deploy and come back: the route is then 16 to 17 to 18, two units.

## Traps

- Commit by role: the infra test as `test_agent`, `data-stack.ts` as `code_agent`,
  `conftest.py` as `test_agent` (it makes nothing red, so it lands with the
  implementation as its own commit), the wiki as `context_maintainer`.
- On the Director's machine the backend container's database tests cannot start
  testcontainers' Reaper (on `main` too). CI's `backend-test` is the proof for 18.
- `deletionProtection` stays on: a major upgrade does not need it off.
