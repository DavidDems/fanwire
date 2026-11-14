---
type: reference
---

# Build & Deployment

**Agent-facing.** The container strategy, the CI wiring and the deploy workflow; the package inventory and the human's procedures are in the "Parts". Pairs with [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] (what runs where), [[wiki/CodeContext/Standards/security|Security]] (CVE/secret scanning gates), and [[wiki/CodeContext/Standards/design-principles|Design principles]] (12-factor, DRY).

## State
`backend/app` (FastAPI), `frontend/src` (React) and `infra/` (CDK, TypeScript: `bin/`, `lib/`, `test/`, `cdk.json`, `package-lock.json`) all exist. `cd infra && npm ci && npm run build && npm run lint && npm test && npm run synth` synthesizes all eight stacks without AWS credentials; CI runs exactly that as the `infra-synth` job in `.github/workflows/test-agent.yml`, which makes `infra/test/iam-policy.test.ts` (no wildcard IAM outside a commented allow-list) a merge gate. `.github/workflows/deploy.yml` deploys as `GitHubActionsDeployRole` on every merge to `main` that changes a deployable path and on dispatch, each run human-approved; the role holds only `sts:AssumeRole` on the bootstrap roles ("Automated deploy"). No workflow runs `cdk bootstrap`. The one shared Lambda image is a single CDK `DockerImageAsset` (repo-root context, `docker/backend.Dockerfile`, target `lambda`, `linux/amd64`) used by all six backend functions (table below) with per-function `cmd` overrides; synth only stages its context, the image is built at deploy time. Stack split, egress, and IAM exceptions: [[wiki/CodeContext/Modules/0x00-architecture|0x00 Architecture]] "Infra (CDK) — implementation notes".

## Why Docker at all here
Nothing runs as a long-lived container in production: compute is Lambda, the frontend a static S3/CloudFront bundle. Docker has two jobs:
1. **The deployment artifact** for the six backend Lambdas (container image, not zip+layers).
2. **A reproducible build environment** for the frontend bundle and local/CI tests, thrown away after its output (`dist/` or a test exit code), never deployed.

## Docker containers — one per deployable/buildable piece

| Piece | Dockerfile | Base image | Deployed how |
|---|---|---|---|
| API Lambda | `docker/backend.Dockerfile`, target `lambda` | `public.ecr.aws/lambda/python:3.12` | Pushed to ECR, referenced by a CDK `lambda.Function` (`Code.fromEcrImage`), `cmd` = `app.main.handler` |
| Media, notifications, account-deletion Lambdas | same image, own `cmd` | same | Same ECR image, no separate image to build/scan/patch: `app.media.lambda_handler.handler`, `app.notifications.lambda_handler.handler`, `app.account_deletion_handler.handler` |
| Migration runner | same image, own `cmd` | same | `app.migrate.handler`. **Invoked by a human, by nothing else** — no rule, schedule, event source mapping or custom resource (`INFRA-003`; [[wiki/CodeContext/Modules/0x00b-architecture-iam-gaps|0x00b]] "Known gaps") |
| Sports-data load | same image, own `cmd` | same | `app.events.load_handler.handler`. Invoked by a human only (`EVENTS-002`) |
| Backend tests | `docker/backend.Dockerfile`, target `test` | same | Never deployed; run by `docker-compose.yml` and CI |
| Frontend build | `docker/frontend.Dockerfile`, target `build` (on the `deps` stage), then `export` (`FROM scratch`, carries only `dist/`) | `node:26-alpine` | `dist/` uploaded by `CdnStack`'s `BucketDeployment` under `cdk deploy -c deployFrontend=true` (`INFRA-002`), **not** `aws s3 sync`; the container is discarded |
| Frontend tests | `docker/frontend.Dockerfile`, target `test` (on the `deps` stage) | `node:26-alpine` | Never deployed |
| CDK deploy | `docker/cdk-deploy.Dockerfile` | `node:26-alpine` | Never deployed or pushed. Pins the exact CDK CLI/Node version, adds a docker client for the backend asset build; `deploy.yml` runs every `cdk diff`/`cdk deploy` through it |

**One shared image**: all six have one dependency set (`backend/pyproject.toml`) and differ only in the invoked function, so separate images would multiply build/scan/ECR cost for nothing (DRY). Split one out only when it needs a dependency the others don't (YAGNI).

`infra/test/app-stack.test.ts` enforces it for the migration runner: `Migration`'s `Code.ImageUri` must be byte-identical to the api function's and the assembly must hold exactly one docker image, so the code that migrates the schema cannot drift from the code that runs against it.

**Container images over zip+layers**: Pillow + boto3 + SQLAlchemy + the AWS SDK exceed the 250 MB unzipped zip+layers limit; images allow 10 GB and a normal `pip install`. Cold start is marginally worse, immaterial at this traffic.

## CI/CD wiring
GitHub Actions (OIDC-federated role, no long-lived keys, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]):
- On a PR, `test-agent.yml` builds and runs `docker/backend.Dockerfile` target `test` and `docker/frontend.Dockerfile` target `test`. When `test-agent` fails on an `agent/*` PR, `ci-summary.yml` posts one PR comment saying what failed; raw logs are not fed into an agent's context.
- Static checks, each its own job in the same test images: `backend-ruff` (`ruff check .`), `backend-mypy` (`mypy app`, strict; `tests/` is not type-checked), `frontend-typecheck` (`npm run typecheck`) and `frontend-lint` (`npm run lint`). All four are required by `gate`. `ruff format` is not gated.
- Audits, per [[wiki/CodeContext/Standards/security|Security]]: `pip-audit` blocks merge on any unignored finding; `npm audit` blocks at `--audit-level=high` for `frontend/` and at `--audit-level=critical` for `infra/`.
- Dependency updates: Renovate opens weekly grouped PRs, never automerged (`.github/renovate.json`). GitHub Dependabot *alerts* are on; Dependabot security-update PRs are off.

`.github/workflows/test-agent.yml` is the **one authoritative test executor**; its `gate` job is a required check on `main` alongside `agent-guard.yml`'s `guard-gate`. **Deploying is the separate, human-approved `deploy.yml`** ("Automated deploy"), not reachable from the agent workflows (`.ai/docs/handoff.md` §5.7).

The production bundle can only be built after `Fanwire-Auth` exists, because Vite bakes that stack's outputs in at build time ([[wiki/CodeContext/Modules/0x00b-architecture-iam-gaps|0x00b]] "Known gaps", the `FRONTEND-001` entry). Why an empty bucket behind the distribution serves an S3 `403 AccessDenied`: [[wiki/GeneralContext/Architecture/deploy-traps|Deploy traps]].

### Rebuilding the SPA

Moved to [[wiki/CodeContext/Standards/build-deployment-spa|Rebuilding the SPA]].

### Upgrading the NAT instance's AMI

Moved to [[wiki/CodeContext/Standards/build-deployment-nat-ami|Upgrading the NAT instance's AMI]].

### Automated deploy — `.github/workflows/deploy.yml`

A standalone workflow deploys all eight stacks as `GitHubActionsDeployRole`; every run waits for the `production` environment's required reviewer. `.ai/tests/test_deploy_workflow.py` pins its shape and its separation from the agent workflows.

**The boundary.** The role's trust names the GitHub environment `production` (`token.actions.githubusercontent.com:sub` = `repo:DavidDems@71515505/fanwire@1373722771:environment:production`, GitHub's immutable subject with owner and repo ids; committed at `infra/iam/github-actions-deploy-role-trust-policy.json`), not a branch. A branch trust (`ref:refs/heads/main`) would admit any job of any workflow run from `main`, including the agent workflows. Only a job that declares `environment: production` can assume the role. The test fails if any workflow other than `deploy.yml` requests `id-token`, declares an environment, or names `deploy.yml`, and `agent-guard` keeps workers out of `.github/` with no exception. The environment carries the two checks the trust does not make: **deployment branches restricted to `main`** and **a required reviewer**; without the branch restriction a dispatch from any branch would deploy that branch.

**What a run does**, in one job (`concurrency: deploy-production`, `cancel-in-progress: false`, so a second run waits instead of cancelling a CloudFormation update partway through):

1. Builds `frontend/dist` in Docker (`docker/frontend.Dockerfile`, target `export`) from five **environment variables** on `production` (not secrets: `vars.` never sees secrets, so a secret arrives empty and the build fails): `VITE_API_BASE_URL`, `VITE_MEDIA_BASE_URL`, `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID`. They are public bundle ids: `Fanwire-Auth`'s outputs and the site origin, as in [[wiki/CodeContext/Standards/build-deployment-spa|Rebuilding the SPA]] step 2, **never** `frontend/.env.local` (the dev pool and dev media bucket). It then checks the pool id, client id and media origin are in the bundle.
2. Builds `docker/cdk-deploy.Dockerfile` and runs its pinned CLI with the checkout at `/repo` (the backend `DockerImageAsset` builds from the repo root) and the runner's Docker socket mounted. An anonymous volume over `/repo/infra/node_modules` keeps the image's pinned install visible.
3. `cdk diff -c deployFrontend=true`, logged, then `cdk deploy --all -c deployFrontend=true --require-approval never`. **Every** call passes `deployFrontend=true`: without it, deploying `Fanwire-Cdn` removes the live `BucketDeployment` (and a diff shows that removal).

**`--require-approval never`.** CI cannot answer CDK's IAM approval prompt, so an IAM change is reviewed at the PR, through `infra/test/iam-policy.test.ts` and the human reviewer, and nowhere else.

**What it does not do:**

- **Write `FanwireCdkCfnExecPolicy` or `FanwireRoleBoundary`.** The deploy role cannot; the workflow makes no IAM write or bootstrap call, and only reads both through the lookup role to check they match the repo. A stack change that needs a new AWS service still needs the human to roll out a new policy version **before** dispatching (`infra/iam/README.md`).
- **Run migrations.** Invoking the `Migration` function needs `lambda:InvokeFunction`, which the deploy role does not have, so the human runs it after a deploy that adds an Alembic revision: [[wiki/CodeContext/Standards/build-deployment-post-deploy|Post-deploy runbook]] "Run migrations".
- **Load sports data** (`EVENTS-002`). Nothing invokes `SportsDataLoad`, by design (like `Migration`): [[wiki/CodeContext/Standards/build-deployment-post-deploy|Post-deploy runbook]] "Load sports data".
- **Deploy a merge that changes nothing AWS is built from.** The workflow runs on `push` to `main`, filtered by `paths` to what a stack, the backend image or the bundle is built from: `backend/**`, `frontend/**`, `docker/**`, `.dockerignore`, `infra/bin/**`, `infra/lib/**`, `infra/cdk.json`, `infra/package.json`, `infra/package-lock.json` and `deploy.yml`. Markdown files and frontend test files are excluded. **`wiki/` and `.ai/` never trigger it** (the agent system runs in GitHub Actions and no stack reads it), nor do `infra/test/` (tests change no template) or `infra/iam/` (applied by a human, never by CDK). `backend/tests/` does, because the image asset hashes it. A merge outside these paths deploys nothing. Dispatch by hand when needed, e.g. after rolling out a new `FanwireCdkCfnExecPolicy` version. `.ai/tests/test_deploy_workflow.py` pins the list.
- **Deploy without approval.** A merge queues a deploy rather than starting one. GitHub keeps one *pending* run per concurrency group: merging twice while a deploy runs leaves only the latest one waiting, which is harmless because it deploys the latest `main`.

**Setup** (for a new repository, or after the role's trust or the `production` environment is re-created): [[wiki/CodeContext/Standards/build-deployment-deploy-setup|Deploy workflow setup]].

**The permissions boundary.** Every role the stacks create carries `FanwireRoleBoundary` (`infra/iam/README.md`), so a template that gives a role `*:*` does not reach admin through it: a merged, approved template can do no more than the boundary's actions allow.

**The live-IAM check.** Before any CDK call, every run reads the default versions of `FanwireCdkCfnExecPolicy` and `FanwireRoleBoundary` through the read-only CDK lookup role and stops unless both equal the committed files. A PR changing either deploys only after the human rolls the new version out (`infra/iam/README.md` has the commands); until then the run fails naming the policy, and approving it again after the rollout is enough. It also catches a policy changed by hand and not committed.

### Run migrations

Moved to [[wiki/CodeContext/Standards/build-deployment-post-deploy|After a deploy: migrations and sports data]] "Run migrations".

### Load sports data

Moved to [[wiki/CodeContext/Standards/build-deployment-post-deploy|After a deploy: migrations and sports data]] "Load sports data".

## Local dev (`docker-compose.yml`)
`postgres` (`postgres:16-alpine`, real Postgres matching RDS, not sqlite) and `dynamodb-local` back the one-shot `backend-test` and `frontend-test`; `backend-dev` is the browser-clickable dev API on `http://localhost:8001`; a `perf` profile adds `postgres-perf`, `backend-perf` and `k6`. Dev/test tooling only, never deployed.

## Parts
- [[wiki/CodeContext/Standards/build-deployment-packages|Packages]] — backend, frontend and infra dependencies; why CDK is TypeScript.
- [[wiki/CodeContext/Standards/build-deployment-spa|Rebuilding the SPA]] — shipping a frontend build by hand.
- [[wiki/CodeContext/Standards/build-deployment-nat-ami|Upgrading the NAT instance's AMI]] — replacing the NAT instance on an advisory.
- [[wiki/CodeContext/Standards/build-deployment-post-deploy|After a deploy: migrations and sports data]] — invoking `Migration` and `SportsDataLoad`.
- [[wiki/CodeContext/Standards/build-deployment-deploy-setup|Deploy workflow setup]] — the role's trust and the `production` environment.
