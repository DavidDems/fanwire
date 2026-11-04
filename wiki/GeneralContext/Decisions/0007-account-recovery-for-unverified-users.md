---
type: decision
---

# ADR 0007: Password recovery for unverified accounts

## Context

Email verification is optional for ordinary platform use. A user supplies an
email at sign-up, but may not own or verify it. The 2026-11-02 choice that
unverified users could not recover passwords remains historical and unchanged
([human-decisions.md:237-239](../Architecture/human-decisions.md#L237-L239)).
This ADR supersedes only that no-recovery consequence; it does not revise the
other accepted sign-up risks or decisions. Cognito's native recovery sends
codes only to verified recovery destinations, so it cannot alone meet the
updated product requirement.

## Decision

Provide a password-reset link to the signup email even when it is unverified.
Resetting a password must not implicitly set `email_verified`; email ownership
verification remains a separate user action. Use a custom recovery design
because of Cognito's verified-destination limitation. The implementation
architecture, sender, and Cognito/IAM configuration remain subject to the
AUTH-001 design review and explicit human approvals.

## Consequences

Recovery must not disclose whether an account exists and must protect reset
tokens against guessing, replay, expiry, and leakage. The recovery flow needs a
transactional email path that can reach an unverified address without treating
delivery as proof of ownership. See [AUTH-001](../../../.ai/tasks/AUTH-001/brief.md)
for the implementation contract.

## References

- [Amazon Cognito password recovery](https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
