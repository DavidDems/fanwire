# USERS-010: the username rule

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 4, deliverable 1 (`wiki/GeneralContext/Prompts/33-outstanding-work-4-backend-product.md`,
ADR 0035). `app/users/schemas.py` types `username` as a bare `str`, so `@Illini_1`
and `@lllini_l`, or a Cyrillic look-alike, are all accepted
(`wiki/CodeContext/FrontendUI/typography.md` §1, "The known cost"). The human chose
Instagram's rule: `^(?!.*\.\.)(?!.*\.$)\w[\w.]{0,29}$`, whole-string, ASCII-only. The
human's `g`/`m` flags are dropped on purpose: `m` lets a newline smuggle in a second line.

## Existing names: grandfathered (the human's decision)

The production database can't be queried from a session, so this spec assumes names
that break the rule exist. They are grandfathered:

- **Reads accept them.** `PublicUserOut`/`MeOut` keep `username: str`; nothing that
  reads a `User` row validates the name.
- **New writes enforce the rule.** The only write that sets a username is `POST /users`
  (`CreateUserRequest`). `UpdateMeRequest` has no `username` field, so there is no
  rename path to enforce it on. If one is ever added, it must apply the same validator.
- **Nobody is renamed.** No migration, no CHECK constraint (one would fail on the old
  rows), no backfill.

**Why grandfathering is safe.** The rule only narrows what `POST /users` accepts, so it
can't open a uniqueness or case-collision hole that isn't already there: uniqueness stays
the existing case-sensitive `UNIQUE(username)`. That `Raptors` and `raptors` can both
exist is true today and stays true; whether to add case-insensitive uniqueness is a
separate decision, not this unit's (ADR 0010: usernames are shown exactly as typed).
`seed_perf.py` inserts with SQL and is unaffected.

## The unit

- **Red first.** New tests in `backend/tests/users/` for the accepted and rejected
  lists, the exact `msg`, no row written on a rejection, and the grandfathering reads
  (insert a `User` row with a rule-breaking name such as `old-name.` directly through the
  session, then read it through the routes). Before committing, check every existing
  test that POSTs `/users`: a username that breaks the rule (a hyphen, an f-string like
  `user-{i}`) must be renamed in the red commit, or the implementation goes red for the
  wrong reason. Show that the red is exactly the new rule's tests.
- **Implementation.** One module-level `re.compile(..., re.ASCII)`, `fullmatch`, a
  `field_validator("username")` raising `PydanticCustomError("username_format", <msg>)`.
  Not `Field(pattern=...)`: pydantic's default regex engine is Rust's, which has no
  lookaround.
- **OpenAPI.** Regenerate `backend/openapi.json` the way `openapi-drift` does; a
  validator alone shouldn't change it.

## Traps

- `\w` without `re.ASCII` matches `é`, `ı` and full-width letters. The tests must catch
  dropping the flag (the non-ASCII rejections do).
- `$` matches before a trailing newline; `fullmatch` is what rejects `abc` + newline. Pin it.
- Backend proof is CI's backend-test: local testcontainers can't start the Reaper on
  this machine.
- Roles: tests are `test_agent`, `schemas.py`/`openapi.json` are `code_agent`, the module
  doc is `context_maintainer`. Guard-check each commit by its role.
