# Single shared image for all three backend Lambdas (api, ingestion,
# media-processing) — they share one dependency set (backend/pyproject.toml),
# so one image keeps the build DRY per reference/Design principles.md.
# Each Lambda's CDK DockerImageFunction overrides `imageConfig.command` to
# point at its own handler; no rebuild/duplicate image needed per function.
#
# Base: AWS's own Lambda Python base image — required for the container-image
# Lambda deployment model called out in reference/AWS Stack.md, and it's an
# Amazon Linux image so Pillow's native deps build cleanly.

FROM public.ecr.aws/lambda/python:3.12 AS base
WORKDIR ${LAMBDA_TASK_ROOT}
COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir .
COPY backend/app ./app

# --- test stage: adds dev/test deps + test sources, entrypoint runs pytest.
# Used by docker-compose.yml locally and by the CI test-agent workflow
# (reference/Usage principals.md category 3) — never used in production.
FROM base AS test
RUN pip install --no-cache-dir .[dev]
COPY backend/tests ./tests
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
# The test stage must contain everything the suite asserts about, not just the
# application. `scripts/` and the committed OpenAPI document are here because
# test_export_openapi.py regenerates the schema and compares it to the
# committed copy — the gate that stops a changed backend route from silently
# breaking the generated TypeScript client. Without these two lines that suite
# passes locally and fails in CI, reporting a missing file rather than the
# missing COPY that caused it.
COPY backend/scripts ./scripts
# `jso[n]`, not `json`, and the brackets are load-bearing. COPY fails the build
# when a literal source is missing, but a glob matching nothing is allowed — so
# this line is valid both before FRONTEND-001 lands `backend/openapi.json` and
# after. Without it the fix could not reach `main` until the file it copies
# already existed, and the branch creating that file needs the fix to go green:
# each waiting on the other. Verified both ways against a real build.
COPY backend/openapi.jso[n] ./
ENTRYPOINT ["python", "-m", "pytest"]

# --- dev stage: `backend-dev` in docker-compose.yml — a real, clickable
# local backend for browser testing (wiki/GeneralContext/Architecture/
# dev-auth-setup.md: real Cognito pool, real Postgres, no fake auth).
# `.[dev]` pulls in uvicorn (added there rather than to the runtime
# `dependencies` list — it's a local/dev-only server, never used by the
# Lambda entry point in the `lambda` stage below). `app` itself reloads
# from docker-compose.yml's bind mount, not this COPY; alembic/scripts are
# not bind-mounted since editing a migration or the seed script mid-session
# isn't a supported workflow here.
FROM base AS dev
RUN pip install --no-cache-dir .[dev]
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY backend/scripts ./scripts
# The Lambda base image sets its own ENTRYPOINT (the Lambda Runtime
# Interface Client, which expects a handler path, not a shell command) —
# clear it so the CMD below runs directly instead of being appended as an
# argument to that entrypoint.
ENTRYPOINT []
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload"]

# --- lambda stage: this is what actually gets pushed to ECR and deployed.
# Kept last so a plain `docker build` (no --target) produces the deployable
# image by default.
FROM base AS lambda
CMD ["app.main.handler"]
