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
FROM deps AS build
RUN npm run build

# --- export: a scratch image whose only content is dist/, so CI can pull
# the built bundle out with `docker build --target export --output dist,...`
# without needing a Node toolchain on the runner itself.
FROM scratch AS export
COPY --from=build /app/dist /dist
