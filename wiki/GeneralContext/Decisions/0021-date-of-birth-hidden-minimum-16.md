---
type: decision
---

# 0021 - Date of birth: hidden, collected at profile creation, minimum 16

Decision: 2026-09-21, the human.

## Context

The business rules store a date of birth with each user's data. Two questions
followed: whether a public profile shows it, and when it is collected and
checked.

## Choice

- **Date of birth is never shown publicly.** It is held after registration and
  appears on no public profile.
- **It is collected at profile creation**, with a minimum age of 16. The date
  must be strictly in the past and the user at least 16 in whole years. A
  violation is a `422` at the API boundary.

## Consequences

- `USERS-002` implements the gate. The rule, and where the field is held, are
  [0x01-users.md](../../CodeContext/Modules/0x01-users.md) "Security".
- Not settled by this decision: rows created before the gate are not
  re-checked, and a self-declared date of birth is not age verification.
