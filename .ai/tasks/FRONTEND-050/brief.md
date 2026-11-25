# FRONTEND-050: the username rule on the profile-setup form

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 4, deliverable 1, second half (`Prompts/33`, ADR 0035). USERS-010 makes
`POST /users` refuse a username outside the rule with a 422 on `username` and a plain
`msg`. `ProfileSetupPage` already routes a 422's `detail[].loc` to its field and shows
the server's `msg` verbatim (it was built for the age gate), so the rejection already
lands on the right control. What's missing is telling the member the rule before they
hit it.

## Decision (Director's default): a hint, not a second copy of the rule

The brief asks for "the profile-setup form's client-side message". The page's own header
comment says why it doesn't re-implement server rules: validating in two places is how the
two drift apart, and the server is the boundary. So the client-side message is a standing
hint, from `Field`'s existing `hintText` (as the date of birth already has), and the
server's message on the field after a rejection. There's no regex, `pattern` or
`maxLength` in the page. The cost is one round trip for a bad name, at a once-per-account
form.

## The unit

- **Red first:** the hint's text and its presence in the input's accessible description,
  before and after a rejection; the 422 pin with USERS-010's exact `msg`; and the
  `bundle-budgets/FRONTEND-050.ts` declaration (measure `ProfileSetupPage` on the
  implementation, then declare it in the test commit, since tests are frozen after).
- **Implementation:** `hintText` on the username `Field`, `hint: true` on its
  `describeField`, and the header comment.
- **Types:** `npm run gen:api-types`. USERS-010 should leave the OpenAPI schema unchanged,
  so expect no diff.

## Traps

- `prettier --write` on named files only: a glob also matches the committed test.
- `bundle-budgets/FRONTEND-050.ts` is under `src/test/**`: it's a `test_agent` commit.
- Run the frontend suite alone, in the foreground, sharded. A killed suite proves nothing.
- Rebuild the test image before the container run.
