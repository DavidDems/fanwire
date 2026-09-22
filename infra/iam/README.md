# `infra/iam/` — hand-written IAM, reviewed by a human

Everything else in `infra/` is IAM that CDK generates and
[`../test/iam-policy.test.ts`](../test/iam-policy.test.ts) gates. This folder is
the exception: policies that exist **outside** the CDK app, attached by hand to
resources the app does not create.

They live here, in Git, for the same reason the rest does — a policy you can
read in a diff is a policy you can review. Nothing in this folder is applied
automatically. There is no workflow that reads it and nothing in CI that
attaches it.

## `github-actions-deploy-role-policy.json`

The permissions policy for `GitHubActionsDeployRole`, the OIDC role in
`fanwire-workload` whose trust policy is pinned to
`repo:DavidDems/fanwire:ref:refs/heads/main`.

It grants exactly one action — `sts:AssumeRole` — on the eight CDK bootstrap
roles (four per region, `ca-central-1` and `us-east-1`). Nothing else. CI cannot
touch a single application resource directly; it can only step into the roles
`cdk bootstrap` created for that purpose.

Requires `cdk bootstrap` to have been run in both regions with the default
`hnb659fds` qualifier, or these ARNs do not exist. The rationale, the commands
and the honest accounting of what this does *not* solve are in
[`../../TODO/02-deployment-requirements.md`](../../TODO/02-deployment-requirements.md)
§3.
