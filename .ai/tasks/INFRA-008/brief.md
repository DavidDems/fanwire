# INFRA-008: the `lambda-vpc-eni` self-deny

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`0x00b-architecture-iam-gaps.md`'s review of the `lambda-vpc-eni` waiver (2026-09-30)
found `Resource "*"` on the six ENI actions is the floor AWS allows, and named the one
improvement left: the same AWS page recommends a `Deny` on those actions conditioned on
`lambda:SourceFunctionArn`. That key is present only on calls the function's own code
makes, so the Lambda service keeps managing ENIs while code running in the function
(or anything that steals its credentials) cannot create, delete or re-address network
interfaces. `TODO/02-backlog.md` carries it as a `hand` row.

## What exists

- `backendFunction` (`infra/lib/app-stack.ts`, ~line 665) builds each function's role and
  one inline `iam.Policy`; the `VpcNetworkInterfaces` Allow is spread in unless
  `outsideVpc`. Put the Deny in the same conditional, next to the Allow.
- Seven `backendFunction` calls: Api, Media, Notifications, AccountDeletion, Migration,
  SportsDataLoad in the VPC; SportsDataRefresh with `outsideVpc: true`. The
  OriginVerifyAuthorizer is built separately (~line 817) and has no VPC statement. The
  wiki still says "five" VPC-attached functions; AccountDeletion has since joined them.
- Build the ARN with `cdk.Stack.of(this)` / `this.partition`, `this.region`,
  `this.account`, `this.stackName` (`Fn::Join` in the template), with a literal
  `:function:` and `-*`. A per-function ARN would make each policy depend on its own
  function, which already depends on the policy (`fn.node.addDependency(policy)`): a cycle.
  The stack-name prefix avoids it.

## What the gate does with a Deny today

`iam-policy.test.ts` reports a finding for every `Resource "*"`, Allow or Deny. The
`lambda-vpc-eni` matcher checks only `kind`, `value` and `onlyActions`; it ignores
`Effect` and `Condition`. So the new Deny would pass the gate unchanged, and so would an
unconditioned Deny or one with a different condition. The unit tightens the entry: an
Allow as now, or a Deny that `hasCondition(f.statement, 'lambda:SourceFunctionArn')`.
Keep it narrow: the `tls-only-deny` entry is the model.

## Proof is a deploy

Synth proves the shape, not that Lambda still gets its ENIs. If the condition were wrong
in the direction of matching the service's calls, functions would fail to attach on the
next update. The PR's manual steps are the proof: signed-in `GET /api/users/me` 200 after
the deploy, and no `AccessDenied` on `ec2:` in any function's logs.

## Traps

- Commit by role: the infra tests as `test_agent`, `app-stack.ts` as `code_agent`, the
  wiki as `context_maintainer`.
- Don't add `functionName` anywhere; the condition relies on generated names.
- Don't touch `infra/iam/**`: a statement inside an existing `AWS::IAM::Policy` needs no
  new CloudFormation execution permission.
- `npm test` in `infra/` runs many synths; `--maxWorkers=2` keeps it from exhausting memory.
