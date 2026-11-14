---
type: runbook
---

# Upgrading the NAT instance's AMI

Part of [[wiki/CodeContext/Standards/build-deployment|Build & Deployment]]. The NAT instance's AMI is pinned in `infra/cdk.json` as `natImageId`, and `loadConfig` rejects anything that is not `ami-` followed by 8–17 lowercase hex digits. Nothing changes it except a PR. Every upgrade **replaces the instance**: CloudFormation creates a new one, repoints both app subnets' default routes to it, and deletes the old one. In-VPC Lambdas therefore have no egress for a few minutes while the new instance boots and runs `NAT_BOOTSTRAP`.

**Cadence: upgrade on advisories only, with no schedule** ([[wiki/GeneralContext/Decisions/0019-egress-idle-cost-and-nat-ami-cadence|ADR 0019]]). Upgrade when an Amazon Linux 2023 security advisory (`https://alas.aws.amazon.com/alas2023.html`) affects something the NAT path runs: the kernel, iptables, or the SSM agent. Otherwise leave it alone.

The human runs each line:

1. Look up the current image:
   ```powershell
   aws ssm get-parameter --profile fanwire-workload --region ca-central-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64 --query Parameter.Value --output text
   ```
2. In a PR, change `natImageId` in `infra/cdk.json`. Change the same literal in `infra/test/config.test.ts` ("cdk.json defaults") and `infra/test/network-stack.test.ts`, which pin it so that a change to the AMI is visible in review. Merge it.
3. From `infra/`, on the merged `main`, diff the stack. Expect exactly three changes: the instance's `ImageId` (requires replacement) and the two app-subnet routes' `InstanceId`. Anything else means the branch is wrong or something else changed, so stop.
   ```powershell
   npx cdk diff Fanwire-Network --profile fanwire-workload
   ```
4. At a quiet moment, deploy it. It prints `WARNING ImageId: Hardcoded AMI ID ... CloudFormation-Validate::W9010`. That warning is about portability across regions, and the hardcoded id is deliberate here, so leave it unacknowledged. Without `--exclusively`, nothing else would deploy anyway, since Network has no dependencies. Pass it so the habit is the same for every stack.
   ```powershell
   npx cdk deploy Fanwire-Network --exclusively --profile fanwire-workload
   ```
5. Confirm the new instance, and keep its id for step 6. The second command prints the id and the new AMI.
   ```powershell
   $instanceId = aws ec2 describe-instances --profile fanwire-workload --region ca-central-1 --filters Name=tag:aws:cloudformation:stack-name,Values=Fanwire-Network Name=instance-state-name,Values=running --query "Reservations[0].Instances[0].InstanceId" --output text
   ```
   ```powershell
   aws ec2 describe-instances --profile fanwire-workload --region ca-central-1 --instance-ids $instanceId --query "Reservations[].Instances[].[InstanceId,ImageId]" --output text
   ```
6. Check egress with a logged-in `/api/users/me` on the site. `/api/health` proves nothing here, because it never leaves the VPC. If it fails, read the bootstrap's console log:
   ```powershell
   aws ec2 get-console-output --profile fanwire-workload --region ca-central-1 --instance-id $instanceId --latest --output text
   ```

`cdk-hnb659fds-cfn-exec-role` must allow `iam:PassRole` to `ec2.amazonaws.com` for the new instance's profile. The policy simulator says it does. No upgrade has exercised it yet. If it fails with `AccessDenied` and the rollback sticks, the escape hatch is in `infra/iam/README.md`.

`docker/cdk-deploy.Dockerfile` pins the CDK CLI/Node version. `deploy.yml` runs it, and a human at a terminal can run it the same way.
