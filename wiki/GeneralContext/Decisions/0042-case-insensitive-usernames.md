---
type: decision
---

# 0042 - Usernames are unique regardless of case

Decision: 2026-11-25, the human, answering the Director after Outstanding-work
track 4, after [ADR 0035](0035-outstanding-work-answers.md) "Usernames".

## Context

Track 4's username rule (`USERS-010`) limits new names to ASCII letters, digits,
`_` and `.`, which removes non-ASCII look-alikes. Uniqueness was still the
case-sensitive `UNIQUE(username)`, so `Raptors` and `raptors` could both exist,
a look-alike the rule doesn't close (`FrontendUI/typography.md` §1). The rule's
form also needed a decision: show it as a hint, or check it in the browser too.

## Choice

- **A database unique index on `lower(username)`** (`USERS-011`), not a
  pre-check on create, which two simultaneous sign-ups could both pass, and not
  leaving uniqueness case-sensitive. Every row counts, deactivated ones too, as
  the exact-name constraint already does.
- **Display is unchanged.** Names are stored and shown exactly as typed
  ([ADR 0010](0010-lowercase-brand-name.md)). Only uniqueness ignores case.
- **Existing collisions are not resolved silently.** If production already
  holds names that differ only by case, the migration fails with their user
  ids and changes nothing, and the human decides what happens to them.
- **The form shows the rule as a hint only** (`FRONTEND-050` as built). The
  server is the one place the rule is checked, so there's no second copy to
  drift and the bundle doesn't grow.

## Consequences

- One Alembic revision. After the deploy, the human runs the Migration Lambda.
  The app works the same before it runs.
- A case-only duplicate on `POST /users` answers the existing generic 409, whose
  copy on the profile-setup form already fits.
