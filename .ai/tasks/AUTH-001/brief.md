# AUTH-001: password confirmation and Cognito code recovery

Prose for the Manager. The contract is `task.json`.

## Scope and current state

The app already has a Forgot password link and Cognito's native code-based reset
flow. The selected recovery design keeps that flow: Cognito `ForgotPassword`
sends a verification code through the pool's existing default email sender to
the `verified_email` recovery method, and the backend owns
`ConfirmForgotPassword`. Recovery is available only to email-verified accounts.
The forgot-password form must show a static disclaimer that users must verify
their email before resetting their password. Unknown, disabled, and unverified
addresses still receive the same generic request response; unverified accounts
receive no code. Do not depend on SES production access or the proposed custom
sender `notifications@fanwire.daviddems.com`.

The user selected this fallback after SES production access was denied and
explicitly dropped the separate post-reset password-changed email. Do not build
custom reset links, app-issued 256-bit reset tokens, token hashing/storage, or a
post-reset email notice. Cognito owns code expiry, single-use, and attempt
controls. Never persist or log the code.

The sign-up form also has labelled Password and Confirm password fields. A
mismatch is reported accessibly without a Cognito request; matching values
submit once. Email verification behavior after sign-up remains unchanged.
Password-history checks are out of scope; do not compare a new password with
the current password in the application or require a paid Cognito feature plan.

## Security contract

- For every syntactically valid request, known, unknown, disabled, and
  unverified addresses receive the same status, body, and user-facing message.
  Avoid account-existence, verification, and delivery details. Rate-limit by
  normalized address and source IP.
- Use Cognito `ForgotPassword` and `ConfirmForgotPassword` only. A code is sent
  only to the verified email recovery method through Cognito's existing default
  sender. The app does not implement a custom link/token path, store codes, or
  log codes. Cognito controls code expiry, single-use, and attempt limits.
- The backend must own `ConfirmForgotPassword`. A frontend direct confirmation
  would bypass the valid-after barrier and global sign-out. Before calling
  Cognito, durably write a restrictive pending cutoff for the resolved Cognito
  subject. Locally JWT-validated API requests treat it as active and reject old
  ID tokens. The write must succeed before confirmation is attempted. After
  Cognito confirms the code, commit that cutoff as the durable barrier, then
  call `AdminUserGlobalSignOut`. Report success only after confirmation, barrier
  commit, and global sign-out succeed. Require normal sign-in after reset; do
  not create an authenticated session automatically.
- On a definite invalid/expired-code response, Cognito did not change the
  password: remove only this attempt's pending cutoff, preserving any prior
  committed cutoff. If cleanup fails, leave the pending cutoff active and fail
  closed. On timeout, transport error, or any ambiguous result, keep the cutoff
  active because Cognito may have changed the password. If barrier commit or
  global sign-out fails after confirmation, keep the restrictive cutoff; never
  restore the prior cutoff. An interrupted pending cutoff can invalidate
  existing sessions, but a normal sign-in after that cutoff is allowed. Apply
  the configured recovery rate limits before attempts.
- Do not turn `email_verified` on during recovery. The new password and
  confirmation must match before any Cognito confirmation call. Cognito applies
  the pool's configured password policy. Password-history enforcement is out
  of scope; do not compare the new password to the current password.
- Preserve failure-closed valid-after checks for locally JWT-validated API
  requests, keyed by Cognito subject and independent of a local profile row.
  Reject ID tokens whose `auth_time` is at or before the durable reset cutoff;
  account for Cognito's one-second precision and document any brief
  reauthentication delay caused by rounding.
- A separate Director-owned scope/policy prerequisite must grant the backend
  role pool-scoped `cognito-idp:AdminUserGlobalSignOut`. `AdminGetUser` is
  already present and scoped. A separate Director-owned policy/scope
  prerequisite is required before the task worker can write its Alembic
  migration path. The worker does not change `.ai/policy.json`. No AWS write is
  part of this task.

## Account settings and active sessions

Account settings starts with an Account details section. Show the email value
and a Password row whose action is a Reset password button opening the same
recovery route as the sign-in page. If a signed-in user arrives at that route,
sign out and clear their active session before enabling any recovery request or
password-change submission. Do not retain authenticated controls or session
state on the recovery form.

## Password confirmation

The recovery form has code, New password, and Confirm password fields. A
mismatch is an accessible field error and makes no Cognito confirmation call.
Cognito enforces the pool's configured password policy. The application does
not implement password-history checks or compare the new password to the
current password. Password and confirmation are never logged or placed in URLs,
analytics, or telemetry.

Apply the same confirmation rule to sign-up: Password and Confirm password
must match before Cognito `SignUp`. Keep existing optional verification
behavior unchanged.

## Further reading

- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [Amazon Cognito password recovery and password history](https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html)
