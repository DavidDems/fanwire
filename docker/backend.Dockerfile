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
ENTRYPOINT ["python", "-m", "pytest"]

# --- lambda stage: this is what actually gets pushed to ECR and deployed.
# Kept last so a plain `docker build` (no --target) produces the deployable
# image by default.
FROM base AS lambda
CMD ["app.main.handler"]
