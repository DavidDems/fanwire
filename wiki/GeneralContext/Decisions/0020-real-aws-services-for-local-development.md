---
type: decision
---

# 0020 - Real AWS services for local development

Decision: 2026-09-18 (the dev Cognito pool), 2026-09-22 (the dev media
buckets) and the test-account rule, the human.

## Context

Local development and browser testing need sign-in and image upload. An
in-house fake of either would test the fake, not the path production runs.
Locally there is no S3 and no GuardDuty, so without real buckets an uploaded
image never reaches `processed`.

## Choice

- **Real auth, no in-house fake.** Local development and browser testing use a
  real dev Cognito user pool, not an emulator.
- **Real dev S3 buckets**, created by hand in `fanwire-workload` with the same
  TLS-only and block-public-ACL posture as the CDK buckets. Their
  configuration is `infra/dev/`.
- **The scan verdict is the one fake.** A dev-only script supplies the verdict
  GuardDuty gives in AWS, and it says loudly that it is a fake (`MEDIA-002`).
- **Test accounts are `+alias`es of the human's own address**,
  `<owner-email>+fw<n>`, and a human confirms each one in the real pool.
- **No agent gets `cognito-idp:AdminConfirmSignUp`.** An agent holding it could
  create confirmed identities at will, in the pool that is kept real precisely
  so that its auth path can be trusted.

## Consequences

- Creating the pool, wiring it into local dev and the test accounts are
  [dev-auth-setup.md](../Architecture/dev-auth-setup.md), "Test accounts".
- The bucket configuration and how it was applied are
  [infra/dev/README.md](../../../infra/dev/README.md). The dev-only verdict
  script is `MEDIA-002` ([`.ai/tasks/MEDIA-002/`](https://github.com/DavidDems/fanwire-archive/tree/b2807e9a2a4b59ed4f2ff74d174ceba0239fc908/.ai/tasks/MEDIA-002/)).
- Automated tests never touch these resources: they mock the API and the auth
  interface. Only manual or browser verification uses them
  ([ADR 0022](0022-browser-verification-on-hand-run-sessions.md)).
