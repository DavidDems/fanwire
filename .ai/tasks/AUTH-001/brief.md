# AUTH-001: secure password-reset links

Prose for the Manager. The contract is `task.json`.

## Scope and current state

The product decision is recorded in
[ADR 0007](../../../wiki/GeneralContext/Decisions/0007-account-recovery-for-unverified-users.md).

The app already has a Forgot password link and Cognito's code-based reset page.
This task changes the recovery experience to a one-use email link and adds a
separate new-password/confirmation page. It also makes recovery available to a
user whose sign-up email remains unverified. It does not mark that email verified.

The Cognito `ForgotPassword` operation only delivers a code to a verified
recovery destination. A custom link flow is therefore required for unverified
accounts. Cognito remains the credential store; fanwire must not store or compare
passwords.

## Security contract

- The request endpoint must not disclose whether an account exists, is disabled,
  or has an unverified address. Keep body/status and observable processing path
  consistent, and rate-limit both normalized address and IP.
- Use an unpredictable one-time token, persist only its hash, bind it to the
  Cognito subject, expire it after 30 minutes, and invalidate it atomically on
  use. The URL uses a configured HTTPS origin, not the Host header. Keep the raw
  token out of logs, telemetry, analytics, referrers, and third-party requests.
- Do not turn `email_verified` on when the user resets a password. A reset proves
  control for this recovery transaction; it does not silently change the
  account's verification state.
- The new password and confirmation must match. Cognito password history must
  reject the current password. The current auth stack uses `FeaturePlan.LITE`,
  which lacks this policy; a human-approved Essentials/Plus configuration with
  `PasswordHistorySize=1` is a start gate. Do not upgrade the pool or write AWS
  configuration in this task.
- A separate Director-owned policy/scope prerequisite is required before an
  agent task can write its Alembic migration. A human must review any Cognito,
  SES, IAM-boundary or cost change before it is applied.

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
