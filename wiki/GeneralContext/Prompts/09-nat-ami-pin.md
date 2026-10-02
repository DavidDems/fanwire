# 09 — Pin the NAT instance's AMI

**Objective:** stop `Fanwire-Network` from replacing the NAT instance whenever
AWS publishes a new Amazon Linux 2023 image. Pin the AMI in config, and make
upgrading it a deliberate, reviewed act. This blocks `10` (the automated
deploy): until it lands, an on-merge deploy would replace the NAT instance on
AWS's schedule, not ours, and cut Lambda egress for a few minutes each time.

**Read:** `00-session-protocol.md`; `wiki/CodeContext/Modules/0x00-architecture.md`
→ "Egress" (the NAT instance and its `NAT_BOOTSTRAP`) and "Outstanding" (the
drift record); `infra/lib/network-stack.ts` and `infra/lib/config.ts`;
`TODO/04-first-deploy.md` §4 "Traps".

## What is wrong today

`network-stack.ts` passes `MachineImage.latestAmazonLinux2023(...)` to
`NatProvider.instanceV2`. That synthesizes a template parameter that
CloudFormation resolves from
`/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64` on **every
deploy**. On 2026-10-02 `cdk diff` showed the instance would be replaced
(`ami-012dfd7ab44bf488a` → `ami-077869b4185223b0e`), with both app subnets'
default routes repointed. It was not deployed.

## The unit

- **Pin the running image first.** The first pinned value is
  `ami-012dfd7ab44bf488a`, the AMI the live instance runs, so this PR's deploy
  is a **no-op** for the instance. Upgrading is a separate, later decision.
  Bundling the pin with an upgrade would make the first deploy of this PR a
  replacement.
- Take the AMI from `cdk.json` context (e.g. `natImageId`) through
  `loadConfig`, validated at the boundary: it must match `^ami-[0-9a-f]{8,17}$`,
  and synth fails fast otherwise. Use `MachineImage.genericLinux({ [region]: id })`.
  No `fromLookup`: synth must stay credential-free (`synth.test.ts`).
- **Tests first:** the Network template has no `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>`
  parameter; the instance's `ImageId` equals the configured id; a malformed id
  fails `loadConfig`. Mind the instance's logical id: it carries a hash of
  `NAT_BOOTSTRAP` (0x00 "Egress"). If the logical id changes, CloudFormation
  replaces the instance anyway, so assert that it does not.
- Document the **upgrade procedure** in `wiki/CodeContext/Standards/build-deployment.md`.
  Look up the current image with
  `aws ssm get-parameter --profile fanwire-workload --region ca-central-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64 --query Parameter.Value --output text`,
  change `natImageId` in a PR, merge, then deploy `Fanwire-Network --exclusively`
  at a quiet moment and check egress afterwards (a logged-in `/api/users/me`).
  How often to do that is the human's call; ask, and record the answer.

## Prove it with the human

They run every command, one line of PowerShell at a time.

1. After merge, `cdk diff Fanwire-Network` must show **no** change to the
   instance or the routes. Only the removed SSM parameter may differ.
2. Deploy `Fanwire-Network --exclusively`. The instance id must be unchanged
   afterwards (`i-04422259f15d9d42a` as of 2026-10-02).

**This is also evidence for `07`.** It is the first real update to Network
under the scoped exec policy. The *upgrade* deploy, whenever it happens, is the
first to exercise `iam:PassRole` to `ec2.amazonaws.com` (a new instance with
the instance profile), which the policy simulator proved only in logic. Record
the result in 0x00 → "AWS account state".

Nothing here has merge permission. One PR. Merge nothing.
