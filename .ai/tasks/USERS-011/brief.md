# USERS-011: usernames unique regardless of case

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Follow-up to track 4 (`USERS-010`). `UNIQUE(username)` is case-sensitive, so
`Raptors` and `raptors` can both exist: a look-alike the username rule doesn't
close (`wiki/CodeContext/FrontendUI/typography.md` §1). The human chose a
database unique index on `lower(username)` over a pre-check on create (ADR 0042).
Display is unchanged: names are stored and shown exactly as typed
(ADR 0010). Only uniqueness ignores case.

## Design

- **The database enforces it.** `create_user` already leaves duplicates to the
  unique constraint and maps `IntegrityError` to the generic 409, with no
  pre-check (a pre-check would be a TOCTOU race). The new index raises the same
  `IntegrityError`, so `routes.py` and `service.py` don't change.
- **Keep `UNIQUE(username)`.** The new index makes it redundant, but dropping
  it is churn with no benefit. Leave it.
- **Every row counts, deactivated ones too.** A deactivated user's exact name
  is reserved today, and the index reserves all its case variants the same way.
- **`lower()`, not `citext`.** No extension and no column type change. Every
  name the rule admits is ASCII, so `lower()` is collation-independent for
  them. Grandfathered non-ASCII names fold by the database collation, which is
  acceptable for a uniqueness check.

## The migration and production data

No session can query production, so nobody knows yet whether case-only
collisions exist. The migration is the check: `upgrade()` looks for colliding
groups first. If it finds any, it raises with the group count and the user ids,
never the usernames, because the Lambda's error reaches CloudWatch. Alembic runs
the upgrade in one transaction (`alembic/env.py`), so a failure leaves the
schema unchanged. `app.migrate` raises `MigrationFailed`, so the invocation
shows as failed, and the human decides what to do with the ids. Without the
index the app behaves exactly as it does today, so a deploy whose migration
hasn't run, or has failed, causes no 500s.

`CREATE UNIQUE INDEX` (not `CONCURRENTLY`, which can't run inside the
transaction) blocks writes to `users` for as long as the build takes, which is
a moment at this table's size.

## Traps

- `Base.metadata.create_all` builds the test schema, so the model's
  `__table_args__` must declare the index or the route tests stay green for the
  wrong reason. `__table_args__` already holds `ix_users_search_vector`. Add to
  that tuple, don't replace it.
- The migration test has to put the schema at `f2b8d4a6c9e3` before inserting
  the colliding rows (`command.upgrade(cfg, "f2b8d4a6c9e3")`). Insert only the
  columns `users` requires (`cognito_sub`, `username`, `date_of_birth`).
- Existing tests that create two users whose names differ only by case (for
  example `alice` and `Alice` in fixtures) would go red for the wrong reason.
  Grep for them and rename them in the red commit.
- Backend proof is CI's backend-test. Testcontainers can't start the Reaper on
  this machine.
- Roles: the tests are `test_agent`, `models.py` and the migration are
  `code_agent`, and the module docs are `context_maintainer`. Guard-check each
  commit by its role.
