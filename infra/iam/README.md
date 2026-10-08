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
`fanwire-workload` that `.github/workflows/deploy.yml` assumes. Its trust
policy is the next file.

It grants exactly one action — `sts:AssumeRole` — on the eight CDK bootstrap
roles (four per region, `ca-central-1` and `us-east-1`). Nothing else. CI cannot
touch a single application resource directly; it can only step into the roles
`cdk bootstrap` created for that purpose.

Requires `cdk bootstrap` to have been run in both regions with the default
`hnb659fds` qualifier, or these ARNs do not exist. What is attached, when, and
what it proved are in `wiki/CodeContext/Modules/0x00-architecture.md` →
"AWS account state" → "CI access (OIDC)".

## `github-actions-deploy-role-trust-policy.json`

The trust policy for the same role. It admits one OIDC subject,
`repo:DavidDems@71515505/fanwire@1373722771:environment:production`, which is a job that declares
the GitHub environment `production`. It does **not** admit a branch.

The subject is GitHub's **immutable** form: the repository has
`use_immutable_subject` on (`gh api repos/DavidDems/fanwire/actions/oidc/customization/sub`),
so the owner and repo carry their numeric ids, and a deleted and re-created
`DavidDems/fanwire` would not match. The plain `repo:DavidDems/fanwire:…`
form was refused on the first run (CloudTrail, 2026-10-05). If that setting
ever changes, this file has to change with it.

It used to name `ref:refs/heads/main`, which admits *every* workflow run from
`main`, including the agent workflows. An environment subject admits only
jobs that opt in, and `.ai/tests/test_deploy_workflow.py` fails if any
workflow except `deploy.yml` does. The branch check moves into the
environment: deployment branches restricted to `main`, plus a required
reviewer. Both are repository settings, not files, so a human sets them up
once (`wiki/CodeContext/Standards/build-deployment.md` → "Automated deploy").

Applied by hand, and gated by that test rather than by an infra test:

```powershell
aws iam update-assume-role-policy --profile fanwire-workload --role-name GitHubActionsDeployRole --policy-document file://infra/iam/github-actions-deploy-role-trust-policy.json
```

## `cdk-cfn-exec-role-policy.json`

The permissions policy for `cdk-hnb659fds-cfn-exec-role-294321867941-*` in
**both** regions — the role CloudFormation itself acts as when it creates,
updates and rolls back this app's eight stacks. It replaces the bootstrap
default, `AdministratorAccess`. One customer-managed policy,
`FanwireCdkCfnExecPolicy`, serves both regions because IAM is global.

Unlike the file above, this one **is** gated by CI:
[`../test/cfn-exec-policy.test.ts`](../test/cfn-exec-policy.test.ts). It still
is not applied by anything automatic.

### Deliberately scoped, not least-privilege

A policy that is missing one permission fails a deploy halfway through, and
**the rollback needs permissions too**. A stack can end up in
`UPDATE_ROLLBACK_FAILED`, where it can neither move forward nor back. That is
worse than a wide role. So most of the policy grants whole **services**
(`rds:*`, `lambda:*`, …) rather than a list of actions. The service list comes
from the resource types in the synthesized templates. Every action
CloudFormation actually called during the 2026-09-29 → 2026-10-01 deploys,
3,789 calls taken from CloudTrail, was checked against it and is allowed.

A service-wide grant is less dangerous here than it looks. The exec role is
only ever used *through* CloudFormation resource types, so `guardduty:*`
does exactly what `AWS::GuardDuty::*` resources can do and nothing more. The
exception is IAM. A template that can create a role with any policy, and hand
that role to a Lambda it also defines, gets whatever access that role has. So
IAM is the one service granted action by action:

| Statement | What it allows | Why it is safe enough |
|---|---|---|
| `IamReads` | `iam:Get*`, `iam:List*` on `*` | Reads only. CloudFormation's pre-deploy validation checks the role's own policies and the account summary. |
| `IamManageFanwireRoles` / `…InstanceProfiles` | create, update, delete, tag, inline-policy on `role/Fanwire-*` and `instance-profile/Fanwire-*` | It cannot touch `GitHubActionsDeployRole`, the `cdk-*` bootstrap roles, or any other role in the account. |
| `IamAttachOnlyLambdaBasicExecution` | `iam:AttachRolePolicy`, but only for `AWSLambdaBasicExecutionRole` | It cannot attach `AdministratorAccess`, or any other managed policy, to a role it creates. |
| `IamPassFanwireRolesToTheirServices` | `iam:PassRole` on `Fanwire-*`, only to Lambda, Scheduler, EC2 and GuardDuty malware protection | Those are exactly the services the template roles trust. |
| `IamServiceLinkedRoles` | `iam:CreateServiceLinkedRole` for RDS, API Gateway and the CloudFront logger | AWS writes the policies on service-linked roles, so creating one cannot escalate. |

**Why the scope is a name prefix, not a path.** CDK puts every role at the
default path `/`, so a path condition would restrict nothing. What the roles
do have in common is a name: CloudFormation generates it as
`<StackName>-<LogicalId>-<suffix>`, and every stack is called `Fanwire-*`. The
test fails if a stack is ever renamed outside that prefix, or if a role or
instance profile sets an explicit name or path, because either one would put a
role outside this fence.

Smaller grants: `ssm:GetParameter(s)` on the bootstrap version, the
`/cdk/exports/*` cross-region references and AWS's public AMI parameters; and
`ecr:BatchGetImage` / `GetDownloadUrlForLayer` on the CDK container-assets
repository. Creating or updating a container-image Lambda checks that the
*caller* can read the image, so the image-publishing role does not cover it.

### What this does **not** close

- ~~**Inline role policies.**~~ **Closed by the permissions boundary**
  (`fanwire-role-boundary-policy.json`, below). IAM has no condition key for
  what an inline policy says, so a template could create a `Fanwire-*` role
  with an inline `*:*` policy and reach admin through any Lambda running as
  it. Now `CreateRole`, `PutRolePolicy`, `AttachRolePolicy` and
  `PutRolePermissionsBoundary` all require `iam:PermissionsBoundary` to be
  `FanwireRoleBoundary`, so every role a template creates or adds policy to
  is capped by it, whatever the inline policy says.
- **Resource policies.** A bucket, queue, key or secret policy can grant another
  account access. Every service grant above allows writing them.

### Applying and changing it

Applied the CDK-native way, so a future `cdk bootstrap` keeps it rather than
silently reverting it. When the flag is left off, the CLI reuses the current
`CloudFormationExecutionPolicies` parameter. Never edit the role directly.

```powershell
aws iam create-policy --profile fanwire-workload --policy-name FanwireCdkCfnExecPolicy --policy-document file://infra/iam/cdk-cfn-exec-role-policy.json
```
```powershell
cd infra; npx cdk bootstrap aws://294321867941/ca-central-1 aws://294321867941/us-east-1 --profile fanwire-workload --cloudformation-execution-policies arn:aws:iam::294321867941:policy/FanwireCdkCfnExecPolicy
```

A later edit to this file goes out as a new policy **version**. The ARN does
not change, so no re-bootstrap is needed. **Roll it out before the deploy
that needs it.** `.github/workflows/deploy.yml` checks that the live default
version equals this file before any CDK call, and refuses to deploy if not.
IAM keeps at most five versions, so list them first and delete the oldest
non-default one if there are five:

```powershell
aws iam list-policy-versions --profile fanwire-workload --policy-arn arn:aws:iam::294321867941:policy/FanwireCdkCfnExecPolicy --query "Versions[].[VersionId,IsDefaultVersion,CreateDate]" --output table
```
```powershell
aws iam create-policy-version --profile fanwire-workload --policy-arn arn:aws:iam::294321867941:policy/FanwireCdkCfnExecPolicy --policy-document file://C:/Users/david/source/repos/fanwire/infra/iam/cdk-cfn-exec-role-policy.json --set-as-default
```

(`aws iam delete-policy-version --profile fanwire-workload --policy-arn <arn> --version-id v1`
removes an old one.) The full path works from any directory. A relative
`file://infra/...` works only from the repo root.

**Escape hatch.** If a deploy fails for lack of a permission and its rollback
fails for the same reason (`UPDATE_ROLLBACK_FAILED`), re-run the bootstrap
command with `--cloudformation-execution-policies
arn:aws:iam::aws:policy/AdministratorAccess`. Then run
`aws cloudformation continue-update-rollback --stack-name <stack>`, add the
missing action to this file, and switch back.

## `fanwire-role-boundary-policy.json`

`FanwireRoleBoundary`, the **permissions boundary** every role this app
creates carries. A role's effective permissions are the intersection of its
own policies and its boundary. So whatever a template writes into a role's
policies, the role can never do more than this file allows.

### What it allows

**Exactly the actions the twelve roles are granted today**, and nothing
else. That covers logs, the VPC network-interface actions, the app's data
and messaging calls, the frontend upload, the GuardDuty plan's S3 and
EventBridge wiring, the cross-region export parameters and the NAT
instance's Session Manager channel. It grants **nothing in IAM, STS or
Organizations**, so no role can create or change a role, assume one, or
touch this policy.

`infra/test/permissions-boundary.test.ts` keeps it honest in both
directions:
- **Coverage.** Every action any role is granted, in every synth mode
  (including email turned on), must be inside the boundary. Outside it, the
  grant would deploy cleanly and then fail at runtime with `AccessDenied`.
  So a PR that grants a new action fails CI until it adds the action here.
- **Ceiling.** Exact actions only, never `service:*`, and no IAM, STS or
  Organizations.

It also checks that every role carries it. Most get it from CDK's own
`@aws-cdk/core:permissionsBoundary` in `infra/cdk.json`. The two
cross-region export provider roles CDK generates miss that key, so
`infra/lib/role-boundary.ts` fills them in.

### Who enforces it

- **`FanwireCdkCfnExecPolicy`**: `CreateRole`, `PutRolePermissionsBoundary`,
  `PutRolePolicy` and `AttachRolePolicy` are conditioned on
  `iam:PermissionsBoundary` = this policy's ARN. A role without the
  boundary cannot be created, and cannot be given policy.
  `DeleteRolePermissionsBoundary` stays allowed, because a rollback of the
  deploy that set a boundary needs it. It cannot escalate: once a role's
  boundary is gone, every policy write to that role fails the condition.
- **Nothing can edit the boundary.** The exec role has no
  `iam:CreatePolicyVersion`, the deploy role has no IAM permissions at all,
  and the boundary itself grants no IAM to the roles it caps.

### Applying and changing it

Created by hand, once:

```powershell
aws iam create-policy --profile fanwire-workload --policy-name FanwireRoleBoundary --policy-document file://C:/Users/david/source/repos/fanwire/infra/iam/fanwire-role-boundary-policy.json
```

A later edit goes out as a new version. **Do this before the deploy that
uses it.** The deploy workflow checks this policy's live default version
against this file and refuses to deploy if they differ:

```powershell
aws iam create-policy-version --profile fanwire-workload --policy-arn arn:aws:iam::294321867941:policy/FanwireRoleBoundary --policy-document file://C:/Users/david/source/repos/fanwire/infra/iam/fanwire-role-boundary-policy.json --set-as-default
```

Confirm every role carries it (expect 12 names):

```powershell
aws iam list-entities-for-policy --profile fanwire-workload --policy-arn arn:aws:iam::294321867941:policy/FanwireRoleBoundary --entity-filter Role --policy-usage-filter PermissionsBoundary --query "PolicyRoles[].RoleName" --output text
```

### What it does not close

- **Resource policies**, as above. A bucket or key policy is not a role, so
  no boundary applies to it.
- **Actions inside the boundary**, on any resource. A role given
  `s3:DeleteObject*` on `*` can delete objects in every bucket. The
  boundary caps *which* actions any role can ever have, and each role's
  own policy, reviewed in the PR and gated by `iam-policy.test.ts`, decides
  *where*.

