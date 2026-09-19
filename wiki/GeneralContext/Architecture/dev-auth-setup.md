# Dev auth setup: a real Cognito user pool for local development

**Status: COMPLETED 2026-09-18 (human).** The dev user pool and SPA client were created with the commands below in `fanwire-workload` (`ca-central-1`), and the pool id and client id were recorded. `backend/.env` and `frontend/.env.local` did not previously exist; the human created both, each containing only the three variables listed under "Wire it into local dev". Both files are untracked and local. No further human action is needed for this task.

**Human-facing.** Decided 2026-09-18 (see `wiki/GeneralContext/Prompts/phase-4-manager-agent.md` Decisions #3): local development and browser testing use a **real** Cognito user pool, not an emulator and not an in-house fake. Cognito's free tier covers this (50k MAU; the default Cognito email sender allows ~50 emails/day, plenty for dev). Estimated cost: $0.

This pool is **dev-only** and separate from the production pool the CDK `auth` stack defines (that one only exists once `cdk deploy` happens, after the IAM review). It's created with the AWS CLI commands below rather than console clicks, so the exact configuration lives in a reviewed file. It mirrors the CDK stack's settings: email sign-in, email verification, optional TOTP MFA, and a public SPA client with no secret using SRP.

## Prerequisites
- AWS CLI v2, logged in via IAM Identity Center to `fanwire-workload` (`294321867941`) with the `AdministratorAccess` permission set:
  ```sh
  aws configure sso          # once: start URL https://d-9d6748d7e4.awsapps.com/start, region ca-central-1, name the profile fanwire-dev
  aws sso login --profile fanwire-dev
  ```

## Create the pool and SPA client (run once)
On Windows PowerShell, the Bash below does not run as-is. Use `$env:AWS_PROFILE = "fanwire-dev"` and `$env:AWS_REGION = "ca-central-1"` instead of `export`, `$VAR = aws ...` instead of `VAR=$(aws ...)`, and a backtick instead of `\` for line continuation. Keep the single quotes around the `--policies` and `--account-recovery-setting` values. This is how the human ran it successfully.

```sh
export AWS_PROFILE=fanwire-dev AWS_REGION=ca-central-1

POOL_ID=$(aws cognito-idp create-user-pool \
  --pool-name fanwire-dev \
  --username-attributes email \
  --auto-verified-attributes email \
  --policies 'PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}' \
  --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' \
  --deletion-protection ACTIVE \
  --query 'UserPool.Id' --output text)

aws cognito-idp set-user-pool-mfa-config --user-pool-id "$POOL_ID" \
  --software-token-mfa-configuration Enabled=true --mfa-configuration OPTIONAL

CLIENT_ID=$(aws cognito-idp create-user-pool-client \
  --user-pool-id "$POOL_ID" \
  --client-name fanwire-spa-dev \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --prevent-user-existence-errors ENABLED \
  --query 'UserPoolClient.ClientId' --output text)

echo "POOL_ID=$POOL_ID CLIENT_ID=$CLIENT_ID"
```

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

Then tell the manager session the two ids, or just create the files; the frontend auth unit reads them.

## Contract notes (for the frontend auth unit)
- The SPA sends the Cognito **ID token** as `Authorization: Bearer <token>`. The backend's `CognitoTokenVerifier` checks `aud` = app client id and `iss` = `https://cognito-idp.<region>.amazonaws.com/<pool>`, and only ID tokens carry `aud`.
- After sign-up + email confirmation, the SPA calls `GET /users/me`. A 404 means there's no profile yet, so it routes to profile creation (`POST /users`).
- Automated tests never touch this pool. `msw` mocks the API, and `amazon-cognito-identity-js` sits behind an injected auth interface. Only manual browser verification uses it.

## Teardown
`aws cognito-idp update-user-pool --user-pool-id <POOL_ID> --deletion-protection INACTIVE` then `aws cognito-idp delete-user-pool --user-pool-id <POOL_ID>`.
