# Build & Deployment

**Agent-facing.** The package/dependency inventory and the container strategy for everything that gets built and deployed. Pairs with [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] (what runs where), [[wiki/CodeContext/Standards/security|Security]] (CVE/secret scanning gates), and [[wiki/CodeContext/Standards/design-principles|Design principles]] (12-factor, DRY). This doc is current-state only, same convention as `wiki/` — see `AGENTS.md`.

## State
`backend/app` (FastAPI), `frontend/src` (React) and `infra/` (CDK, TypeScript: `bin/`, `lib/`, `test/`, `cdk.json`, `package-lock.json`) all exist. `cd infra && npm ci && npm run build && npm run lint && npm test && npm run synth` synthesizes all eight stacks without AWS credentials; CI runs exactly that as the `infra-synth` job in `.github/workflows/test-agent.yml`, which makes `infra/test/iam-policy.test.ts` (no wildcard IAM outside a commented allow-list) a merge gate. **Deployed by hand 2026-09-29/30** (all eight stacks; [[wiki/CodeContext/Modules/0x00-architecture|0x00 Architecture]] "First deploy"). Since then, `.github/workflows/deploy.yml` deploys as `GitHubActionsDeployRole`, on every merge to `main` that changes a deployable path and on a manual dispatch, each run waiting for the human's approval. The role which holds only `sts:AssumeRole` on the bootstrap roles ("Automated deploy" below). No workflow runs `cdk bootstrap`. The one shared Lambda image is a single CDK `DockerImageAsset` (repo-root context, `docker/backend.Dockerfile`, target `lambda`, `linux/amd64`) used by the api, ingestion, media, notifications and migration functions with per-function `cmd` overrides; synth only stages its context, the image is built at deploy time. Stack split, egress, and IAM exceptions: [[wiki/CodeContext/Modules/0x00-architecture|0x00 Architecture]] "Infra (CDK) — implementation notes".

## Why Docker at all here
Nothing in this app runs as a long-lived container in production — compute is Lambda, the frontend is a static S3/CloudFront bundle (see [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]). Docker is used for two distinct jobs, and it's worth keeping them mentally separate:
1. **The actual deployment artifact** for the five backend Lambdas — AWS Lambda's container-image deployment model, not zip+layers (see rationale below).
2. **A reproducible build environment** for the frontend bundle and for local/CI test runs — the container is thrown away after producing its output (a `dist/` folder or a test exit code), never deployed itself.

## Backend — Python packages (`backend/pyproject.toml`)

Runtime (ships in the Lambda image):
| Package | Why |
|---|---|
| `fastapi` | app framework, carried over per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] |
| `pydantic` v2 | request/response schemas |
| `pydantic-settings` | env-based config, 12-factor per [[wiki/CodeContext/Standards/design-principles|Design principles]] |
| `sqlalchemy` 2.0 | ORM, now against Postgres |
| `alembic` | schema migrations — a hand-run `CREATE TABLE` has no audit trail and can't be reviewed in a PR |
| `psycopg[binary]` (v3) | Postgres driver; SQLAlchemy 2.0's native async-capable driver, no reason to use the older psycopg2 on a new project |
| `mangum` | wraps FastAPI to run on Lambda unmodified |
| `boto3` | S3, DynamoDB, EventBridge, Secrets Manager, SES, SNS clients |
| `aws-lambda-powertools` | structured JSON logging to stdout (observability requirement in [[wiki/CodeContext/Standards/design-principles|Design principles]]), plus its **Idempotency** utility — this *is* the DynamoDB idempotency-key mechanism [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] specifies for the ingestion pipeline, not a hand-rolled table check |
| `PyJWT[crypto]` | verifies Cognito-issued JWTs server-side on every request (replaced `python-jose` on 2026-10-06: CVE-2026-85394, no fixed release) — [[wiki/CodeContext/Standards/security|Security]] requires this never be trusted from client claims alone |
| `pillow` | media pipeline: real file-type verification, EXIF strip, thumbnail generation |
| `python-multipart` | FastAPI multipart/form-data parsing for uploads |
| `email-validator` | backs Pydantic's `EmailStr` for registration |

Dev/test only (`[project.optional-dependencies].dev` — never in the Lambda image):
| Package | Why |
|---|---|
| `pytest`, `pytest-asyncio`, `pytest-cov` | test runner + async support + coverage |
| `httpx` | FastAPI's test client |
| `moto` | mocks S3/DynamoDB/EventBridge/Secrets Manager/SES/SNS in unit tests — no real AWS calls or credentials needed to run the suite |
| `testcontainers[postgres]` | integration tests run against a real ephemeral Postgres, not sqlite — a `tsvector` search test or a constraint test is meaningless against a different database engine |
| `factory-boy`, `faker` | test data generation |
| `freezegun` | deterministic time for TTL/idempotency-key tests |
| `ruff` | lint + format in one tool (replaces flake8/isort/black) |
| `mypy` (strict) | type checking — cheap to run given Pydantic v2/SQLAlchemy 2.0 are both fully typed already |
| `pip-audit` | CVE scan in CI, blocks merge on a hit, per [[wiki/CodeContext/Standards/security|Security]] |
| `pre-commit` | runs lint/format before a commit reaches an agent's context |

Exact versions are pinned as minimums in `pyproject.toml`; lock with `pip-compile`/`uv lock` once the app exists and let Dependabot + `pip-audit` keep the lock current — don't hand-maintain exact pins here.

## Frontend — npm packages (`frontend/package.json`)

Runtime:
| Package | Why |
|---|---|
| `react`, `react-dom` | carried over per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] |
| `react-router-dom` | routes: feed, profile, stats page, search tab, notifications |
| `@tanstack/react-query` | server-state cache for feed/notifications — handles refetch/cache invalidation instead of hand-rolled `useEffect` fetch logic |
| `zustand` | minimal client-only state (compose draft, mention-autocomplete UI state) — deliberately not Redux, KISS per [[wiki/CodeContext/Standards/design-principles|Design principles]] |
| `openapi-fetch` + `openapi-typescript` (dev) | typed API client generated from FastAPI's own OpenAPI schema — the backend's Pydantic schemas are the single source of truth for the contract, not a hand-maintained TS type file |
| `amazon-cognito-identity-js` | direct Cognito User Pool SDK for the custom login/register UI — lighter than pulling in full AWS Amplify for auth alone |
| `date-fns` | post timestamps, DOB formatting |

Dev/test:
| Package | Why |
|---|---|
| `vite`, `@vitejs/plugin-react` | build tool, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] |
| `vitest`, `jsdom` | Vite-native test runner, no separate Jest config/transform needed |
| `@testing-library/react` + `jest-dom` + `user-event` | component tests written against user-visible behavior, not implementation details |
| `msw` | mocks the API at the network layer in tests — exercises the real `openapi-fetch` client instead of mocking it away |
| `eslint` + `@typescript-eslint/*` + `eslint-plugin-react-hooks`, `prettier` | lint/format, npm audit + Dependabot cover CVE scanning per [[wiki/CodeContext/Standards/security|Security]] |

## Infra — CDK language choice (`infra/package.json`)

**CDK in TypeScript**, not Python. [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] leaves this open but leans TS; deciding now: the frontend already requires a Node toolchain, so CDK-in-TS adds zero new tooling to the repo, whereas CDK-in-Python would need its own venv/dependency tree kept separate from `backend/`'s Lambda runtime deps (mixing infra-only packages like `aws-cdk-lib` into the Lambda dependency tree would bloat the deployed image for no reason). One language for infra+frontend, one for the Lambda runtime — cleaner split than one language for infra+backend with the frontend as the odd one out.

## Docker containers — one per deployable/buildable piece

| Piece | Dockerfile | Base image | Deployed how |
|---|---|---|---|
| API Lambda | `docker/backend.Dockerfile`, target `lambda` | `public.ecr.aws/lambda/python:3.12` | Pushed to ECR, referenced by a CDK `DockerImageFunction`, command = `app.main.handler` |
| Ingestion Lambda | same image, different command override | same | Same ECR image, CDK overrides `imageConfig.command` — no separate image to build/scan/patch |
| Media-processing Lambda | same image, different command override | same | Same ECR image, different command override |
| Notifications Lambda | same image, different command override | same | Same ECR image, command = `app.notifications.lambda_handler.handler` |
| Migration runner | same image, different command override | same | Same ECR image, command = `app.migrate.handler`. **Invoked by a human, by nothing else** — no rule, schedule, event source mapping or custom resource (`INFRA-003`; see [[wiki/CodeContext/Modules/0x00-architecture|0x00 Architecture]] Known gaps) |
| Backend tests | `docker/backend.Dockerfile`, target `test` | same | Never deployed — run by `docker-compose.yml` locally and by CI |
| Frontend build | `docker/frontend.Dockerfile`, target `build`/`export` | `node:20-alpine` | Output `dist/` uploaded by `CdnStack`'s `BucketDeployment` when `cdk deploy -c deployFrontend=true` is used (`INFRA-002`), **not** `aws s3 sync`; the container itself is discarded |
| Frontend tests | `docker/frontend.Dockerfile`, target `test` | `node:20-alpine` | Never deployed — same as backend tests |
| CDK deploy | `docker/cdk-deploy.Dockerfile` | `node:20-alpine` | Never deployed or pushed. It pins the exact CDK CLI/Node version and adds a docker client for the backend asset build. `deploy.yml` runs every `cdk diff`/`cdk deploy` through it |

**Why one shared image for all five Lambdas instead of five separate images**: they have an identical dependency set (`backend/pyproject.toml`) and differ only in which function gets invoked. Building five images would multiply the build/scan/ECR-storage cost for zero behavioral difference — DRY per [[wiki/CodeContext/Standards/design-principles|Design principles]]. If one of them ever needs a dependency the others don't (unlikely at this app's size), split it then, not preemptively (YAGNI).

This is load-bearing for the migration runner specifically, and `infra/test/app-stack.test.ts` enforces it: the `Migration` function's `Code.ImageUri` must be byte-identical to the api function's and the assembly must contain exactly one docker image, so the code that migrates the schema cannot drift from the code that runs against it.

**Why container images over zip+layers for Lambda**: Pillow + boto3 + SQLAlchemy + the AWS SDK easily exceed the 250MB unzipped zip+layers limit once you add the ingestion and media-processing paths' dependencies together into one deployment unit; container images support up to 10GB and let `pip install` resolve normally instead of hand-managing layer contents. Cold start is marginally worse than a minimal zip but not enough to matter at this app's traffic level.

## CI/CD wiring
GitHub Actions (OIDC-federated role, no long-lived keys, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]):
- On PR: build `docker/backend.Dockerfile` target `test` and `docker/frontend.Dockerfile` target `test`, run both, results distilled to `wiki/GeneralContext/Reports/test-runs/`, not fed raw into any interactive agent's context.
- `pip-audit` and `npm audit`/Dependabot run in CI per [[wiki/CodeContext/Standards/security|Security]] and block merge on an unpatched critical.

**Deploying is a separate workflow, `.github/workflows/deploy.yml`, run on merge to `main` and approved by a human** ("Automated deploy" below). It is not reachable from the agent workflows (`.ai/docs/handoff.md` §5.7). `.github/workflows/test-agent.yml` is the **one authoritative test executor**, and its `gate` job is a required check on `main` alongside `agent-guard.yml`'s `guard-gate`.

The first deploy was **a human at a terminal**, in this order:

1. `cdk deploy` — all eight stacks. **Done 2026-09-30.**
2. Invoke the `Migration` function once, by hand (`INFRA-003`). Until this runs, RDS has no tables and the other four Lambdas fail against it. **Done 2026-09-30**, returned `{"revision": "f4a1c9d2b6e7"}`.
3. Read `Fanwire-Auth`'s outputs and build `frontend/dist` against them — Vite bakes them in at build time, so the bundle cannot be built before the pool exists ([[wiki/CodeContext/Modules/0x08-frontend|0x08 Frontend]]). **Done 2026-09-30.**
4. `cdk deploy Fanwire-Cdn --exclusively -c deployFrontend=true` — uploads `dist/` and invalidates the distribution (`INFRA-002`). **Done 2026-09-30**, 98 s.

Between steps 1 and 4 the site serves an S3 `403 AccessDenied` XML document rather than a 404 or an error page. That is the expected state of a correct, empty bucket behind a correct distribution, and it is explained in [[wiki/CodeContext/Modules/0x00-architecture|0x00 Architecture]] → "First deploy, 2026-09-29" along with everything else the first deploy established.

### Rebuilding the SPA

Every frontend change reaches production this way. The human runs each line, from the repo root unless stated; the pool and client ids are `Fanwire-Auth`'s outputs and do not change unless that stack is replaced.

1. `Remove-Item -Recurse -Force frontend\dist` — a stale `dist` is worse than none, because the deploy would upload it.
2. Build **in Docker**, never with a bare `npm run build`: `frontend/.env.local` holds the *dev* pool and Vite reads it in production mode too, so one missing variable would silently ship the dev pool. `.dockerignore` excludes it, and the `build` stage fails on any empty value.
   `docker build -f docker\frontend.Dockerfile --target export --output frontend --build-arg VITE_API_BASE_URL=/api --build-arg VITE_MEDIA_BASE_URL=https://fanwire.daviddems.com --build-arg VITE_COGNITO_REGION=ca-central-1 --build-arg VITE_COGNITO_USER_POOL_ID=ca-central-1_eSfPUMRq8 --build-arg VITE_COGNITO_CLIENT_ID=1vskugrl60gggpt0lmib4ka85j .`
   `VITE_MEDIA_BASE_URL` is the **site origin**, not `/media`: public keys already start with `media/` and CloudFront forwards `/media/*` unchanged.
3. Check the bundle before uploading it: each production id appears in `dist/assets/*.js`, and neither dev id (from `frontend/.env.local`) appears at all. Count each value separately — the bundle is one minified line, so a multi-pattern `Select-String` reports only the first match and looks like a false failure.
4. From `infra/`: `npx cdk deploy Fanwire-Cdn --exclusively -c deployFrontend=true --profile fanwire-workload`. `--exclusively` skips the seven unchanged stacks (and rebuilding the backend image). A deploy that adds the `BucketDeployment` handler asks to approve its IAM; the set is pinned in `infra/test/iam-policy.test.ts`.
5. `(Invoke-WebRequest https://fanwire.daviddems.com/ -UseBasicParsing).Content` names the new `index-*.js`.

### Upgrading the NAT instance's AMI

The NAT instance's AMI is pinned in `infra/cdk.json` as `natImageId`, and `loadConfig` rejects anything that is not `ami-` followed by 8–17 lowercase hex digits. Nothing changes it except a PR. Every upgrade **replaces the instance**: CloudFormation creates a new one, repoints both app subnets' default routes to it, and deletes the old one. In-VPC Lambdas therefore have no egress for a few minutes while the new instance boots and runs `NAT_BOOTSTRAP`.

**Cadence (human decision 2026-10-02): on advisories only, with no schedule.** Upgrade when an Amazon Linux 2023 security advisory (`https://alas.aws.amazon.com/alas2023.html`) affects something the NAT path runs: the kernel, iptables, or the SSM agent. Otherwise leave it alone.

The human runs each line:

1. Look up the current image: `aws ssm get-parameter --profile fanwire-workload --region ca-central-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64 --query Parameter.Value --output text`
2. In a PR, change `natImageId` in `infra/cdk.json`. Change the same literal in `infra/test/config.test.ts` ("cdk.json defaults") and `infra/test/network-stack.test.ts`, which pin it so that a change to the AMI is visible in review. Merge it.
3. From `infra/`, on the merged `main`: `npx cdk diff Fanwire-Network --profile fanwire-workload`. Expect exactly three changes: the instance's `ImageId` (requires replacement) and the two app-subnet routes' `InstanceId`. Anything else means the branch is wrong or something else changed, so stop.
4. At a quiet moment: `npx cdk deploy Fanwire-Network --exclusively --profile fanwire-workload`. It prints `WARNING ImageId: Hardcoded AMI ID ... CloudFormation-Validate::W9010`. That warning is about portability across regions, and the hardcoded id is deliberate here, so leave it unacknowledged. Without `--exclusively`, nothing else would deploy anyway, since Network has no dependencies. Pass it so the habit is the same for every stack.
5. Confirm the new instance: `aws ec2 describe-instances --profile fanwire-workload --region ca-central-1 --filters Name=tag:aws:cloudformation:stack-name,Values=Fanwire-Network Name=instance-state-name,Values=running --query "Reservations[].Instances[].[InstanceId,ImageId]" --output text`, which shows the new AMI.
6. Check egress with a logged-in `/api/users/me` on the site. `/api/health` proves nothing here, because it never leaves the VPC. If it fails, read the bootstrap's console log: `aws ec2 get-console-output --profile fanwire-workload --region ca-central-1 --instance-id <id> --latest --output text`.

`cdk-hnb659fds-cfn-exec-role` must allow `iam:PassRole` to `ec2.amazonaws.com` for the new instance's profile. The policy simulator says it does. The first upgrade is the first real call. If it fails with `AccessDenied` and the rollback sticks, the escape hatch is in `infra/iam/README.md`.

`docker/cdk-deploy.Dockerfile` pins the CDK CLI/Node version. `deploy.yml` runs it, and a human at a terminal can run it the same way.

### Automated deploy — `.github/workflows/deploy.yml`

A standalone workflow deploys all eight stacks as `GitHubActionsDeployRole`. It runs on every merge to `main` that changes a deployable path, and on a manual dispatch, and every run waits for the `production` environment's required reviewer. It is not reachable from the agent workflows (`.ai/docs/handoff.md` §5.7), and `.ai/tests/test_deploy_workflow.py` pins both that boundary and the workflow's shape.

**The boundary.** The role's trust names the GitHub environment `production` (`token.actions.githubusercontent.com:sub` = `repo:DavidDems@71515505/fanwire@1373722771:environment:production`, GitHub's immutable subject form with the owner and repo ids, which this repo's OIDC settings use; committed at `infra/iam/github-actions-deploy-role-trust-policy.json`), not a branch. A branch trust (`ref:refs/heads/main`, what it held before) admits any job of any workflow run from `main`, and the agent workflows run from `main` too. Now only a job that declares `environment: production` can assume the role. The test fails if any workflow other than `deploy.yml` requests `id-token`, declares an environment, or names `deploy.yml`, and `agent-guard` keeps workers out of `.github/` with no exception. The environment carries the two checks the trust no longer makes: **deployment branches restricted to `main`**, and **a required reviewer**. Removing the branch restriction would let a dispatch from any branch deploy that branch.

**What a run does**, in one job (`concurrency: deploy-production`, `cancel-in-progress: false`, so a second run waits instead of cancelling a CloudFormation update partway through):

1. Builds `frontend/dist` in Docker (`docker/frontend.Dockerfile`, target `export`) from five **environment variables** on `production` (not secrets: the workflow reads `vars.`, which never sees secrets, so a secret arrives empty and the build fails): `VITE_API_BASE_URL`, `VITE_MEDIA_BASE_URL`, `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID`. They are ids that end up in the public bundle anyway. Their values are `Fanwire-Auth`'s outputs and the site origin, the same as "Rebuilding the SPA" step 2, **never** `frontend/.env.local`, which holds the dev pool and the dev media bucket. It then checks that the pool id, client id and media origin are in the bundle.
2. Builds `docker/cdk-deploy.Dockerfile` and runs the pinned CLI from it, with the checkout mounted at `/repo` (the backend `DockerImageAsset` builds from the repo root) and the runner's Docker socket mounted for that build. An anonymous volume over `/repo/infra/node_modules` keeps the image's pinned install visible through the mount.
3. `cdk diff -c deployFrontend=true`, logged, then `cdk deploy --all -c deployFrontend=true --require-approval never`. **Every** call passes `deployFrontend=true`: without it a deploy of `Fanwire-Cdn` removes the live `BucketDeployment`, and a diff without it shows that removal.

**`--require-approval never`.** CI cannot answer CDK's prompt to approve IAM changes. The review of an IAM change therefore happens at the PR, through `infra/test/iam-policy.test.ts` and the human reviewer, and nowhere else.

**What it does not do:**

- **Write `FanwireCdkCfnExecPolicy` or `FanwireRoleBoundary`.** The deploy role cannot, and the workflow makes no IAM write or bootstrap call. It only reads both, through the lookup role, to check they match the repo. A stack change that needs a new AWS service still needs the human to roll out a new policy version **before** dispatching (`infra/iam/README.md`).
- **Run migrations.** Invoking the `Migration` function needs `lambda:InvokeFunction`, which the deploy role does not have. Human decision 2026-10-02: it stays manual, to be revisited with the permissions boundary. After a deploy that adds an Alembic revision, the human finds the function with `aws lambda list-functions --profile fanwire-workload --region ca-central-1 --query "Functions[?contains(FunctionName,'Migration')].FunctionName" --output text`, then runs `aws lambda invoke --profile fanwire-workload --region ca-central-1 --function-name <name> $env:TEMP\migrate.json; Get-Content $env:TEMP\migrate.json` and checks that it returns the new head revision.
- **Deploy a merge that changes nothing AWS is built from.** Human decision 2026-10-05, after two clean dispatched runs: the workflow runs on `push` to `main`, filtered by `paths` to what a stack, the backend image or the bundle is built from: `backend/**`, `frontend/**`, `docker/**`, `.dockerignore`, `infra/bin/**`, `infra/lib/**`, `infra/cdk.json`, `infra/package.json`, `infra/package-lock.json` and `deploy.yml`. Markdown files and frontend test files are excluded. **`wiki/` and `.ai/` never trigger it.** The agent system runs in GitHub Actions and no stack reads it. Neither do `infra/test/` (tests change no template) or `infra/iam/` (applied by a human, never by CDK). `backend/tests/` does trigger it, because the image asset hashes it. A merge outside these paths deploys nothing. Dispatch by hand when needed, for instance after rolling out a new `FanwireCdkCfnExecPolicy` version. `.ai/tests/test_deploy_workflow.py` pins the list.
- **Deploy without approval.** Every run waits for the required reviewer, so a merge queues a deploy rather than starting one. GitHub keeps one *pending* run per concurrency group: merging twice while a deploy runs leaves only the newer one waiting, which is harmless because it deploys `main` as of that merge.
- **The first deploy.** The production Cognito ids do not exist until `Fanwire-Auth` has deployed, so the bundle cannot be built before then (`TODO/04-first-deploy.md` §4). That deploy has already happened by hand, so every deploy from now on is the steady-state case.

**Setup, once, by the human, before the first dispatch** (each a single line). **Done**: steps 1–3 on 2026-10-03 (step 1 re-applied 2026-10-05 with the immutable subject, PR #87), and the first successful dispatch on 2026-10-05 (run 37256951096; [[wiki/CodeContext/Modules/0x00-architecture|0x00]] → "AWS account state" records what it proved).

1. Apply the trust: `aws iam update-assume-role-policy --profile fanwire-workload --role-name GitHubActionsDeployRole --policy-document file://infra/iam/github-actions-deploy-role-trust-policy.json`. Run it from the repo root with this file present. Nothing else assumes the role, so applying it before the merge breaks nothing. To undo it, apply the same JSON with `sub` set to `repo:DavidDems@71515505/fanwire@1373722771:ref:refs/heads/main`. If a login is refused, read the subject GitHub actually sent from CloudTrail: `aws cloudtrail lookup-events --profile fanwire-workload --region ca-central-1 --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity --max-results 3 --query "Events[].[EventTime,Username]" --output table`. Confirm it with `aws iam get-role --profile fanwire-workload --role-name GitHubActionsDeployRole --query Role.AssumeRolePolicyDocument`.
2. Create the environment: repo Settings → Environments → New environment `production`. Under **Required reviewers**, add yourself. Under **Deployment branches and tags**, choose *Selected branches and tags* and add the rule `main`.
3. Set the five environment variables on `production`, one line each: `gh variable set VITE_API_BASE_URL --env production --body /api`, `gh variable set VITE_MEDIA_BASE_URL --env production --body https://fanwire.daviddems.com`, `gh variable set VITE_COGNITO_REGION --env production --body ca-central-1`, `gh variable set VITE_COGNITO_USER_POOL_ID --env production --body ca-central-1_eSfPUMRq8`, `gh variable set VITE_COGNITO_CLIENT_ID --env production --body 1vskugrl60gggpt0lmib4ka85j`. Check the ids against `aws cloudformation describe-stacks --profile fanwire-workload --region ca-central-1 --stack-name Fanwire-Auth --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output table`. `VITE_MEDIA_BASE_URL` is the site origin, with no `/media` and no trailing slash.
4. Dispatch: `gh workflow run deploy.yml --ref main`. Approve it in the Actions tab, then **read the `cdk diff` step's log**. Expect `Fanwire-App` to change only when `backend/` or `docker/backend.Dockerfile` has changed, because the image asset hashes only those (its `exclude` list in `app-stack.ts`). Expect `Fanwire-Cdn` to show `FrontendDeployment` `SourceObjectKeys` changing whenever the bundle differs. A change to `Fanwire-Network`'s instance means something is wrong.
5. After the run, check `/api/users/me` **as the app calls it**: log in, open the browser's developer tools → Network, and find the `me` request. It should return 200 with your profile. Typing `/api/users/me` into the address bar returns `401 {"detail":"Missing Authorization header"}` by design, because the app sends its Cognito token as a `Bearer` header from JavaScript, not as a cookie. That 401 proves CloudFront → API Gateway → the api Lambda, but nothing past it.

**The permissions boundary.** Every role the stacks create carries `FanwireRoleBoundary` (`infra/iam/README.md`), so a template that gives a role `*:*` no longer reaches admin through it. Getting a template deployed, which now means getting a PR merged and its deploy approved, can do no more than the boundary's actions allow.

**The live-IAM check.** Before any CDK call, every run reads the default versions of `FanwireCdkCfnExecPolicy` and `FanwireRoleBoundary` through the CDK lookup role (read-only) and stops unless both equal the committed files. A PR that changes either file therefore deploys only after the human has rolled the new version out (`infra/iam/README.md` has the commands). The run fails with an error naming the policy until then, and approving it again after the rollout is enough. It also catches the reverse: a policy changed by hand and not committed.

## Local dev (`docker-compose.yml`)
`postgres` (real Postgres, matching RDS — not sqlite) and `dynamodb-local` back the `backend-test` and `frontend-test` one-shot services. This compose file is dev/test tooling only; it is never what's deployed.
