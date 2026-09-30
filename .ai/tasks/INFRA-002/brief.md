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

  **Measured, 2026-09-29** (prototype synth at `deployFrontend=true`, all three
  domain modes). The allow-list is genuinely needed here, and a hand-written
  statement cannot avoid it: `BucketDeployment` calls `grantRead` on the asset
  bucket and `grantReadWrite` on the destination *onto whatever role it is
  given*, so passing `role` does not suppress the grants. What appears:

  - wildcard **actions** on the handler's policy — `s3:GetBucket*`,
    `s3:GetObject*`, `s3:List*` (asset bucket), plus `s3:Abort*`,
    `s3:DeleteObject*` (destination). The existing `s3-object-arns` entry does
    **not** cover these: it matches `kind: 'resource'` only.
  - the **staging bucket's object ARN**, as a `resource` finding:
    `{"Fn::Join":["",["arn:",{"Ref":"AWS::Partition"},":s3:::cdk-hnb659fds-assets-<account>-<region>/*"]]}`.
    This one was **missing from the first version of this note** and was found
    by the test agent, which checked rather than trusting the list. It escapes
    `s3-object-arns` because that entry requires the bucket to be a
    `…Bucket…` `GetAtt`, a literal `arn:…:s3:::` prefix or an `ImportValue`,
    and CDK renders the partition here as `{"Ref":"AWS::Partition"}` — the
    `@aws-cdk/core:target-partitions` flag in `cdk.json` does not collapse it.
    Confirmed by running that entry's own regexes against the literal value,
    and then confirmed again end to end: with the implementation in place the
    gate's rot check passes, which it only can if every new entry matches a
    real statement.
  - `Resource: "*"` on the `cloudfront:GetInvalidation` /
    `cloudfront:CreateInvalidation` statement CDK adds for `distributionPaths`.
    CloudFront invalidation has no resource-level permissions.
  - `AWSLambdaBasicExecutionRole` on the handler's service role. This one
    already passes, via `cdk-custom-resource-basic-execution` — but that
    entry's *reason* names CDK's cross-region-reference provider as its only
    user, so the reason needs correcting once a second construct relies on it.

  The gate only synthesizes `DOMAIN_MODES`, i.e. with the flag **off**, so none
  of this is visible today. Criterion 6 therefore means the gate must actually
  be exercised with `deployFrontend=true`; leaving it blind to the flag
  satisfies the words of the criterion and not the criterion.
- `config.ts` already has the reader helpers and the validation pattern for
  context values. Follow the existing shape rather than inventing a new one.

## Why `helpers.ts`, `config.test.ts` and `iam-policy.test.ts` are writable here

`DOMAIN_MODES` merges over `cdk.json`, and a new config key needs to be
explicit in each mode for the same reason `hostedZoneName` did — that exact
omission broke 20 tests on 2026-09-22. `config.test.ts` pins the committed
defaults, so it changes when a default is added.

`iam-policy.test.ts` was added on 2026-09-29, after a prototype synth showed
criterion 6 was unsatisfiable without it — see the measurement in "Design
notes". Both branches of that criterion's own "or" need this file: allow-listing
a wildcard means editing `ALLOW_LIST`, and *demonstrating* the gate still passes
under the flag means adding `deployFrontend: 'true'` to the modes it walks,
which it does not do today.

The test agent owns all three files. The code agent is denied `infra/test/**` as
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
