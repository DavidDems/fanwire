# Build & Deployment

**Agent-facing.** The package/dependency inventory and the container strategy for everything that gets built and deployed. Pairs with [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] (what runs where), [[wiki/CodeContext/Standards/security|Security]] (CVE/secret scanning gates), and [[wiki/CodeContext/Standards/design-principles|Design principles]] (12-factor, DRY). This doc is current-state only, same convention as `wiki/` — see `AGENTS.md`.

## State
`backend/app` (FastAPI), `frontend/src` (React) and `infra/` (CDK, TypeScript: `bin/`, `lib/`, `test/`, `cdk.json`, `package-lock.json`) all exist. `cd infra && npm ci && npm run build && npm run lint && npm test && npm run synth` synthesizes all eight stacks without AWS credentials; CI runs exactly that as the `infra-synth` job in `.github/workflows/test-agent.yml`, which makes `infra/test/iam-policy.test.ts` (no wildcard IAM outside a commented allow-list) a merge gate. **Nothing has been deployed**: there is no `cdk deploy`/`cdk bootstrap` step anywhere, and `GitHubActionsDeployRole` still has no permissions. The one shared Lambda image is a single CDK `DockerImageAsset` (repo-root context, `docker/backend.Dockerfile`, target `lambda`, `linux/amd64`) used by the api, ingestion, media, notifications and migration functions with per-function `cmd` overrides; synth only stages its context, the image is built at deploy time. Stack split, egress, and IAM exceptions: [[wiki/CodeContext/Modules/0x00-architecture|0x00 Architecture]] "Infra (CDK) — implementation notes".

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
| `python-jose[cryptography]` | verifies Cognito-issued JWTs server-side on every request — [[wiki/CodeContext/Standards/security|Security]] requires this never be trusted from client claims alone |
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
| CDK deploy | `docker/cdk-deploy.Dockerfile` | `node:20-alpine` | Never deployed or pushed — pins the exact CDK CLI/Node version CI and local dev both use to `cdk synth`/`cdk deploy` |

**Why one shared image for all five Lambdas instead of five separate images**: they have an identical dependency set (`backend/pyproject.toml`) and differ only in which function gets invoked. Building five images would multiply the build/scan/ECR-storage cost for zero behavioral difference — DRY per [[wiki/CodeContext/Standards/design-principles|Design principles]]. If one of them ever needs a dependency the others don't (unlikely at this app's size), split it then, not preemptively (YAGNI).

This is load-bearing for the migration runner specifically, and `infra/test/app-stack.test.ts` enforces it: the `Migration` function's `Code.ImageUri` must be byte-identical to the api function's and the assembly must contain exactly one docker image, so the code that migrates the schema cannot drift from the code that runs against it.

**Why container images over zip+layers for Lambda**: Pillow + boto3 + SQLAlchemy + the AWS SDK easily exceed the 250MB unzipped zip+layers limit once you add the ingestion and media-processing paths' dependencies together into one deployment unit; container images support up to 10GB and let `pip install` resolve normally instead of hand-managing layer contents. Cold start is marginally worse than a minimal zip but not enough to matter at this app's traffic level.

## CI/CD wiring
GitHub Actions (OIDC-federated role, no long-lived keys, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]):
- On PR: build `docker/backend.Dockerfile` target `test` and `docker/frontend.Dockerfile` target `test`, run both, results distilled to `wiki/GeneralContext/Reports/test-runs/`, not fed raw into any interactive agent's context.
- `pip-audit` and `npm audit`/Dependabot run in CI per [[wiki/CodeContext/Standards/security|Security]] and block merge on an unpatched critical.

**There is no deploy job, on merge or anywhere else.** No workflow pushes to ECR, uploads `dist/`, or runs `cdk deploy`: that is out of scope repo-wide pending a human IAM review (`AGENTS.md`; `.ai/docs/handoff.md` §5.7 is explicit it must not be added to the agent workflows), and `GitHubActionsDeployRole` holds only `sts:AssumeRole` on the bootstrap roles — no service permissions at all. `.github/workflows/test-agent.yml` is the **one authoritative test executor**, and its `gate` job is a required check on `main` alongside `agent-guard.yml`'s `guard-gate`.

The first deploy is therefore **a human at a terminal**, in this order:

1. `cdk deploy` — all eight stacks.
2. Invoke the `Migration` function once, by hand (`INFRA-003`). Until this runs, RDS has no tables and the other four Lambdas fail against it.
3. Read `Fanwire-Auth`'s outputs, then `npm run build` in `frontend/` with the real `VITE_*` values — Vite bakes them in at build time, so the bundle cannot be built before the pool exists ([[wiki/CodeContext/Modules/0x08-frontend|0x08 Frontend]]).
4. `cdk deploy -c deployFrontend=true` — uploads `dist/` and invalidates the distribution (`INFRA-002`).

`docker/cdk-deploy.Dockerfile` pins the CDK CLI/Node version and is what a human should synth or deploy through; nothing in CI invokes it.

## Local dev (`docker-compose.yml`)
`postgres` (real Postgres, matching RDS — not sqlite) and `dynamodb-local` back the `backend-test` and `frontend-test` one-shot services. This compose file is dev/test tooling only; it is never what's deployed.
