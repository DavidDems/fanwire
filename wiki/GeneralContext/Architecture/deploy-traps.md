# Deploy traps — read before running any AWS command

**Human- and Director-facing.** What caught the first deploy (2026-09-30) and
the sessions after it. Every AWS session reads this before handing over a
command. It was §4 of `TODO/04-first-deploy.md`, deleted 2026-10-07 once the
deploy path was finished: the record of that deploy, and what each
post-deploy check proved, are in `wiki/CodeContext/Modules/0x00-architecture.md`
("First deploy", "Post-deploy checks, 2026-09-30", "AWS account state").

Routine deploys no longer need a human at a keyboard:
`.github/workflows/deploy.yml` runs on every merge to `main` that changes a
deployable path, behind the `production` environment's required reviewer
(`wiki/CodeContext/Standards/build-deployment.md` → "Automated deploy"). The
traps below still apply to anything run by hand, and to reading a deploy's
`cdk diff`.

## Traps

- **An empty frontend bucket serves `403 AccessDenied`, not `404`** — the OAC
  policy grants `s3:GetObject` and not `s3:ListBucket`. Reaching that XML
  means DNS, TLS, the certificate and OAC all work.
- **Verify the branch before deploying.** `git switch` fails when the branch
  is checked out in another worktree, and PowerShell's `;` carries on. Check
  `git branch --show-current` and the property you think you changed, as
  separate commands.
- **`VITE_MEDIA_BASE_URL` is the site origin, not `/media`.** Public keys
  already start with `media/`; a `/media` base produces `/media/media/…`.
- **Build the bundle in Docker, never with a bare `npm run build`.**
  `frontend/.env.local` holds the *dev* pool and Vite reads it in production
  mode too; the Docker build excludes it and fails on any missing value.
- **`/api/health` proves nothing past API Gateway.** It touches neither the
  database nor egress. A logged-in `/api/users/me` is the first real check.
- **The infra tests used to leak ~50 MB per synth into `%TEMP%`** and filled
  the disk mid-session (fixed in PR #76). If Docker Desktop hangs with no
  output, check free space first.
- **`npx cdk` only works from `infra/`.** The CLI is pinned in
  `infra/node_modules`; from the repository root npx finds nothing local and
  offers to install the unrelated registry package `cdk`, which then fails
  with `ETARGET` (2026-10-01). **An install prompt means you are in the wrong
  directory — answer no.** `npx cdk --version` should print the version in
  `infra/package.json` with no prompt.
- **`aws … | Select-String` can die with `'charmap' codec can't encode`**
  when the output holds a non-ASCII character. Prefix the line with
  `$env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1';`.
- **CloudFormation is no longer admin (2026-10-02).** The exec role holds
  `FanwireCdkCfnExecPolicy`, which grants the services the stacks use today
  and nothing else. A stack change that adds a new AWS service (CloudWatch
  alarms, SNS, …) fails with `AccessDenied` mid-deploy. The order is: extend
  `infra/iam/cdk-cfn-exec-role-policy.json` in the same PR (CI fails until
  you do), roll out the new policy version **before** deploying, then deploy.
  If a rollback sticks in `UPDATE_ROLLBACK_FAILED`, the escape hatch is in
  `infra/iam/README.md`.
- **Deploying one stack deploys its dependencies too**, unless you pass
  `--exclusively`. `cdk deploy Fanwire-App` alone also deploys Network, Data,
  Storage and the rest it depends on.
- **The NAT instance's AMI is pinned** (`natImageId` in `infra/cdk.json`,
  pinned 2026-10-02, PR #82). A `cdk diff` showing the instance's `ImageId` changing means
  someone changed the pin, which replaces the instance. Do that only as the
  deliberate upgrade in `build-deployment.md`, never as a side effect.
  Every Network deploy now prints `WARNING ... Hardcoded AMI ID`
  (`W9010`). It is expected, so don't act on it.
- **Diff or deploy `Fanwire-Cdn` without `-c deployFrontend=true` and it
  removes the `BucketDeployment`** the live stack has. Leave Cdn out, or
  rebuild the bundle in Docker and pass the flag.
- **`cdk deploy --force` on an unchanged stack runs nothing.** CloudFormation
  creates an empty change set and stops. It proves the roles and template
  validation, not that an update would succeed.
- **`aws cloudtrail lookup-events` throttles** (2 requests/s; `--query`
  filters on your machine, so every page is still fetched). Prefix
  `$env:AWS_RETRY_MODE='adaptive'; $env:AWS_MAX_ATTEMPTS='20';`, narrow
  `--start-time`, and write to a file with `| Out-File -Encoding utf8`.

## A from-scratch deploy, if one is ever needed again

The three phases, for reference — each is now a recipe rather than a plan:

**Phase 1 — bring up the stacks.** All eight, ~30–45 minutes. There is no
frontend-only deploy — `CdnStack` needs `AppStack`'s HTTP API id, and
`AppStack` depends on everything else. Leave `deployFrontend` unset.

**Phase 2 — apply the schema.** Invoke `INFRA-003`'s migration function once,
by hand, and confirm it returns a head revision. Re-run it after any deploy
that adds a migration.

**Phase 3 — build the bundle against the real outputs, then deploy it.** See
`wiki/CodeContext/Standards/build-deployment.md` → "Rebuilding the SPA" for the
exact commands.
