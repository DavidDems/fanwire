# AUTH-001: native Cognito password reset, finished

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Rewritten in track 6 (2026-11-25)

This spec replaces the research-gated one. The human decided ([ADR 0035](../../../wiki/GeneralContext/Decisions/0035-outstanding-work-answers.md),
`Prompts/22` "Reset: native Cognito only") that reset stays the shipped
frontend's direct Cognito `ForgotPassword` and `ConfirmForgotPassword`, with the
code Cognito emails to the verified address, plus a static verify reminder. The
old spec's stop gate, provider-evidence proof, operation records, revocation
and trigger work are all dropped, not deferred. `AUTH-002` and `AUTH-003` are
dropped. The parked experiment was not shipped; it was deleted after this unit
merged (#119).

## What exists today

- `ForgotPasswordPage` already has both steps on one route, keeping the
  address between them, and `SignInPage` links to it.
- The pool has `preventUserExistenceErrors: true` and
  `accountRecovery: EMAIL_ONLY` (`infra/lib/auth-stack.ts`), so Cognito
  already answers an unknown address as if it were known. The page still maps
  `UserNotFoundException` to "There is no account for this email address.",
  which is wrong in spirit; it goes.
- There is no Confirm password field on either form, no reminder, no
  sign-out on arrival and no Account details section.

## Decided here

- **Frontend only.** A backend proxy with a limiter would be the custom
  machinery ADR 0035 ruled out, and the public client permits direct Cognito
  calls, so an app-side limit would bind nobody. Cognito's own throttling
  applies; `LimitExceededException` gets one generic alert.
- **One answer for every valid address.** An unverified account makes Cognito
  answer `InvalidParameterException`; after the page's own syntax check that,
  `UserNotFoundException` and success all show the same next step.
- **Sign out on arrival, not a redirect.** "Reset password" from Account
  details goes to the same route, which signs out first, so there is one flow.
- **`CognitoAuthService.ts` is not touched**: the two calls exist.

## Known limit, recorded not fixed

Locally verified ID tokens cannot see a provider-side revocation, so a token
issued before a reset stays valid until it expires. USERS-009's fencing covers
deletion; nothing here claims reset ends other sessions.

## Browser check

The Director's, after merge, on ports 5230-5239 against the dev pool. A real
code arrives by email; if it can't be read, that row is NOT DONE.
