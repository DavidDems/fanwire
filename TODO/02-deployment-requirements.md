# 02 — Deployment requirements (AWS, domain, third-party)

**Status: not blocking development.** These block `cdk deploy` and anything
that needs live AWS. The backend, frontend and the agent system all work
without them.

Collated from across the wiki. Each item cites its source — read that for the
full reasoning, not this summary.

---

## Already done — nothing needed from you

Recorded here so you do not redo them.

| Thing | State | Source |
|---|---|---|
| AWS Organizations, 3 accounts (`management`, `fanwire-workload` `294321867941`, `fanwire-log-archive` `801132668027`) | Done | [`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md) "AWS account state" |
| Root MFA on, no root access keys, root not used day-to-day | Done | same |
| IAM Identity Center SSO, `AdministratorAccess` → workload, `PowerUserAccess` → log-archive. No IAM users, no long-lived keys | Done | same |
| GitHub OIDC provider + `GitHubActionsDeployRole`, trust restricted to `repo:DavidDems/fanwire:ref:refs/heads/main` | Done — **with no permissions policy attached**, deliberately | same |
| CloudTrail `fanwire-workload-trail` → Object-Locked bucket in log-archive | Done | same |
| Dev Cognito user pool + SPA client, `backend/.env` and `frontend/.env.local` | **Done 2026-09-18** | [`dev-auth-setup.md`](../wiki/GeneralContext/Architecture/dev-auth-setup.md) *(status line is on the unmerged `phase-4-docs` branch)* |

---

## 1. Confirm GuardDuty is actually enabled — ✅ done

- [x] In the `fanwire-log-archive` account (the delegated administrator), check
      that `fanwire-workload` shows GuardDuty status **Enabled**.

**Why:** Organizations account-list propagation into the delegated-admin view
was still settling when this was set up, so it was recorded as *unconfirmed*.
Until you verify it, treat GuardDuty as not live — which matters, because
[`incident-runbook.md`](../wiki/GeneralContext/Architecture/incident-runbook.md)
is built on GuardDuty findings being the trigger, and the media pipeline relies
on GuardDuty Malware Protection to clear uploads.

**Source:** [`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md)
"AWS account state" → GuardDuty.

**Confirm:** the workload account row reads Enabled, not Pending or Invited.

**Answered 2026-09-21 — accepted.** GuardDuty reads **Enabled** in
`fanwire-workload`, confirmed from inside that account. The delegated-admin
account list is empty from `fanwire-log-archive` because listing organization
members needs Organizations read permissions, which `PowerUserAccess`
deliberately excludes (that exclusion is the point of that permission set — see
"Human access" in
[`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md)).
Checking in the account that is actually being protected is the better evidence
anyway.

Two consequences to carry forward, neither of them a problem today:

- Membership is **by invitation**, not Organizations auto-enrollment. A future
  fourth account will not self-enroll; it has to be invited the same way.
- **Malware Protection for S3 is a separate feature from GuardDuty core**, and
  it is what the media pipeline actually depends on — an upload never leaves
  `Quarantined` without a scan verdict. It can only be enabled against a bucket
  that exists, so it belongs to the first deploy, not to this checklist. Added
  to the post-deploy list in §6.

---

## 2. Buy the domain and create the hosted zone — blocks a full deploy

The CDK app defaults to `domainName = fanwire.daviddems.ca`, with optional
`hostedZoneId` / `hostedZoneName` context values.

Three modes are implemented and tested, so **you can defer this** — it changes
what you get, not whether it deploys:

| Mode | What you get | What you do |
|---|---|---|
| **No domain** (`-c domainName=`) | Distribution on `*.cloudfront.net`, no cert | Nothing. Note: CloudFront's default cert cannot enforce `TLSv1.2_2021` for viewers, and no SES identity is created |
| **Domain, no zone** | ACM cert with DNS validation; the edge stack **waits** for you to add the CNAME by hand; no alias records | Buy the domain, add one CNAME when the deploy pauses |
| **Domain + zone** *(the intended end state)* | Cert validated automatically, A/AAAA aliases | Buy the domain, create the Route 53 hosted zone, delegate the nameservers, pass `hostedZoneId`/`hostedZoneName` |

- [x] Decide which mode for the first deploy
- [x] Register the domain — **`daviddems.com`, bought at GoDaddy 2026-09-21**
- [ ] Create the hosted zone and delegate the subdomain (steps below)

**Cost:** domain registration (~$10–20/yr, registrar-dependent); Route 53
hosted zone $0.50/mo; ACM certs are free.

**Note:** CloudFront's ACM cert must be issued in `us-east-1` regardless of the
`ca-central-1` primary region. The `Fanwire-Edge` stack already handles this —
you do not need to do anything about it.

**Source:** [`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md)
(CDK app / stack table), [`aws-stack.md`](../wiki/CodeContext/Standards/aws-stack.md)
("Route 53 for DNS, ACM for TLS").

---

### 2a. The plan: delegate `fanwire.daviddems.com`, leave the apex at GoDaddy

**Decided 2026-09-21.** The app gets `fanwire.daviddems.com`. Route 53 hosts a
zone for **that subdomain only**; `daviddems.com` itself stays on GoDaddy's
nameservers.

Why this shape rather than moving the whole domain:

- **Blast radius.** Repointing the apex nameservers moves *all* DNS for
  `daviddems.com` to Route 53 at once — anything already on GoDaddy DNS (mail
  MX, verification TXT, a parked page) stops resolving the moment the change
  propagates unless it was recreated in Route 53 first. Delegating one subdomain
  touches nothing else.
- **Reversible in one step.** Undoing it is "delete four NS records at GoDaddy".
- **Same result for the app.** ACM validation, the A/AAAA aliases and SES all
  work identically against a delegated subdomain.
- **Same cost.** $0.50/mo per hosted zone either way.

The trade-off, stated honestly: the apex `daviddems.com` and any *other*
subdomain stay manual GoDaddy records, and DNS is administered in two places.
If this domain later becomes AWS-hosted for everything, moving the apex is a
separate, deliberate change — not something to bundle in now.

`infra/cdk.json` has already been updated to `domainName:
"fanwire.daviddems.com"` (and the `.ca` value is gone from the infra tests, the
backend settings test and the architecture wiki). `hostedZoneId` is still empty,
which is mode **"domain, no zone"** — deployable, but the edge stack would pause
waiting for a validation CNAME by hand. Filling in the zone id is the last step
below and turns it into the intended **"domain + zone"** mode.

### 2b. Create the hosted zone — in `fanwire-workload`

Your SSO session is expired, so start there:

```powershell
aws sso login --profile fanwire-workload
```

Then create the zone for the **subdomain**, not the apex:

aws route53 create-hosted-zone --name fanwire.daviddems.com --caller-reference "fanwire-$(date +%s)" --hosted-zone-config Comment="fanwire app - delegated from GoDaddy" --profile fanwire-workload

**Here was the output, verify if it the output is okay:**
{aws route53 create-hosted-zone --name fanwire.daviddems.com --caller-reference "fanwire-$(date +%s)" --hosted-zone-config Comment="fanwire app - delegated from GoDaddy" --profile fanwire-workload
Get-Date : Cannot bind parameter 'Date'. Cannot convert value "+%s" to type "System.DateTime". Error: "String was not recognized as a valid DateTime."
At line:1 char:96
+ ...  fanwire.daviddems.com --caller-reference "fanwire-$(date +%s)" --hos ...
+                                                               ~~~
    + CategoryInfo          : InvalidArgument: (:) [Get-Date], ParameterBindingException
    + FullyQualifiedErrorId : CannotConvertArgumentNoMessage,Microsoft.PowerShell.Commands.GetDateCommand

  {
      "Location": "https://route53.amazonaws.com/2013-04-01/hostedzone/Z04139742PYZYKIOGHWGR",
      "HostedZone": {
          "Id": "/hostedzone/Z04139742PYZYKIOGHWGR",
          "Name": "fanwire.daviddems.com.",
          "CallerReference": "fanwire-",
          "Config": {
              "Comment": "fanwire app - delegated from GoDaddy",
              "PrivateZone": false
          },
          "ResourceRecordSetCount": 2
      },
      "ChangeInfo": {
          "Id": "/change/C005441721SK0SSDZOG0Q",
          "Status": "PENDING",
          "SubmittedAt": "2026-09-22T16:54:14.245000+00:00"
      },
      "DelegationSet": {
          "NameServers": [
              "ns-1888.awsdns-44.co.uk",
              "ns-457.awsdns-57.com",
              "ns-536.awsdns-03.net",
              "ns-1448.awsdns-53.org"
          ]
      }
  }
}

**Confirm:** the output's `HostedZone.Id` looks like
`/hostedzone/Z0123456789ABCDEFGHIJ` — the bare `Z...` part is what `cdk.json`
needs. `DelegationSet.NameServers` holds the four nameservers for the next step.
To read them again later:

aws route53 get-hosted-zone --id Z04139742PYZYKIOGHWGR --profile fanwire-workload --query 'DelegationSet.NameServers' --output text

**Confirm output:**
aws route53 get-hosted-zone --id Z04139742PYZYKIOGHWGR --profile fanwire-workload --query 'DelegationSet.NameServers' --output text
ns-1888.awsdns-44.co.uk ns-457.awsdns-57.com    ns-536.awsdns-03.net    ns-1448.awsdns-53.org

### 2c. Delegate it at GoDaddy — four NS records

In GoDaddy: **My Products → `daviddems.com` → DNS → Manage Zones → Add New
Record**. Add **four** records, one per nameserver AWS gave you:

| Field | Value |
|---|---|
| Type | `NS` |
| Name | `fanwire` ← the label only, **not** the full `fanwire.daviddems.com` |
| Value | one nameserver, e.g. `ns-1234.awsdns-56.org` (trailing dot optional) |
| TTL | 1 hour |

Four records, same `Name`, different `Value`. That is correct and not a
duplicate — an NS record set has multiple values by design.

**Do not** change GoDaddy's nameservers for the domain itself, and do not add an
A record or forwarding for `fanwire` — the NS records hand the whole subdomain
to AWS, and a stray A record at the same name conflicts with the delegation.

**Confirm** (from any machine, after a few minutes — allow up to the old TTL):

nslookup -type=NS fanwire.daviddems.com 8.8.8.8

You want the four `awsdns` nameservers back. `Non-existent domain` means the
records have not propagated yet or the `Name` field included the full domain;
GoDaddy's own nameservers coming back instead means the records were not saved.

**Confirmed, here is the output:**
nslookup -type=NS fanwire.daviddems.com 8.8.8.8
Server:  dns.google
Address:  8.8.8.8

Non-authoritative answer:
fanwire.daviddems.com   nameserver = ns-536.awsdns-03.net
fanwire.daviddems.com   nameserver = ns-1448.awsdns-53.org
fanwire.daviddems.com   nameserver = ns-457.awsdns-57.com
fanwire.daviddems.com   nameserver = ns-1888.awsdns-44.co.uk

### 2d. Point the CDK app at the zone

- [ ] Put the zone id into `infra/cdk.json`:

```json
"domainName": "fanwire.daviddems.com",
"hostedZoneId": "Z0123456789ABCDEFGHIJ",
"hostedZoneName": "fanwire.daviddems.com",
```

**Done with the actual ID generated earlier**

**Confirm:** `cd infra && npm run synth` still succeeds, and
`npx jest test/cdn-stack.test.ts` passes — the "domain + zone" fixture is the
mode that emits the A/AAAA aliases.

**Confirmed with output:**
npm run synth

> fanwire-infra@0.1.0 synth
> cdk synth --quiet

Successfully synthesized to C:\Users\david\source\repos\fanwire\infra\cdk.out
Supply a stack id (Fanwire-Edge, Fanwire-Network, Fanwire-Data, Fanwire-Auth, Fanwire-Storage, Fanwire-Messaging, Fanwire-App, Fanwire-Cdn) to display its template.
67 feature flags are not configured. Run 'cdk flags --unstable=flags' to learn more.

After that, the first `cdk deploy` (still gated on §3) validates the ACM
certificate automatically by writing the validation record into the zone. No
manual CNAME, which is the whole reason for creating the zone.

**One gap to expect, not a mistake:** nothing in the stacks creates an **SES
identity** for the domain
([`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md),
"Known gaps"). Notification email is a deliberate no-op until an identity
exists — `SesEmailSender` skips sending when `NOTIFICATION_FROM_ADDRESS` is
unset and logs no PII. Verifying `fanwire.daviddems.com` in SES and leaving the
sandbox is post-deploy work, tracked in §6.

---

## 3. Review the generated IAM policies — the hard gate before any deploy

**This is the one that must not be skipped or delegated.**
`GitHubActionsDeployRole` has **no permissions policy attached**. CI cannot
deploy or touch anything until you scope its permissions deliberately, having
read the policies CDK generates.

- [x] Run `cd infra && npm run synth` and read the synthesized IAM policies
- [ ] Read the eight waivers in plain language (§3b) and decide you accept them
- [ ] Bootstrap CDK in both regions (§3c)
- [ ] Attach the scoped permissions policy to `GitHubActionsDeployRole` (§3d)
- [ ] Only then run the first `cdk deploy`

**What helps you:** `infra/test/iam-policy.test.ts` runs in CI and already
fails on any `*` in an Action or Resource, any `NotAction`/`NotResource`, any
Allow to Principal `*`, any AWS managed policy, and any IAM user or group —
across every stack in all three domain modes, including CDK-generated policies.
Run it with `IAM_GATE_REPORT=1` to list every match.

That test is the best existing example of this project's philosophy: a rule
that used to be prose, now a gate that fails the build. See
[`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) §4.

**Do not** let an agent do this step. `cdk deploy` is out of scope for agents
repo-wide (`AGENTS.md`, "never run it"), and this review is the reason.

---

### 3a. `'cdk' is not recognized` — fixed, and it was not your mistake

`infra/node_modules` did not exist. `aws-cdk` is a **devDependency**, so the
`cdk` binary lives at `infra/node_modules/.bin/cdk` and npm only puts it on
`PATH` for scripts once the dependencies are installed. Nothing was missing from
your machine and nothing needed a global install.

```powershell
cd infra; npm ci; npm run synth
```

Now succeeds: eight stacks synthesize to `infra/cdk.out` (`Fanwire-Edge`,
`-Network`, `-Data`, `-Auth`, `-Storage`, `-Messaging`, `-App`, `-Cdn`), and
`$env:IAM_GATE_REPORT=1; npx jest test/iam-policy.test.ts` passes 12/12 while printing
every wildcard it matched.

**This is worth a permanent fix, not a note.** CI installs deps so `infra-synth`
always passed, which is exactly why a local-only break went unnoticed. Added to
[`philosophy.md`](../.ai/docs/philosophy.md) §6 as a candidate: a `selfcheck`
that fails when a workspace's `node_modules` is missing would have said so in
one line.

### 3b. The eight waivers, in plain language

These are the only places the "no wildcards" rule is waived. **Seven of the
eight are shapes AWS itself requires** — a stricter policy would not be more
secure, it would not work. Read them as "here is why this one cannot be
narrower", and the risk column as what you are actually accepting.

| Waiver | What it really is | Risk you are accepting | Human acceptance |
|---|---|---|---|
| `kms-key-policy-self` | `Resource: "*"` inside the CMK's **key policy**. In a key policy, `*` means *this key* — a key policy cannot grant on any other key. | None. It is a syntax requirement; the scope is the key the policy is attached to. | ACCEPT |
| `s3-object-arns` | `<bucket>/*` for object-level actions. | Object actions need an object ARN, and `/*` means "objects in this bucket". The bucket is named explicitly. This is the intended grant. | ACCEPT |
| `tls-only-deny` | `s3:*` / `sqs:*` in a **Deny** with `aws:SecureTransport=false`. | None — this is a *hardening* statement. Broad in a Deny is the safe direction: it denies everything over plaintext HTTP. | ACCEPT |
| `lambda-vpc-eni` | Six EC2 network-interface actions with `Resource "*"`. | Real but unavoidable. `ec2:DescribeNetworkInterfaces` has no resource-level support, and Lambda validates the others against `*`. Written inline instead of using AWS's managed `AWSLambdaVPCAccessExecutionRole`, so the action list is visible and frozen. Worst case: a compromised function could enumerate ENIs in the account. | ACCEPT (but an R&D agent must look at this setup to make sure we aren't using a crude implementation)|
| `nat-instance-session-manager` | `ssm:UpdateInstanceInformation` + four `ssmmessages:*` channel actions on `*`. | AWS's documented minimum for Session Manager — it is how you get a shell on the NAT instance without opening SSH. Removing it means no way in. Scoped to the NAT instance's own role. | ACCEPT |
| `guardduty-managed-eventbridge-rule` | `rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`. | GuardDuty names its own managed rule with a generated suffix, so the prefix is the only stable form. One `*`, at the end, on a name only GuardDuty creates. | ACCEPT |
| `cdk-cross-region-export-parameters` | `parameter/cdk/exports/*` and `.../Fanwire-Cdn/*` in SSM. | CDK's mechanism for passing values between `us-east-1` and `ca-central-1` — needed only because CloudFront certs must live in `us-east-1`. Confined to the `/cdk/exports/` prefix. | ACCEPT |
| `cdk-custom-resource-basic-execution` | The AWS managed policy `AWSLambdaBasicExecutionRole`, on two roles. | The one managed policy in the app, and only on CDK's own cross-region-reference custom resources — not on any function of ours. It grants CloudWatch Logs write, nothing more. | ACCEPT |

Two structural facts that matter more than the list:

- **`grant*()` is never used anywhere in the app.** CDK's convenience grants
  emit wildcard actions like `kms:GenerateDataKey*`, so every role has
  hand-written statements, and constructs that would silently append to the
  CMK's policy get an imported `Key.fromKeyArn` handle instead. That is why the
  list is eight entries and not eighty.
- **The list cannot rot.** `iam-policy.test.ts` fails if an entry stops matching
  anything, so a waiver kept alive for a resource that no longer exists breaks
  the build.

What the gate does **not** cover, and you should know before signing: the
`GuardDuty` bucket-policy interaction and the scan-result event shape are
unverifiable without a real deploy, and `DATABASE_URL` still carries the DB
password in each function's environment (encrypted with the CMK, but readable by
anyone holding `lambda:GetFunctionConfiguration` + `kms:Decrypt`). Both are
recorded as known gaps in
[`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md).

### 3c. Bootstrap CDK — this is what makes the CI policy small

`GitHubActionsDeployRole` has no policy, and the instinct is to write one
listing every service the stacks touch. **Don't.** That policy would be hundreds
of actions wide, would need editing on every stack change, and you would be
signing off something too large to actually read — the exact failure this gate
exists to prevent.

`cdk deploy` does not need service permissions. It needs to assume four roles
that `cdk bootstrap` creates, and *those* roles do the work. So CI gets one
statement with one action, and the privileged policies are AWS-authored and
versioned by the bootstrap stack rather than hand-maintained here.

Both regions, because the CloudFront cert lives in `us-east-1`:

aws sso login --profile fanwire-workload
cd infra
npx cdk bootstrap aws://294321867941/ca-central-1 aws://294321867941/us-east-1 --profile fanwire-workload

**CONFIRMED: {✅Environment aws://294321867941/ca-central-1 bootstrapped.} & {✅Environment aws://294321867941/us-east-1 bootstrapped.}**

**Confirm:** a `CDKToolkit` stack in each region, and eight roles named
`cdk-hnb659fds-*-294321867941-<region>`:

aws iam list-roles --profile fanwire-workload --query "Roles[?starts_with(RoleName,'cdk-hnb659fds')].RoleName" --output text

**OUTPUT:**
{PS C:\Users\david\source\repos\fanwire\infra> aws iam list-roles --profile fanwire-workload --query "Roles[?starts_with(RoleName,'cdk-hnb659fds')].RoleName" --output text
cdk-hnb659fds-cfn-exec-role-294321867941-ca-central-1   cdk-hnb659fds-cfn-exec-role-294321867941-us-east-1      cdk-hnb659fds-deploy-role-294321867941-ca-central-1     cdk-hnb659fds-deploy-role-294321867941-us-east-1        cdk-hnb659fds-file-publishing-role-294321867941-ca-central-1    cdk-hnb659fds-file-publishing-role-294321867941-us-east-1       cdk-hnb659fds-image-publishing-role-294321867941-ca-central-1   cdk-hnb659fds-image-publishing-role-294321867941-us-east-1      cdk-hnb659fds-lookup-role-294321867941-ca-central-1     cdk-hnb659fds-lookup-role-294321867941-us-east-1}

⚠️ **The one thing you are genuinely signing off here.** Bootstrap also creates
`cdk-hnb659fds-cfn-exec-role-*`, the role CloudFormation itself uses, and by
default it gets the **`AdministratorAccess`** managed policy. That is the real
privilege in this design, and it is not what the IAM gate inspects — the gate
walks *our* stacks. It is defensible: only CloudFormation can use it, CI can
only reach it by way of the deploy role, and the OIDC trust policy limits that
to a workflow run on `main` of this exact repo. But it is admin, and you should
know that rather than discover it.

If you would rather scope it, create a customer-managed policy first and pass
`--cloudformation-execution-policies <arn>`. Be aware that a too-narrow policy
fails mid-deploy, with a half-created stack to clean up — which is why the
default exists. **Recommendation: take the default for the first deploy, and
narrow it once a successful deploy has told you what is actually needed.**

### 3d. Attach the CI policy

The policy is written and in the repo, so you review it as a diff rather than as
console JSON: [`../infra/iam/github-actions-deploy-role-policy.json`](../infra/iam/github-actions-deploy-role-policy.json)
(see [`../infra/iam/README.md`](../infra/iam/README.md)). It is eight ARNs and
one action — `sts:AssumeRole` on the bootstrap roles, nothing else. Read it; it
fits on a screen, which is the point.

cd /c/Users/david/source/repos/fanwire
aws iam put-role-policy --role-name GitHubActionsDeployRole --policy-name CdkBootstrapAssumeRole --policy-document file://infra/iam/github-actions-deploy-role-policy.json --profile fanwire-workload

**Confirm:**

aws iam get-role-policy --role-name GitHubActionsDeployRole --policy-name CdkBootstrapAssumeRole --profile fanwire-workload

**OUTPUT:**
{{
    "RoleName": "GitHubActionsDeployRole",
    "PolicyName": "CdkBootstrapAssumeRole",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AssumeCdkBootstrapRolesCaCentral1",
                "Effect": "Allow",
                "Action": "sts:AssumeRole",
                "Resource": [
                    "arn:aws:iam::294321867941:role/cdk-hnb659fds-deploy-role-294321867941-ca-central-1",
                    "arn:aws:iam::294321867941:role/cdk-hnb659fds-file-publishing-role-294321867941-ca-central-1",
                    "arn:aws:iam::294321867941:role/cdk-hnb659fds-image-publishing-role-294321867941-ca-central-1",
                    "arn:aws:iam::294321867941:role/cdk-hnb659fds-lookup-role-294321867941-ca-central-1"
                ]
            },
            {
                "Sid": "AssumeCdkBootstrapRolesUsEast1",
                "Effect": "Allow",
                "Action": "sts:AssumeRole",
                "Resource": [
                    "arn:aws:iam::294321867941:role/cdk-hnb659fds-deploy-role-294321867941-us-east-1",
                    "arn:aws:iam::294321867941:role/cdk-hnb659fds-file-publishing-role-294321867941-us-east-1",
                    "arn:aws:iam::294321867941:role/cdk-hnb659fds-image-publishing-role-294321867941-us-east-1",
                    "arn:aws:iam::294321867941:role/cdk-hnb659fds-lookup-role-294321867941-us-east-1"
                ]
            }
        ]
    }
}}

Run §3c **before** this — the ARNs are validated on attach and a missing
bootstrap role is rejected.

**It still deploys nothing.** No workflow assumes this role; `cdk deploy` stays
out of scope repo-wide, and
[`handoff.md`](../.ai/docs/handoff.md) §5.7 is explicit that deployment must not
be wired into the agent workflows. The first deploy is you, from your machine,
with `--profile fanwire-workload`. This policy exists so that a later, separate,
deliberately-reviewed deploy workflow has something correct to assume.

---

## 4. Accept the running cost

Recorded so the number is not a surprise later.

| Item | ~Monthly |
|---|---|
| RDS `db.t4g.micro` | ~$15 (free during the RDS free tier) |
| WAF WebACL + managed rule groups | ~$9 |
| VPC interface endpoints | ~$7 each per AZ |
| NAT **instance** (not a NAT Gateway) | ~$3 |
| Route 53 hosted zone | $0.50 |
| Cognito, CloudTrail, GuardDuty, ACM, Shield Standard | $0 at this scale |

Against a stated **$20/mo** budget: roughly **$20/mo** during the RDS free
tier, **~$35/mo** after.

- [x] Confirm the post-free-tier figure in writing somewhere durable

**Answered — ~$35/mo accepted.** The answer is now durable in two places: on
`main` in
[`phase-4-manager-agent.md`](../wiki/GeneralContext/Prompts/phase-4-manager-agent.md)
("Open, needs a human decision" → Infra idle cost), landed with the
`phase-4-docs` merge, and restated below. The earlier warning that it was
uncommitted is stale.

Levers if you change your mind: fewer WAF managed rule groups (~$9 → less), or
single-AZ interface endpoints (already accepted, see
[`03-open-decisions.md`](03-open-decisions.md)).

**Shield Advanced is explicitly not to be enabled** — flat $3k/mo, not
justified at this scale.
([`security.md`](../wiki/CodeContext/Standards/security.md))

**Source:** `phase-4-manager-agent.md` "Open, needs a human decision" — now
merged to `main`.

Note the number moves slightly: the hosted zone in §2 is a real $0.50/mo that
was already in this table, and bootstrapping (§3c) adds an S3 assets bucket
whose cost is pennies at this scale.

---

## 5. An API-SPORTS key — ❌ declined, not doing

**Answered 2026-09-21: no.** Until much later in the project's life, the app
relies only on historical games already in the database. No recent or live
results, so no key is needed. The reasoning is sound and worth keeping: an API
key is not the cost — modelling the calls and transforming the payload into this
schema is, and that work buys nothing while the feed has no live surface.

Nothing breaks. `SesEmailSender`-style graceful degradation already applies: the
ingestion path simply has no live scores to show, and the production code reads
the key from Secrets Manager, where its absence is the same no-op.

**If that changes**, this is all it takes — kept here so the decision is
reversible rather than forgotten:

- [ ] Register a free key at <https://api-sports.io> (basketball)
- [ ] Add to `backend/.env`:

```
API_SPORTS_KEY=<key>
API_SPORTS_BASE_URL=https://v1.basketball.api-sports.io
```

In production this comes from Secrets Manager, not `.env` — the ingestion
Lambda already reads it from there.

**Source:** `phase-4-manager-agent.md` frontend checklist item 7.

---

## 5b. Is the first deploy ready? — assessed 2026-09-22

**The AWS side is done. The application side is not, and the gap is bigger than
it looks.** Everything §2 and §3 asked for is verified live: the hosted zone
exists and `fanwire.daviddems.com` resolves to the four `awsdns` nameservers
from a public resolver, both regions are bootstrapped (ten `cdk-hnb659fds-*`
roles), and `GitHubActionsDeployRole` carries the one-action policy.

What stops `cdk deploy` producing a working website today:

### 1. There is no website — blocking

`frontend/src/App.tsx` is four files and renders `<h1>fanwire</h1>`. Phases
**5a** (foundation, auth, profile, compose) and **5b** (feed, notifications,
search) were never built — they are the ones waiting on the answers in
[`03`](03-open-decisions.md). Deploying now serves a scaffold.

### 2. Nothing uploads the frontend to S3 — blocking

There is **no `BucketDeployment` anywhere in `infra/lib/`**. `StorageStack`
creates `frontendBucket` and `CdnStack` points the default CloudFront behaviour
at it with OAC — but no construct, script or workflow ever puts `dist/` in that
bucket. A deploy right now creates a correct, empty bucket behind a correct
distribution, and the site returns nothing.

This is a real hole in the infra, not a missing instruction, and it is the one
thing that must be built before any deploy is worth doing.

### 3. The first deploy is all eight stacks, not just the website

`CdnStack` takes `appStack.httpApi` as its API origin, and `AppStack` depends on
`Network`, `Data`, `Auth`, `Storage` and `Messaging`. There is no
"frontend-only" subset: the first `cdk deploy` brings up the VPC, the NAT
instance, **RDS**, Cognito, the queues and four Lambdas. That is the full
~$20/mo (free tier) / ~$35/mo bill starting, and 30–45 minutes of wall clock —
RDS and CloudFront are the slow ones.

### 4. The database comes up empty — known gap, will bite immediately

No production migration runner exists. `alembic` is a dependency and
`backend/alembic/` is real, but the `lambda` image does not copy it and nothing
in the deploy path runs `alembic upgrade head`. RDS starts with **no schema**,
so every API call that touches the database 500s. Already recorded under "Known
gaps" in
[`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md); it
moves from "deferred" to "blocking" the moment there is a real deploy.

### 5. The frontend has no configuration mechanism at all

No `VITE_*` variables are read anywhere in `frontend/src`, and `frontend/.env.local`
only serves the dev Cognito pool. The **prod** user pool id and SPA client id
only exist *after* `Fanwire-Auth` deploys, and Vite bakes env vars in at build
time — so the ordering is deploy → read outputs → build → upload. Whatever
builds the frontend in item 2 has to account for that; it is a design decision,
not a command to run.

### What this means in practice

| Want | Possible today? |
|---|---|
| DNS, cert and CloudFront proven end to end | **Yes**, but only once something is in the bucket |
| A real app at `https://fanwire.daviddems.com` | No — items 1 and 2 |
| A working API behind it | No — item 4 |

The shortest honest path to "my subdomain serves a page from AWS" is to build
item 2 (a `BucketDeployment` of `frontend/dist`, which already builds), deploy,
and watch ACM validate against the new zone. That proves the whole edge path —
certificate, aliases, OAC, SPA fallback, WAF — with a placeholder page, and
retires the slowest and least reversible risks before there is an app to blame.
Item 1 then fills the page in, and item 4 gates the API.

---

## 6. After the first deploy — not now, but not forgettable either

These cannot be done before the resources exist, which is why they are not
checkboxes above. They are listed because each one is a thing that silently
does nothing until you do it.

- [ ] **GuardDuty Malware Protection for S3** on the quarantine bucket. Separate
      from GuardDuty core (§1). Media uploads never leave `Quarantined` without
      a scan verdict, so the compose-with-media path is broken until this is on.
- [ ] **Verify the SES identity** for `fanwire.daviddems.com` and request
      production access (a new SES account is sandboxed and can only send to
      verified addresses). Until then `NOTIFICATION_FROM_ADDRESS` stays unset and
      email notification is a deliberate no-op.
- [ ] **Confirm the ACM certificate validated** and the A/AAAA aliases resolve:
      `nslookup fanwire.daviddems.com` should return CloudFront addresses.
- [ ] **Re-run the IAM gate against reality.** `iam-policy.test.ts` reads
      synthesized templates; a deploy is the first time AWS itself evaluates
      them. Expect the GuardDuty bucket-policy interaction to differ from the
      synthesized guess — it is a documented known gap, not a regression.
- [ ] **Narrow `cfn-exec-role`** if you took the default `AdministratorAccess`
      in §3c and a successful deploy has now shown what is actually used.
      Bootstrap ran with the default, so this is now a real open item, not a
      hypothetical: `cdk-hnb659fds-cfn-exec-role-*` holds `AdministratorAccess`
      in both regions.
- [ ] **Review `lambda-vpc-eni`** — your acceptance in §3b was conditional
      ("an R&D agent must look at this setup to make sure we aren't using a
      crude implementation"). Recorded here so the condition is not lost inside
      a table cell. The question to answer: whether the six inline ENI actions
      on `Resource "*"` are genuinely AWS's floor for a VPC-attached Lambda, or
      whether the VPC attachment itself is avoidable for some of the four
      functions — a function that needs no RDS access needs no ENI permissions
      at all. That is a design review, and it wants the real deployed topology
      in front of it.

---

## 7. The dev S3 buckets — your steps, ~10 minutes

**Which bucket this is about.** There are two entirely separate S3 stories, and
only one of them needs you:

| Bucket | Who creates it | Needs you? |
|---|---|---|
| **Frontend** (`StorageStack.frontendBucket`) | CDK, on deploy | **No.** The gap there is that nothing *uploads* to it — that is missing infra code (§5b item 2), not a console step. |
| **Prod media** (quarantine + public) | CDK, on deploy | No. |
| **Dev media** (quarantine + public) | **You, by hand, now** | **Yes** — everything below. |

The dev buckets are the decision from [`03`](03-open-decisions.md) §1: real S3
rather than an emulator, so compose-with-media can be clicked through in a
browser before anything is deployed. Cost is pennies at dev volume.

The JSON these commands reference is committed at
[`../infra/dev/`](../infra/dev/) — read it before applying it; the bucket names
are baked into the policy ARNs.

### 7a. Create them

Every command is one line. Run them in order.

```powershell
aws sso login --profile fanwire-workload
aws s3api create-bucket --bucket fanwire-dev-quarantine-294321867941 --region ca-central-1 --create-bucket-configuration LocationConstraint=ca-central-1 --profile fanwire-workload
aws s3api create-bucket --bucket fanwire-dev-public-media-294321867941 --region ca-central-1 --create-bucket-configuration LocationConstraint=ca-central-1 --profile fanwire-workload
```

`--create-bucket-configuration LocationConstraint` is required for every region
except `us-east-1`. Without it the bucket is silently created in Virginia.

### 7b. Lock them down before putting anything in them

```powershell
aws s3api put-public-access-block --bucket fanwire-dev-quarantine-294321867941 --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false" --profile fanwire-workload
aws s3api put-public-access-block --bucket fanwire-dev-public-media-294321867941 --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false" --profile fanwire-workload
aws s3api put-bucket-encryption --bucket fanwire-dev-quarantine-294321867941 --server-side-encryption-configuration '{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"AES256\"}}]}' --profile fanwire-workload
aws s3api put-bucket-encryption --bucket fanwire-dev-public-media-294321867941 --server-side-encryption-configuration '{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"AES256\"}}]}' --profile fanwire-workload
aws s3api put-bucket-policy --bucket fanwire-dev-quarantine-294321867941 --policy file://infra/dev/dev-quarantine-tls-only-policy.json --profile fanwire-workload
aws s3api put-bucket-policy --bucket fanwire-dev-public-media-294321867941 --policy file://infra/dev/dev-public-media-tls-only-policy.json --profile fanwire-workload
aws s3api put-bucket-cors --bucket fanwire-dev-quarantine-294321867941 --cors-configuration file://infra/dev/dev-quarantine-cors.json --profile fanwire-workload
```

Run the `put-bucket-policy` and `put-bucket-cors` lines from the **repository
root**, since the `file://` paths are relative.

Two deliberate choices, so they are not a surprise:

- `BlockPublicPolicy=false` and `RestrictPublicBuckets=false`, because a bucket
  policy is exactly what you are about to attach. `BlockPublicAcls` and
  `IgnorePublicAcls` stay **true** — ACLs are the legacy path and nothing here
  needs them.
- **SSE-S3 (`AES256`), not the CMK.** Prod uses the customer-managed key from
  `DataStack`, which does not exist yet. Dev data is disposable test images; a
  dev bucket waiting on a prod key would block the thing it exists to unblock.

### 7c. Tell the backend about them

Add these three lines to `backend/.env` (create the file if it is missing —
it is gitignored, and already holds the dev Cognito values):

```
MEDIA_QUARANTINE_BUCKET=fanwire-dev-quarantine-294321867941
MEDIA_PUBLIC_BUCKET=fanwire-dev-public-media-294321867941
AWS_DEFAULT_REGION=ca-central-1
```

These map to `media_quarantine_bucket`, `media_public_bucket` and
`aws_default_region` in `backend/app/settings.py`, whose defaults point at
bucket names that do not exist. Route tests override the S3 client with `moto`
and never touch a real bucket, so nothing in CI is affected either way.

### 7d. Confirm it worked

```powershell
aws s3api get-bucket-location --bucket fanwire-dev-quarantine-294321867941 --profile fanwire-workload
aws s3api get-bucket-cors --bucket fanwire-dev-quarantine-294321867941 --profile fanwire-workload
aws s3api get-bucket-policy --bucket fanwire-dev-public-media-294321867941 --profile fanwire-workload
aws s3 ls --profile fanwire-workload | Select-String fanwire-dev
```

You want `ca-central-1` from the first, the localhost origins from the second,
the TLS-only deny from the third, and **both** buckets from the fourth.

### 7e. What is still missing after this — not your step

The buckets alone do not make media upload work. Locally there is no GuardDuty,
so nothing ever issues the scan verdict that moves an object from
`Quarantined` to `Processed`, and an unprocessed image cannot be attached to a
post. The decision in [`03`](03-open-decisions.md) §1 included **a dev-only
script that runs the processing pipeline on demand**, and that script does not
exist yet.

It is written up as an agent task rather than a step for you — see
[`.ai/tasks/`](../.ai/tasks/). Until it exists, these buckets accept uploads
that then sit in `Quarantined` forever, which is the correct behaviour and not
a bug.

---

## Deferred by the project, not waiting on you

Listed so you do not think they are your tasks:

- A production migration runner — Alembic is not in the `lambda` image
- Reading DB credentials from Secrets Manager rather than `DATABASE_URL`
- Automated security alerting (SNS/EventBridge) — planned, not built
- Named resource-level lockout steps in the runbook — blocked on the CDK stacks
  existing
- GuardDuty's real tagging/bucket-policy interaction and the scan-result event
  shape — **unverifiable until a real deploy**, so expect surprises in the
  media pipeline on day one
