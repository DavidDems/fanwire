# AUTH-003: verified-account new-device challenge

Product direction: [ADR 0008](../../../wiki/GeneralContext/Decisions/0008-remembered-devices-and-step-up-auth.md).

Prose for the Manager. The contract is `task.json`.

## Dependency and behavior

AUTH-002 owns the per-user remembered-device relation. This task consumes it.
An unverified account may sign in and use the platform; show a dismissible,
non-persisted top-right verify prompt. A verified account on a remembered device
continues normally. A verified account on a new or revoked device must prove
control of its already verified email before receiving any usable app session.

The challenge belongs inside the authentication flow. A modal displayed after
normal sign-in has received or stored tokens is not a security boundary. The
challenge must be bound to this user, pending login, and device; expire in 10
minutes; be one-use; throttle attempts and resends; and register the device only
after success. Failed or interrupted challenges leave the user unauthenticated.

## Assurance and provider constraints

Email codes are lower assurance and are not phishing-resistant. NIST SP
800-63B-4 says email must not be used as an out-of-band authenticator. This
requested code is an email-ownership check, not a claim of NIST/AAL-compliant
MFA. Record TOTP/passkeys or another stronger factor as follow-up work.

Before implementation, prove the chosen Cognito challenge and email-delivery
architecture can withhold tokens until success and coexist with AUTH-001's
custom reset link. Cognito has constraints when email MFA and native email
password recovery share a destination. Any pool-plan, SES or IAM change needs
separate human approval; do not make AWS writes as part of spec or task planning.

## Further reading

- [NIST SP 800-63B-4: authenticators](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)
- [NIST SP 800-63B-4: risk signals and session monitoring](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Amazon Cognito device tracking](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-device-tracking.html)
- [Amazon Cognito password recovery constraints](https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html)
