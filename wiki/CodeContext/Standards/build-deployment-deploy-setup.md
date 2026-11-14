---
type: runbook
---

# Deploy workflow setup

Run once per repository, by the human, before the first dispatch of `deploy.yml` ([[wiki/CodeContext/Standards/build-deployment|Build & Deployment]] "Automated deploy") — and again whenever the role's trust or the `production` environment is recreated: a new repository changes the OIDC subject's ids. The current account state is recorded in [[wiki/CodeContext/Modules/0x00c-architecture-aws-account|0x00c]] → "AWS account state". Each command is a single line.

1. Apply the trust, from the repo root with this file present. Nothing else assumes the role, so applying it before the merge breaks nothing. To undo it, apply the same JSON with `sub` set to `repo:DavidDems@71515505/fanwire@1373722771:ref:refs/heads/main`.
   ```powershell
   aws iam update-assume-role-policy --profile fanwire-workload --role-name GitHubActionsDeployRole --policy-document file://infra/iam/github-actions-deploy-role-trust-policy.json
   ```
   Confirm it:
   ```powershell
   aws iam get-role --profile fanwire-workload --role-name GitHubActionsDeployRole --query Role.AssumeRolePolicyDocument
   ```
   If a login is refused, read the subject GitHub actually sent from CloudTrail:
   ```powershell
   aws cloudtrail lookup-events --profile fanwire-workload --region ca-central-1 --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity --max-results 3 --query "Events[].[EventTime,Username]" --output table
   ```
2. Create the environment: repo Settings → Environments → New environment `production`. Under **Required reviewers**, add yourself. Under **Deployment branches and tags**, choose *Selected branches and tags* and add the rule `main`.
3. Set the five environment variables on `production`, one command each. `VITE_MEDIA_BASE_URL` is the site origin, with no `/media` and no trailing slash.
   ```powershell
   gh variable set VITE_API_BASE_URL --env production --body /api
   ```
   ```powershell
   gh variable set VITE_MEDIA_BASE_URL --env production --body https://fanwire.daviddems.com
   ```
   ```powershell
   gh variable set VITE_COGNITO_REGION --env production --body ca-central-1
   ```
   ```powershell
   gh variable set VITE_COGNITO_USER_POOL_ID --env production --body ca-central-1_eSfPUMRq8
   ```
   ```powershell
   gh variable set VITE_COGNITO_CLIENT_ID --env production --body 1vskugrl60gggpt0lmib4ka85j
   ```
   Check the ids against the stack's outputs:
   ```powershell
   aws cloudformation describe-stacks --profile fanwire-workload --region ca-central-1 --stack-name Fanwire-Auth --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output table
   ```
4. Dispatch, then approve it in the Actions tab and **read the `cdk diff` step's log**.
   ```powershell
   gh workflow run deploy.yml --ref main
   ```
   Expect `Fanwire-App` to change only when `backend/` or `docker/backend.Dockerfile` has changed, because the image asset hashes only those (its `exclude` list in `app-stack.ts`). Expect `Fanwire-Cdn` to show `FrontendDeployment` `SourceObjectKeys` changing whenever the bundle differs. A change to `Fanwire-Network`'s instance means something is wrong.
5. After the run, check `/api/users/me` **as the app calls it**: log in, open the browser's developer tools → Network, and find the `me` request. It should return 200 with your profile. Typing `/api/users/me` into the address bar returns `401 {"detail":"Missing Authorization header"}` by design, because the app sends its Cognito token as a `Bearer` header from JavaScript, not as a cookie. That 401 proves CloudFront → API Gateway → the api Lambda, but nothing past it.
