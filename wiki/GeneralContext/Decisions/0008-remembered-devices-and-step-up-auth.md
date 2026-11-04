---
type: decision
---

# ADR 0008: Remembered devices and login step-up

## Context

Email verification is optional for ordinary use, while verified accounts may
need an identity check on a new device. A single last-device field cannot
remember multiple devices. IP addresses, geolocation, and browser attributes
can change or be shared and are not stable device identities.

## Decision

Unverified users may continue using the platform and receive a dismissible,
non-notification prompt to verify their account. A verified user signing in
from an unseen device must complete an email-code challenge before receiving
usable app access. A per-user relation holding multiple remembered devices is
the selected data-model direction; this is a fanwire design inference, not an
industry-standard mandate. IP and related signals may inform risk but are not
device identity. The specific Cognito challenge and delivery architecture
remain subject to AUTH-003 review; this ADR does not select that architecture.

Email OTP is a lower-assurance email-ownership check, not NIST-compliant
out-of-band MFA. NIST SP 800-63B-4 prohibits email as an out-of-band
authenticator. A stronger-factor follow-up, such as TOTP or passkeys, remains
necessary before making higher-assurance claims.

## Consequences

The challenge must block usable tokens and protected API access until success.
The device registry should retain only opaque device identifiers and required
timestamps; IP and geolocation need a separate privacy decision before storage.
See [AUTH-002](../../../.ai/tasks/AUTH-002/brief.md) and
[AUTH-003](../../../.ai/tasks/AUTH-003/brief.md).

## References

- [NIST SP 800-63B-4: authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)
- [NIST SP 800-63B-4: digital identity guidelines](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Amazon Cognito device tracking](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-device-tracking.html)
