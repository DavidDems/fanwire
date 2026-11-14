---
type: reference
---

# 0x01b — Users: auth and security

**Agent-facing.** Part of [[0x01-users]] (index, DOB privacy and the public read path, the public read interface and open decisions).

## Account verification and recovery requirement
Email verification must not gate sign-in or core account use, including posting and account settings; users can verify later. Any future new-device or IP-based re-verification applies only to accounts whose email was already verified.

New self-signups are auto-confirmed by Cognito's pre-sign-up trigger without setting `autoVerifyEmail`; signup-code delivery and the resulting `email_verified` value still require dev-pool proof. The local `User` row does not store Cognito verification state. The backend notification sender skips an address unless Cognito reports `email_verified` as `true`.

Forgot password uses native Cognito recovery to a verified destination. Optional email verification still permits ordinary use; no custom unverified-address recovery or reset-trigger implementation is selected. [ADR 0009](../../GeneralContext/Decisions/0009-account-lifecycle-evidence.md) owns the evidence and revocation requirements; the lifecycle foundation does not change reset or make locally verified ID JWTs detect provider revocation.

## Security
DOB privacy on public profiles and the public read path: [[0x01-users]] "Security".
- `date_of_birth` is PII: encrypted at rest via the RDS instance's customer-managed KMS key ("customer-managed KMS key ... for anything containing customer data" — [[wiki/CodeContext/Standards/security|Security]] Data protection), and never written to structured logs unhashed ("Structured logs must never contain secrets or unhashed PII" — [[wiki/CodeContext/Standards/security|Security]]).
- All writes (profile update, soft-delete, follow/unfollow) require a Cognito token verified server-side on every request — "never trusted based on client claims alone" ([[wiki/CodeContext/Standards/security|Security]] Application-layer section). Client-side "am I logged in" checks are UX only, never the boundary ([[wiki/CodeContext/Standards/design-principles|Design principles]] Security baseline).
- Profile picture upload itself is not this module's concern — it goes through `media/`'s quarantine/scan/processing pipeline; `users/` only stores the resulting `Media.id` once it reaches a servable state ([[0x04-media]]).
- Cognito issues RS256 (RSA)-signed JWTs, verified server-side by `app.users.auth.CognitoTokenVerifier.verify` with **PyJWT** (`PyJWT[crypto]`, [[wiki/CodeContext/Standards/build-deployment|Build & Deployment]]), with `algorithms=["RS256"]` pinned; PyJWT also refuses an asymmetric key (PEM or DER) as an HMAC secret. Verification **requires** `exp`, `iat`, `sub`, `iss` and `aud`. After the library's own checks succeed, it also requires `claims["token_use"] == "id"` and a present `aud` claim, else raises `InvalidTokenError`: Cognito **access** tokens carry `client_id`, not `aud`, and the SPA sends **ID tokens** only ([[wiki/GeneralContext/Architecture/dev-auth-setup|Dev auth setup]] "Contract notes"). Pinned by `backend/tests/users/test_auth.py`, including the forged-HS256 token shape, `alg: none`, `test_verify_rejects_access_token_shaped_token` and `test_verify_rejects_token_with_no_token_use_claim`. CI's `pip-audit` runs with no ignores. **Never widen `algorithms`.**
- `CognitoTokenVerifier` requires the signed ID token's integer `auth_time` and carries it in `VerifiedIdentity`. A missing or malformed claim fails token verification; an otherwise valid token with future or over-five-minute-old `auth_time` gets 403 `recent_auth_required` on `DELETE /users/me` and `DELETE /users/me/data`. Refreshing a token preserves its original `auth_time`; recovery is not gated.
- How the verifier is wired (`get_token_verifier`, JWKS) and the load-test verifier: [[0x01c-users-routes]].

## Account and identity dependency paths
Account dependencies consult durable subject authority before profile resolution ([[0x01a-users-schema]]). Deleting/deleted authority blocks authenticated account access and profile recreation even with an otherwise valid ID token; optional public identity becomes guest. Lookup/schema failures after activation fail closed. Local JWT validation checks claims and expiry, not live Cognito existence or provider revocation. Only owner status and permanent-deletion retry bypass the deleting/deleted access refusal, still requiring a valid same-sub token; retry also requires recent authentication. These exceptions grant no account writes. Missing profiles are not automatically eligible for adoption: reviewed cutover/provider-creation evidence is separate from login time.

| Path | Dependency | No token | Deactivated | Active |
|---|---|---|---|---|
| Public read | `get_optional_current_user` | guest (`None`) | guest (`None`) | the user |
| Active account: every write, private reads | `get_current_user` | 401 | 403 `account_deactivated` | the user |
| Own account: `DELETE /users/me`, `POST /users/me/recover` | `get_own_account` | 401 | the user | the user |

Mutation services use `users.lifecycle.fence_users`: gather the complete owner set, acquire sorted subject locks before authority/User/post/media rows, and re-read state while holding locks through commit. Request-start authorization cannot bypass a deletion accepted before the mutation commits.

`backend/tests/test_route_auth.py` rejects writes without `get_current_user`, except identity-only creation/permanent removal and own-account deactivation/recovery. New exceptions require changing its allowlist.
