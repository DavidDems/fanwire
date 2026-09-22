# USERS-002 — minimum age 16 at profile creation

## Why this exists

The human answered the open question in
[`TODO/03-open-decisions.md`](../../../TODO/03-open-decisions.md) §4 on
2026-09-22: **date of birth stays at profile creation, age must be a positive
value, minimum 16 years.** Nothing enforces any of it today.

`backend/app/users/schemas.py` declares `date_of_birth: date` on
`CreateUserRequest` with no constraint, so `POST /users` currently accepts:

- a birthdate of last year (a one-year-old), and
- a birthdate in 2030, which yields a **negative** age.

16 rather than 13 was chosen deliberately: it avoids the parental-consent
regime under GDPR in the strictest EU member states. It is the stricter of the
two defaults that were on the table.

## Where the rule belongs

At the API boundary, in the Pydantic schema — not in the route body, not in
the service layer, and not only in the browser.
[`design-principles.md`](../../../wiki/CodeContext/Standards/design-principles.md)'s
"validate at boundaries only" means the boundary is authoritative and the form
is a courtesy. A Pydantic validator also produces the `422` with the field name
already attached, which is acceptance criterion 5 for free.

## The edge case that matters

"At least 16 years old" is **whole years on the day of the request**, not
`today - dob >= 16 * 365`. Someone whose 16th birthday is tomorrow is not 16
today, and leap years make the days-based version wrong roughly one year in
four. Compute it calendar-wise.

The test for this is the one-day-short case (criterion 2), and it is the test
most likely to be written loosely. Pin the boundary on both sides: exactly 16
passes, one day short fails.

## What is deliberately out of scope

- **Existing rows.** Nothing backfills or re-validates profiles created before
  this. `backend/app/users/models.py` and `backend/alembic/**` are in
  `forbidden_paths` for that reason: this is a boundary rule, not a migration.
- **The frontend.** There is no registration form yet — the frontend is a
  scaffold. When Phase 5a builds one it should mirror the rule for the error
  message, and that is a separate task.
- **Age *verification*.** A self-declared date of birth is a checkbox, not a
  guarantee. That is the industry norm and what was asked for here.

## Notes for the test agent

`backend/tests/users/` already exists; read its sibling files for the fixture
style before adding a new one. Dates relative to "today" must be computed in
the test, never hardcoded — a test that hardcodes `2010-09-22` starts failing
on its own in 2026.

## Notes for the code agent

`CreateUserRequest` is the only schema in scope. Do not touch `MeOut`,
`PublicUserOut` or the DOB-privacy behaviour — criterion 6 is a regression
guard asserting you left it alone, and
[`0x01-users.md`](../../../wiki/CodeContext/Modules/0x01-users.md)'s Security
section is the rule it protects.
