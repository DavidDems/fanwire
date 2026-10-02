# 07 — Scope `cfn-exec-role`, then earn an automated deploy

**Objective:** replace `cdk-hnb659fds-cfn-exec-role-*`'s `AdministratorAccess`
with a **deliberately-scoped** policy — the services these eight stacks
actually touch, with `iam:*` restricted to the path CDK creates roles under —
and get it proven against a real deploy. This is the one thing standing between
this repo and an automated CI/CD deploy on merge to `main`; `handoff.md` §5.7
prohibits deployment from the *agent* workflows, not a standalone reviewed one.

**Read:** `00-session-protocol.md`,
`wiki/CodeContext/Modules/0x00-architecture.md` "AWS account state" (the ⚠️
`cfn-exec-role` entry and the first-deploy record),
`wiki/CodeContext/Standards/build-deployment.md` → "Automated deploy — the
intended target, not yet wired", and `TODO/02-deployment-requirements.md` §2.

**Do this with the human, not for them.** They run every AWS command, one line
of PowerShell at a time, and you read the output back. You never run
`cdk deploy` or `cdk bootstrap`.

## Not least-privilege. Deliberately-scoped.

A truly minimal policy is the wrong target, and saying why is the point of this
prompt. If the policy is missing one permission, CloudFormation fails
mid-update — **and the rollback needs permissions too**, so you can land in
`UPDATE_ROLLBACK_FAILED` with a stack that can neither advance nor retreat.
That is strictly worse than a wide role.

So: scope by **service** (~15 of them), not by enumerating every action. Then
narrow `iam:*` to the role path CDK creates under, because unrestricted `iam:*`
is the one that turns a deploy credential into a privilege-escalation path.

## Method

1. **Derive it from evidence, not from a guess.** The 2026-09-29/30 deploy
   succeeded, so CloudTrail now holds every API call CloudFormation actually
   made across all eight stacks. That record did not exist before and is what
   makes this task possible at all. Enumerate the distinct
   `eventSource`/`eventName` pairs for the deploy window.

   **The starting inventory, from the synthesized templates (2026-09-30).**
   CloudTrail tells you the actions; this tells you the services, and the two
   must agree. 19 AWS services across the eight stacks: API Gateway v2, ACM,
   CloudFront, Cognito IdP, DynamoDB, EC2 (VPC, subnets, routes, SGs,
   endpoints, the NAT instance and its launch template), EventBridge, EventBridge
   Scheduler, GuardDuty (`MalwareProtectionPlan`), IAM (roles, policies, an
   instance profile), KMS, Lambda, CloudWatch Logs, RDS, Route 53, S3, SQS,
   Secrets Manager, WAFv2 — plus, once the SES PR merges, **SES**
   (`EmailIdentity`). Beyond resource types, CloudFormation also needs:
   **SSM** (`crossRegionReferences` writes and reads `/cdk/exports/*`
   parameters through two custom-resource Lambdas, and every deploy reads the
   bootstrap version parameter); `lambda:InvokeFunction` on those custom-resource
   providers and on the `BucketDeployment` handler (`-c deployFrontend=true`
   only); and `iam:PassRole` for every role it hands to a service. ECR pushes
   go through the separate image-publishing role, not this one. Regenerate the
   list with `npx cdk synth -q -o <dir>` and a count of `Resources[].Type`
   rather than trusting this paragraph once the stacks change.
2. **Commit the policy as a reviewable JSON file**, beside
   `infra/iam/github-actions-deploy-role-policy.json` and in the same spirit —
   it exists so the grant is a diff a human reads, not console state nobody
   can see.
3. **Apply it the CDK-native way:** `cdk bootstrap` with
   `--cloudformation-execution-policies <your policy ARN>`. Do **not** hand-edit
   the role — the next `cdk bootstrap` would silently revert it, which is a
   defect that hides until the worst moment.
4. **Prove it before trusting it.** A no-op `cdk deploy` over the live stacks
   exercises the update path without changing resources. Expect to iterate:
   CloudTrail misses calls it did not need to make this time, and a *change* to
   a resource needs permissions a *create* did not.

## What is out of scope here

**Do not write the deploy workflow in this PR.** A role that can deploy and a
workflow that uses it are two separate reviews, and bundling them means the
human approves both while looking at one. Land the policy, prove it, then
propose the workflow on its own.

Nothing here has merge permission. One PR. Merge nothing.
