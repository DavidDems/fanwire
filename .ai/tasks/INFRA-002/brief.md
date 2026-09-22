# INFRA-002 — give the frontend bucket a deployment path

## Why this exists

This is the single thing standing between the project and a website at
`https://fanwire.daviddems.com`. Found while assessing deploy readiness on
2026-09-22 and written up in
[`TODO/02-deployment-requirements.md`](../../../TODO/02-deployment-requirements.md)
§5b item 2.

`StorageStack` creates `frontendBucket`. `CdnStack` points CloudFront's default
behaviour at it with OAC and a SPA fallback function. **Nothing anywhere in
`infra/lib/` ever puts a file in that bucket.** `cdk deploy` today produces a
correct, empty bucket behind a correct distribution, and the site returns
nothing.

The DNS, the certificate and the hosted zone are all real and verified. This is
the missing link.

## The constraint that shapes the design

`frontend/dist` is **gitignored** (`.gitignore:17`). CI synthesizes on a clean
checkout with no frontend build, so a bare
`s3deploy.Source.asset('../frontend/dist')` throws at synth time and takes
`infra-synth` and `agent-infra-test` red with it — a required check, on every
PR in the repo.

Hence the context flag. `deployFrontend` defaults **off**, so:

- CI synthesizes exactly as it does today and stays green;
- a human deploying runs `npm run build` in `frontend/` first, then
  `npx cdk deploy -c deployFrontend=true ...` from `infra/`.

The flag is the whole point of the task. A `BucketDeployment` added
unconditionally is a wrong answer that passes criterion 2 and fails 1.

## Design notes

- `aws-cdk-lib/aws-s3-deployment` is part of `aws-cdk-lib`, which is already a
  dependency. **No new package is needed**, and `infra/package.json` is in
  `forbidden_paths` — dependency changes are a Director call.
- The invalidation (criterion 4) matters more than it looks: without it,
  CloudFront serves the previous `index.html` from cache after a redeploy and
  the deploy appears to have done nothing.
- `BucketDeployment` creates a Lambda-backed custom resource with its own role.
  Expect the IAM gate to have opinions — criterion 6 is explicit that a new
  `ALLOW_LIST` entry is acceptable **if** it carries a written reason. Prefer a
  narrow hand-written statement first; read `infra-cdk`'s "IAM gate" section
  before reaching for the allow-list.
- `config.ts` already has the reader helpers and the validation pattern for
  context values. Follow the existing shape rather than inventing a new one.

## Why `helpers.ts` and `config.test.ts` are writable here

`DOMAIN_MODES` merges over `cdk.json`, and a new config key needs to be
explicit in each mode for the same reason `hostedZoneName` did — that exact
omission broke 20 tests on 2026-09-22. `config.test.ts` pins the committed
defaults, so it changes when a default is added.

The test agent owns both files. The code agent is denied `infra/test/**` as
usual.

## What this does not do

It does not build the frontend, and it does not make the site useful — the app
is still a scaffold rendering `<h1>fanwire</h1>` (Phase 5a). What it delivers
is the ability to deploy *whatever* is in `frontend/dist` and see it served
over the real domain, which is what proves the certificate, the aliases, OAC
and the SPA fallback all work.

It also does not wire deployment into any workflow. `cdk deploy` stays out of
scope repo-wide and
[`handoff.md`](../../docs/handoff.md) §5.7 is explicit that it must not be
added to the agent workflows.
