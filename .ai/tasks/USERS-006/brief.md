# USERS-006: the account menu and Account settings

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why the password is checked on the server too

A password prompt only in the browser protects nothing against a stolen token.
So the prompt re-authenticates with Cognito, which refreshes `auth_time`, and the
backend refuses a stale one. The human asked for the prompt; this makes it real.

## The notifications toggle: decided by the human's rule

The human, 2026-11-02: if a toggle would need a database change, build it,
disable it, show it as on, and make no route call. The one stored preference is
`email_notifications_enabled`, and in-app notifications have no stored flag and
"cannot be disabled" by business rule (`notifications/models.py`), so a real toggle
needs a new column plus delivery logic. It is therefore the disabled form. The
existing email preference stays on `/notifications`, untouched.

## Traps

- **`auth_time` across a token refresh.** Cognito keeps the original `auth_time`
  on a refreshed ID token, so a session older than 5 minutes needs the prompt.
  That is the intent. Prove it once against the dev pool before relying on it,
  with `amazon-cognito-identity-js`'s `refreshSession` as well as a fresh sign-in.
- **MFA.** `CognitoAuthService.signIn` already rejects at `mfaRequired`, and no
  screen enrols a TOTP. `reauthenticate` gets the same treatment.
- **Verified state in a stale token.** After `confirmEmailVerification`, the ID
  token still says false until refreshed. Call `refreshSession`, then read it.
- **Test files that move.** `deactivate.test.tsx`, `deactivate-focus.test.tsx` and
  `nav-link.test.tsx` pin today's placement; `ProfileSettings.test.tsx` covers the
  account section. They move in the test commit. `routes.test.tsx` and
  `AppLayout.test.tsx` count nav items.
- `FloatingButton`'s gate reads `ownUserId`; leave it. Do not remove `UserIcon` if
  anything else still imports it.
- The backlog row '"Your profile" clips in the bottom bar' is closed by this unit.

## Deploy

No migration. Ship the frontend and backend together: an old cached bundle's
deactivate would get a 403 until reloaded, which shows the existing failure text.
That is acceptable before launch.

## Merge order

`USERS-007` (sign-up without verification) must not reach production before this:
it is what gives an unverified account a way to verify.

## Later Director PR, not this spec

`FrontendUI/components.md` and `layout.md` for the account menu.
