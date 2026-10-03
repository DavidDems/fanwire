# Pins the exact Node + AWS CDK CLI version used to synth/deploy, so
# "works on my machine" can't diverge from what CI runs. Not pushed to any
# registry — built fresh per CI run / local use, per reference/AWS Stack.md's
# CDK + OIDC federation deploy model (no long-lived AWS keys baked in here).
#
# Laid out as /repo/infra so .github/workflows/deploy.yml can bind-mount the
# whole checkout at /repo: Fanwire-App's DockerImageAsset builds from the repo
# root at deploy time, and Fanwire-Cdn uploads frontend/dist. The workflow
# shields /repo/infra/node_modules with an anonymous volume, which Docker fills
# from this image, so the pinned CLI survives the mount. The docker client
# (buildx for `--platform`) talks to the runner's daemon through its socket.

FROM node:20-alpine
RUN apk add --no-cache docker-cli docker-cli-buildx
WORKDIR /repo/infra
COPY infra/package.json infra/package-lock.json ./
RUN npm ci
COPY infra/ .
ENTRYPOINT ["npx", "cdk"]
