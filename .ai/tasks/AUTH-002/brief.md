# AUTH-002: remembered-device registry

Product direction: [ADR 0008](../../../wiki/GeneralContext/Decisions/0008-remembered-devices-and-step-up-auth.md).

Prose for the Manager. The contract is `task.json`.

## Why a relation

A single device/location value on `users` cannot answer whether a login is from
any previously seen device: alternating between two legitimate devices would
overwrite the only value and repeatedly look new. Use one row per remembered
device and derive the last device from `last_seen_at`. This is a design inference
from fanwire's multiple-device recognition requirement, not a database schema
mandated by an industry standard.

Use an opaque random device id, persisted in a Secure, HttpOnly, SameSite,
host-only cookie, and store only its hash in the relation. Do not use IP,
geolocation, user-agent or a browser fingerprint as the device id. They may
change or be spoofed and create privacy costs. AUTH-003 may use IP or other
context only as a risk signal.

## Start gate

Current `code_agent` policy denies `backend/alembic/**`. Before this task starts,
the Director must merge a separate, narrow `.ai/policy.json` permission PR for
the needed migration path. The worker must not edit policy or broaden its task
paths to evade the guard. The schema follows the architecture rule: bigint
identity primary key, with the users module owning its relation and lifecycle.

## Further reading

- [OWASP Authentication Cheat Sheet: adaptive authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#adaptive-or-risk-based-authentication)
- [NIST SP 800-63B-4: session monitoring and risk signals](https://pages.nist.gov/800-63-4/sp800-63b.html)
