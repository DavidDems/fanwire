---
type: reference
---

# Build & Deployment — packages

The dependency inventory for the backend, frontend and infra, and why each package is there. Containers, CI and deploying: [[wiki/CodeContext/Standards/build-deployment|Build & Deployment]].

## Backend — Python packages (`backend/pyproject.toml`)

Runtime (ships in the Lambda image):
| Package | Why |
|---|---|
| `fastapi` | app framework, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] |
| `pydantic` v2 | request/response schemas |
| `pydantic-settings` | env-based config, 12-factor per [[wiki/CodeContext/Standards/design-principles|Design principles]] |
| `sqlalchemy` 2.0 | ORM, against Postgres |
| `alembic` | schema migrations — a hand-run `CREATE TABLE` has no audit trail and can't be reviewed in a PR |
| `psycopg[binary]` (v3) | Postgres driver; SQLAlchemy 2.0's native async-capable driver, no reason to use the older psycopg2 on a new project |
| `mangum` | wraps FastAPI to run on Lambda unmodified |
| `boto3` | S3, DynamoDB, EventBridge, Secrets Manager, SES, SNS clients |
| `aws-lambda-powertools` | structured JSON logging to stdout (observability requirement in [[wiki/CodeContext/Standards/design-principles|Design principles]]). Its **Idempotency** utility backed the ingestion pipeline's DynamoDB idempotency keys, which have no consumer since `EVENTS-003` |
| `PyJWT[crypto]` | verifies Cognito-issued JWTs server-side on every request — [[wiki/CodeContext/Standards/security|Security]] requires this never be trusted from client claims alone |
| `pillow` | media pipeline: real file-type verification, EXIF strip, thumbnail generation |
| `python-multipart` | FastAPI multipart/form-data parsing for uploads |
| `email-validator` | backs Pydantic's `EmailStr` for registration |

Dev/test only (`[project.optional-dependencies].dev` — never in the Lambda image):
| Package | Why |
|---|---|
| `pytest`, `pytest-asyncio`, `pytest-cov` | test runner + async support + coverage |
| `httpx` | FastAPI's test client |
| `uvicorn[standard]` | ASGI server for `backend-dev` only; production runs through Mangum on Lambda |
| `moto` (extras `s3, dynamodb, events, secretsmanager, ses, sns, cognitoidp`) | mocks those AWS services in unit tests — no real AWS calls or credentials needed to run the suite |
| `testcontainers[postgres]` | integration tests run against a real ephemeral Postgres, not sqlite — a `tsvector` search test or a constraint test is meaningless against a different database engine |
| `factory-boy`, `faker` | test data generation |
| `freezegun` | deterministic time for TTL/idempotency-key tests |
| `ruff` | lint + format in one tool (replaces flake8/isort/black) |
| `mypy` (strict) | type checking — cheap to run given Pydantic v2/SQLAlchemy 2.0 are both fully typed already |
| `pip-audit` | CVE scan in CI, blocks merge on any unignored finding, per [[wiki/CodeContext/Standards/security|Security]] |
| `pre-commit` | runs lint/format before a commit reaches an agent's context |

Runtime and most dev dependencies are minimums (`>=`); `ruff` and `mypy` are pinned exactly (`==`). There is no backend lockfile. Renovate proposes updates and `pip-audit` gates CVEs — don't hand-maintain exact pins here.

## Frontend — npm packages (`frontend/package.json`)

Runtime:
| Package | Why |
|---|---|
| `react`, `react-dom` | per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] |
| `react-router-dom` | routes: feed, profile, stats page, search tab, notifications |
| `@tanstack/react-query` | server-state cache for feed/notifications — handles refetch/cache invalidation instead of hand-rolled `useEffect` fetch logic |
| `zustand` | declared for minimal client-only state (deliberately not Redux, KISS per [[wiki/CodeContext/Standards/design-principles|Design principles]]); no file under `frontend/src` imports it today |
| `openapi-fetch` + `openapi-typescript` (dev) | typed API client generated from FastAPI's own OpenAPI schema — the backend's Pydantic schemas are the single source of truth for the contract, not a hand-maintained TS type file |
| `amazon-cognito-identity-js` | direct Cognito User Pool SDK for the custom login/register UI — lighter than pulling in full AWS Amplify for auth alone |
| `date-fns` | post timestamps, DOB formatting |

Dev/test:
| Package | Why |
|---|---|
| `typescript` | type checking (`npm run typecheck`) |
| `vite`, `@vitejs/plugin-react` | build tool, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] |
| `vitest`, `jsdom` | Vite-native test runner, no separate Jest config/transform needed |
| `@testing-library/react` + `jest-dom` + `user-event` | component tests written against user-visible behavior, not implementation details |
| `msw` | mocks the API at the network layer in tests — exercises the real `openapi-fetch` client instead of mocking it away |
| `eslint` + `@typescript-eslint/*` + `eslint-plugin-react-hooks`, `prettier` | lint/format; `npm audit`, Dependabot alerts and Renovate cover CVEs and updates per [[wiki/CodeContext/Standards/security|Security]] |

## Infra — CDK language choice (`infra/package.json`)

**CDK in TypeScript**, not Python. The frontend already requires a Node toolchain, so CDK-in-TS adds no new tooling, whereas CDK-in-Python would need its own dependency tree kept apart from `backend/`'s Lambda runtime deps (infra-only packages like `aws-cdk-lib` in the Lambda tree would bloat the image). One language for infra and frontend, one for the Lambda runtime.

Runtime dependencies are `aws-cdk-lib` and `constructs`. Dev dependencies include the `aws-cdk` CLI, `jest`/`ts-jest` and `eslint`/`typescript-eslint`.
