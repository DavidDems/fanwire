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

- **Inline role policies.** IAM has no condition key for what an inline policy
  says, so a template can still create a `Fanwire-*` role with an inline
  `*:*` policy and run code under it in a Lambda. In practice, anyone who can
  get a template deployed can still reach admin. What this policy removes is
  the *direct* routes: changing a role outside `Fanwire-*`, and attaching an
  AWS managed policy. Closing the inline route needs a **permissions
  boundary** that every created role must carry
  (`@aws-cdk/core:permissionsBoundary` plus a matching condition on
  `iam:CreateRole`). That changes all twelve live roles, so it is separate,
  follow-up work.
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

A later edit to this file goes out as a new policy **version**
(`aws iam create-policy-version … --set-as-default`). The ARN does not change,
so no re-bootstrap is needed. IAM keeps at most five versions.

**Escape hatch.** If a deploy fails for lack of a permission and its rollback
fails for the same reason (`UPDATE_ROLLBACK_FAILED`), re-run the bootstrap
command with `--cloudformation-execution-policies
arn:aws:iam::aws:policy/AdministratorAccess`. Then run
`aws cloudformation continue-update-rollback --stack-name <stack>`, add the
missing action to this file, and switch back.
