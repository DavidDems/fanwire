---
type: runbook
---

# Dev auth setup: a real Cognito user pool for local development

**Human-facing.** Local development and browser testing use a **real** Cognito user pool, not an emulator and not an in-house fake ([ADR 0020](../Decisions/0020-real-aws-services-for-local-development.md)). Cognito's free tier covers this (50k MAU; the default Cognito email sender allows ~50 emails/day, plenty for dev). Estimated cost: $0.

The dev user pool and SPA client exist in `fanwire-workload` (`ca-central-1`), made with the commands below. `backend/.env` and `frontend/.env.local` are untracked and local, each containing only the three variables listed under "Wire it into local dev".

This pool is **dev-only** and separate from the production pool, which `Fanwire-Auth` deploys ([inventory](incident-runbook-inventory.md)). It's created with the AWS CLI commands below rather than console clicks, so the exact configuration lives in a reviewed file. It mirrors the CDK stack's settings: email sign-in, email verification, optional TOTP MFA, and a public SPA client with no secret using SRP.

## Prerequisites
AWS CLI v2, logged in via IAM Identity Center to `fanwire-workload` (`294321867941`) with the `AdministratorAccess` permission set. Once, configure the profile: start URL `https://d-9d6748d7e4.awsapps.com/start`, region `ca-central-1`, and name the profile `fanwire-dev`:

```powershell
aws configure sso
```

Then sign in:

```powershell
aws sso login --profile fanwire-dev
```

## Create the pool and SPA client (run once)
Run these in order, in one PowerShell window. Keep the single quotes around the `--policies` and `--account-recovery-setting` values.

```powershell
$env:AWS_PROFILE = "fanwire-dev"
```
```powershell
$env:AWS_REGION = "ca-central-1"
```
```powershell
$POOL_ID = aws cognito-idp create-user-pool --pool-name fanwire-dev --username-attributes email --auto-verified-attributes email --policies 'PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}' --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' --deletion-protection ACTIVE --query 'UserPool.Id' --output text
```
```powershell
aws cognito-idp set-user-pool-mfa-config --user-pool-id $POOL_ID --software-token-mfa-configuration Enabled=true --mfa-configuration OPTIONAL
```
```powershell
$CLIENT_ID = aws cognito-idp create-user-pool-client --user-pool-id $POOL_ID --client-name fanwire-spa-dev --no-generate-secret --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH --prevent-user-existence-errors ENABLED --query 'UserPoolClient.ClientId' --output text
```
```powershell
"POOL_ID=$POOL_ID CLIENT_ID=$CLIENT_ID"
```

The last line prints both ids; a success shows a `ca-central-1_…` pool id and a client id.

## Wire it into local dev
Neither value is a secret: the pool id and public client id ship in the browser bundle anyway. Keep them in untracked local env files so each developer can point at their own pool.

`backend/.env` (read by `pydantic-settings`):
```
COGNITO_REGION=ca-central-1
COGNITO_USER_POOL_ID=<POOL_ID>
COGNITO_APP_CLIENT_ID=<CLIENT_ID>
```

`frontend/.env.local` (read by Vite):
```
VITE_COGNITO_REGION=ca-central-1
VITE_COGNITO_USER_POOL_ID=<POOL_ID>
VITE_COGNITO_CLIENT_ID=<CLIENT_ID>
```

Create both files; the backend and the frontend read them on start.

## Contract notes (for the frontend auth unit)
- The SPA sends the Cognito **ID token** as `Authorization: Bearer <token>`. The backend's `CognitoTokenVerifier` checks `aud` = app client id and `iss` = `https://cognito-idp.<region>.amazonaws.com/<pool>`, and only ID tokens carry `aud`.
- After sign-up + email confirmation, the SPA calls `GET /users/me`. A 404 means there's no profile yet, so it routes to profile creation (`POST /users`).
- Automated tests never touch this pool. `msw` mocks the API, and `amazon-cognito-identity-js` sits behind an injected auth interface. Only manual browser verification uses it.

## Test accounts
The rules are [ADR 0020](../Decisions/0020-real-aws-services-for-local-development.md):
- Sign up test users as `+alias`es of the human's own address: `<owner-email>+fw<n>`. Gmail delivers them all to one inbox, and Cognito treats each as a separate identity.
- **The human clicks the real confirmation link.** No agent is given `cognito-idp:AdminConfirmSignUp`, because an agent holding it could mint confirmed identities in the very pool that is kept real so its auth path can be trusted.
- Browser verification is reported as **NOT DONE** unless a browser tool really drove the app ([ADR 0022](../Decisions/0022-browser-verification-on-hand-run-sessions.md)).

### The two that exist
- `<owner-email>+fw1` (username `fwtest1`) and `<owner-email>+fw2` (username `fwtest2`), confirmed in the dev pool. The confirmation is a **code** emailed by Cognito and entered on `/confirm`, not a link.
- **Credentials:** `frontend/.env.test-accounts.local`, which is untracked (`.gitignore`: `.env.*.local`) and outside Docker build contexts (`.dockerignore`: `**/.env.*`). The keys are `FANWIRE_TEST_<n>_EMAIL`, `_PASSWORD` and `_USERNAME` for n = 1 and 2. The human has declared these values non-sensitive (empty accounts on an empty dev pool) and allowed every agent to read the file; the permission lives in their user-level Claude Code settings. Read it only for a signed-in browser check, never print a password into a PR or the wiki, and never use these accounts on the live site: they don't exist in the production pool, and the Playwright browser profile persists between sessions.
- **The Cognito identities persist. The fanwire profiles don't.** Postgres in `docker-compose.yml` has no volume, so `docker compose down` deletes every `users` row. After a fresh stack, signing in lands on the feed (it is public), not `/create-profile`: go to `/create-profile` and recreate the profile with the `_USERNAME` from the file (create `fwtest2` first if a check needs `fwtest1` viewing someone else). That is also a free check of profile creation.
- **Feed and notifications on a fresh stack:** a newly created profile's signed-in feed is empty until it follows someone, and a follow, reply or repost by a second account creates its notification in process (`ENVIRONMENT=development`, `NOTIFICATIONS-001`). `FrontendUI/verification-browser.md` §3a says how to get rows for a check.
- **Signing out:** use the nav's Sign out, its last item. The fallback is to remove the `CognitoIdentityServiceProvider.*` keys from `localStorage` for the origin, then reload; in Playwright, do that with `browser_evaluate`. Sign out at the end of every signed-in check.
- **Starting the stack:** `docker compose up -d --build backend-dev`, then wait for `http://localhost:8001/health` before `scripts/seed_dev.py` (the container migrates on start), then `npm run dev` in `frontend/`. The Cognito ids reach `backend-dev` only from `backend/.env`.

## Teardown
Put the dev pool's id in `$poolId`, then turn off deletion protection and delete the pool, in that order:

```powershell
$poolId = 'ca-central-1_XXXXXXXXX'
```
```powershell
aws cognito-idp update-user-pool --user-pool-id $poolId --deletion-protection INACTIVE
```
```powershell
aws cognito-idp delete-user-pool --user-pool-id $poolId
```
