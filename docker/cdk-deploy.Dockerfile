# Pins the exact Node + AWS CDK CLI version used to synth/deploy, so
# "works on my machine" can't diverge from what CI runs. Not pushed to any
# registry — built fresh per CI run / local use, per reference/AWS Stack.md's
# CDK + OIDC federation deploy model (no long-lived AWS keys baked in here).

FROM node:20-alpine
WORKDIR /infra
COPY infra/package.json infra/package-lock.json ./
RUN npm ci
COPY infra/ .
ENTRYPOINT ["npx", "cdk"]
