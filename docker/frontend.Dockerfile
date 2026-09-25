# The frontend is never deployed as a running container — it's a static
# bundle served from S3 + CloudFront (reference/AWS Stack.md). Docker is
# used here only to make the *build* reproducible across local/CI, matching
# the exact Node version regardless of host machine.

FROM node:20-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .

# --- test stage: same installed deps + source, entrypoint runs vitest.
FROM deps AS test
ENTRYPOINT ["npm", "run", "test"]

# --- build stage: produces the static bundle that gets synced to S3.
# Vite inlines VITE_* at build time, so these must be the production values,
# read from the deployed stacks' outputs (TODO/04-first-deploy.md §4 phase 3):
#
#   docker build -f docker/frontend.Dockerfile --target export --output . \
#     --build-arg VITE_API_BASE_URL=/api --build-arg VITE_MEDIA_BASE_URL=... \
#     --build-arg VITE_COGNITO_REGION=... --build-arg VITE_COGNITO_USER_POOL_ID=... \
#     --build-arg VITE_COGNITO_CLIENT_ID=... .
#
# The build fails if any is unset or empty. src/config.ts would throw on it
# too, but only in the browser, after the bundle has been uploaded.
FROM deps AS build
ARG VITE_API_BASE_URL
ARG VITE_MEDIA_BASE_URL
ARG VITE_COGNITO_REGION
ARG VITE_COGNITO_USER_POOL_ID
ARG VITE_COGNITO_CLIENT_ID
RUN set -eu; \
    missing=""; \
    for name in VITE_API_BASE_URL VITE_MEDIA_BASE_URL VITE_COGNITO_REGION \
                VITE_COGNITO_USER_POOL_ID VITE_COGNITO_CLIENT_ID; do \
      [ -n "$(printenv "$name" || true)" ] || missing="$missing $name"; \
    done; \
    if [ -n "$missing" ]; then \
      echo "missing --build-arg values:$missing" >&2; exit 1; \
    fi; \
    npm run build

# --- export: a scratch image whose only content is dist/, so CI can pull
# the built bundle out with `docker build --target export --output dist,...`
# without needing a Node toolchain on the runner itself.
FROM scratch AS export
COPY --from=build /app/dist /dist
