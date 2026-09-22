---
name: infra-cdk
description: How fanwire's CDK app is structured, tested and constrained. Load for any task that changes infra/lib/, infra/bin/ or infra/test/.
---

# Infra (CDK)

## Running

```
cd infra; npm ci                    # once per clone - node_modules is not committed
cd infra; npm run build             # tsc type-check
cd infra; npm run synth             # cdk synth --quiet, all eight stacks
cd infra; npx jest                  # the full suite
cd infra; npm run lint              # eslint
```

**`cdk deploy` is out of scope repo-wide. Never run it**, and never add a step
that would. See `AGENTS.md`.

If `cdk` is "not recognized", `node_modules` is missing — `aws-cdk` is a
devDependency, so the binary only exists after `npm ci`.

## Layout

`infra/lib/app.ts` composes eight stacks; `STACK_NAMES` there is the single
source of names, and the tests import it. One file per stack:
`edge-stack.ts` (us-east-1: WAF + ACM cert), `network-stack.ts`,
`data-stack.ts`, `auth-stack.ts`, `storage-stack.ts`, `messaging-stack.ts`,
`app-stack.ts`, `cdn-stack.ts`.

`infra/lib/config.ts` reads CDK context into a typed `FanwireConfig` and
validates it. Context comes from `cdk.json`; tests override it per case.

## Synth must work with no AWS credentials

CI synthesizes without an account. **Nothing may need a runtime lookup** —
no `Vpc.fromLookup`, no `HostedZone.fromLookup`, no `ssm.StringParameter.valueFromLookup`.
Use the `from*Attributes` / `from*Arn` forms, which take explicit values.
`test/synth.test.ts` fails on any missing-context entry or error annotation.

## Three domain modes, all of which must synth

`test/helpers.ts` defines `DOMAIN_MODES`: `no domain`, `domain without hosted
zone`, `domain with hosted zone`. Most suites are parameterized over all three.

These overrides are merged **over** `cdk.json`'s context, so every mode sets
`domainName`, `hostedZoneId` and `hostedZoneName` explicitly. If you add a
config key with a real value in `cdk.json`, add it to each mode too — a mode
that inherits a live value is not testing the mode it names. That has already
broken the suite once.

## The IAM gate — read before writing any policy

`test/iam-policy.test.ts` walks every policy in every stack in all three modes
and **fails the build** on: any `*` in an Action or Resource, any
`NotAction`/`NotResource`, any Allow to Principal `*`, any AWS managed policy,
any IAM user or group.

Exceptions live in that file's `ALLOW_LIST`, each with a reason. The list is
also checked for rot: an entry that stops matching anything fails too.

**Do not use `grant*()`.** `grantRead()` and friends emit wildcard actions such
as `kms:GenerateDataKey*` and silently append to the CMK's key policy. Every
role here has hand-written `PolicyStatement`s, and constructs that would touch
the key get an imported `Key.fromKeyArn` handle instead. If you find yourself
adding an ALLOW_LIST entry, that is a signal to write the statement narrowly
instead — adding one is a Director decision, not a way past a red build.

Run `$env:IAM_GATE_REPORT=1; npx jest test/iam-policy.test.ts` to see every
wildcard it matched.

## Testing style

Assert against the **synthesized template**, not the construct object.
`synthFanwire(overrides)` returns a cached assembly; `template(name)` gives a
`Template` for assertions and `json(name)` the raw object. Prefer pinning the
one property the task is about over a full-template snapshot — snapshots fail
on every unrelated CDK version bump and teach nobody anything.

## Dependencies

`infra/package.json` is **denied** to the code agent. Adding a CDK module is a
supply-chain decision and a Director call. Everything in `aws-cdk-lib` is
already available — it is one package, so a new construct usually needs no new
dependency at all.
