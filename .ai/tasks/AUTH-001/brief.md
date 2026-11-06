# AUTH-001: secure password-reset links

Prose for the Manager. The contract is `task.json`.

## Scope and current state

The product decision is recorded in
[ADR 0007](../../../wiki/GeneralContext/Decisions/0007-account-recovery-for-unverified-users.md).

The app already has a Forgot password link and Cognito's code-based reset page.
The human confirmed this current flow works for verified accounts. For an
unverified account, the Cognito request returns HTTP 400 and no reset message is
sent. This task follows ADR 0007 and replaces the native code flow with a secure
custom one-time email link for both verified and unverified accounts. The link
opens a new-password form with confirmation. Resetting a password never marks
the email verified.

The sign-up form also gains a Confirm password field to catch a typo before
Cognito creates the account. This is a new AUTH-001 criterion; `USERS-007` is
complete and remains unchanged. A mismatch is reported accessibly without a
Cognito request; matching values submit once. Email verification remains
optional after sign-up.

The human's observed HTTP 400 is the reason this task cannot rely on native
Cognito `ForgotPassword` for unverified accounts. Send the link only to the
address associated with the matching Cognito account. Cognito remains the
credential store; fanwire must not store or compare plaintext passwords.

## Security contract

- The request endpoint must not disclose whether an account exists, is disabled,
  or has an unverified address. Keep body/status and observable processing path
  consistent, and rate-limit both normalized address and IP.
- Use at least 256 bits of cryptographically secure one-time token entropy,
  persist only its one-way hash, bind it to the Cognito subject, expire it after
  30 minutes, and invalidate it atomically on use. Issuing a new token
  invalidates outstanding tokens for that account. Limit requests and invalid
  attempts. Build links only from a configured HTTPS allowlisted origin, never
  the request Host header. Keep the raw token out of logs, telemetry, analytics,
  referrers, browser history and third-party requests; remove it from the URL
  before rendering the reset form.
- Do not turn `email_verified` on when the user resets a password. A reset proves
  control for this recovery transaction; it does not silently change the
  account's verification state.
- The new password and confirmation must match. Cognito applies the pool's
  configured password policy. Password-history enforcement is out of scope; do
  not compare a new password with the current password in the application or
  require a paid Cognito feature plan for this task.
- A separate Director-owned policy/scope prerequisite is required before an
  agent task can write its Alembic migration. A human must review any Cognito,
  SES, IAM-boundary or cost change before it is applied.

## Account settings and active sessions

Account settings starts with an Account details section. Show the email value
and a Password row whose action is a Reset password button opening the same
recovery route as the sign-in page. If a signed-in user arrives at that route,
sign out and clear their active session before enabling any recovery request or
password-change submission. Do not retain authenticated controls or session
state on the recovery form.

## Password confirmation

The reset form has New password and Confirm password fields. Mismatch is an
accessible field error and makes no reset request. Cognito enforces the pool's
configured password policy. This task does not implement password-history
checks or compare the new password to the current password. Password and
confirmation are never logged or placed in URLs, analytics or telemetry.

Apply the same confirmation rule to sign-up: the Password and Confirm password
values must match before the Cognito `SignUp` request. Keep the existing optional
verification flow unchanged.

## Email module boundary

The Users module must depend on an injected email-delivery interface, never
import a notification concrete class, SES adapter, or notification table. Use
the public `EmailSender` contract in `app.notifications.email` and extend it
with a security-email operation that accepts the Cognito subject plus the
message content; the notification adapter resolves the account email via
Cognito and performs delivery. Keep raw reset tokens out of logs and telemetry
inside the adapter. Do not route password-reset messages through
`Notification`/`NotificationPreference` or create an in-app notification:
these are transactional security emails, separate from the three event
notifications. Extend the interface tests in
`backend/tests/notifications/test_email.py` to prove this boundary and the
recording test double behavior.

## Further reading

- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [Amazon Cognito password recovery and password history](https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html)
