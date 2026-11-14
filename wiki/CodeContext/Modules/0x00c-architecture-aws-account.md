---
type: reference
---

# 0x00c — Architecture: AWS account state

**Agent-facing.** Part of [[0x00-architecture]] (index, module boundaries and cross-cutting conventions).

## AWS account state (current, verified)

**Organizations** — primary region `ca-central-1` across all three accounts; CloudFront's ACM cert is the one exception, always issued in `us-east-1` regardless.
- Management account: `<aws-root-email>` (the real address is in the Organizations console, never in a file) (alias `DavidDems`). Root MFA on (authenticator app), no root access keys, root not used day-to-day.
- `fanwire-workload` — account ID `294321867941`, email `<aws-root-email>+fanwire-workload`. Where the app runs; CDK deploys here.
- `fanwire-log-archive` — account ID `801132668027`, email `<aws-root-email>+fanwire-logarchive`. Logs/backups only, holds nothing `workload` can reach or delete.

**Human access (IAM Identity Center)** — SSO start URL `https://d-9d6748d7e4.awsapps.com/start`. No IAM users or long-lived access keys exist for human use in any account.
- Permission set `AdministratorAccess` → `fanwire-workload`.
- Permission set `PowerUserAccess` → `fanwire-log-archive` (excludes IAM/Organizations management, so a human SSO session there can't create a backdoor IAM role).

**CI access (OIDC)** — in `fanwire-workload`:
- OIDC identity provider `token.actions.githubusercontent.com` registered.
- Role `GitHubActionsDeployRole`, trust `repo:DavidDems@71515505/fanwire@1457277496:environment:production` (audience `sts.amazonaws.com`, `StringEquals`), committed at `infra/iam/github-actions-deploy-role-trust-policy.json`. That is GitHub's immutable subject, with numeric owner and repo ids, because the repo has `use_immutable_subject` on. Why the immutable form, and what to read when a subject is refused, is `infra/iam/README.md`. Only a job that declares the GitHub environment `production` can assume it. That environment exists, restricted to `main`, with the human as required reviewer, and holds the five `VITE_*` environment variables ([[wiki/CodeContext/Standards/build-deployment|Build & Deployment]] → "Automated deploy").
- **Permissions policy `CdkBootstrapAssumeRole`**, attached after the human IAM review. It grants exactly one action — `sts:AssumeRole` — on the eight CDK bootstrap roles (four per region, `ca-central-1` and `us-east-1`). CI holds **no service permissions at all**; it can only step into the roles `cdk bootstrap` created. The policy is committed at `infra/iam/github-actions-deploy-role-policy.json` so it is reviewable as a diff rather than as console JSON.
- The alternative — enumerating every service the stacks touch — was rejected deliberately: that policy is hundreds of actions wide, changes with every stack change, and is too large to actually read, which is the failure the IAM gate exists to prevent.
- **`.github/workflows/deploy.yml` assumes it.** It runs on every merge to `main` that changes a deployable path, and on a manual dispatch. Every run waits for the `production` environment's required reviewer.
  - The trust names the environment, not a branch, because a branch trust admits every workflow run from `main`, and the agent workflows also run from `main`. `.ai/tests/test_deploy_workflow.py` fails if any workflow except `deploy.yml` requests `id-token`, declares an environment, or names `deploy.yml`.

**DNS (Route 53)** — the domain is live.
- Registrar: **GoDaddy**, domain `daviddems.com`. The apex and its nameservers stay there.
- Hosted zone `Z04139742PYZYKIOGHWGR` in `fanwire-workload` for the **subdomain** `fanwire.daviddems.com` only. Four NS records at the registrar delegate that label to Route 53; nothing else on `daviddems.com` is affected. Verified resolving from a public resolver.
- Chosen over moving the whole domain because the blast radius is one label rather than all DNS for the domain, and undoing it is "delete four NS records". The trade-off accepted: DNS is administered in two places, and any other subdomain stays manual at the registrar.
- `infra/cdk.json` names the zone (`domainName`, `hostedZoneId`, `hostedZoneName`), which puts the app in its intended **"domain + zone"** mode — ACM validates against the zone automatically instead of waiting for a hand-added CNAME.

**CDK bootstrap** — both regions, 2026-09-22, default qualifier `hnb659fds`.
- `CDKToolkit` in `ca-central-1` and `us-east-1` (the second because CloudFront's cert must live there). Ten `cdk-hnb659fds-*` roles exist.
- **`cdk-hnb659fds-cfn-exec-role-*` holds `FanwireCdkCfnExecPolicy`, not the bootstrap default `AdministratorAccess`.** This role is the real privilege in the deployment design: CloudFormation acts as it. The policy is set the CDK-native way, `cdk bootstrap --cloudformation-execution-policies` in both regions, so a later `cdk bootstrap` keeps it instead of reverting it. The source is `infra/iam/cdk-cfn-exec-role-policy.json`, and `infra/iam/README.md` explains the design and its limits. The policy grants the 19 services the stacks create resources in, service-wide, and IAM action by action: writes only to `Fanwire-*` roles and instance profiles, `AttachRolePolicy` pinned to `AWSLambdaBasicExecutionRole`, and `PassRole` pinned to the four services the template roles trust. It was derived from CloudTrail: all 3,789 calls the exec roles made across the 2026-09-29 → 10-01 deploys are allowed by it. `infra/test/cfn-exec-policy.test.ts` gates it in CI, and that test is separate from `iam-policy.test.ts`, which walks only this app's stacks.
  - **A permissions boundary on every created role.** Without one, a template could create a `Fanwire-*` role with an inline `*:*` policy, because IAM has no condition key for what an inline policy says. Every role the stacks create carries `FanwireRoleBoundary` (`infra/iam/fanwire-role-boundary-policy.json`), which allows exactly the actions the twelve roles use and nothing in IAM, STS or Organizations. The exec policy refuses `CreateRole`, `PutRolePolicy`, `AttachRolePolicy` and `PutRolePermissionsBoundary` unless the boundary is that policy. The live versions are `FanwireRoleBoundary` `v1` and `FanwireCdkCfnExecPolicy` `v2` (the default), both byte-equal to the committed files. Resource policies (bucket, key and queue policies) are not covered by any boundary.

**CloudTrail**
- Trail `fanwire-workload-trail` in `fanwire-workload`: multi-region, log file validation on, management events (read + write) only.
- Delivers to S3 bucket `fanwire-cloudtrail-801132668027-ca-central-1-an` in `fanwire-log-archive`: Object Lock on (Governance mode, 90-day default retention), all public access blocked.

**GuardDuty**
- Delegated administrator: `fanwire-log-archive` (`801132668027`); Organizations trusted access enabled; auto-enable for new Organizations accounts on.
- `fanwire-workload` and the management account added as member accounts, by invitation.
- **Confirmed Enabled 2026-09-22**, checked from inside `fanwire-workload` itself. The delegated-admin account list reads empty from `fanwire-log-archive` because listing Organizations members needs permissions `PowerUserAccess` deliberately excludes — that exclusion is the point of that permission set, not a misconfiguration.
- Two consequences: membership is **by invitation**, so a future fourth account will not self-enroll; and **Malware Protection for S3 is a separate feature** from GuardDuty core. The latter is what `media/` actually depends on — an upload never leaves `Quarantined` without a scan verdict — and it can only be enabled against a bucket that exists. **Done by CDK, not by hand:** `Fanwire-Storage` creates the plan (`e0d078028fa35d2cdba2`, `ACTIVE`, verified end to end on 2026-09-30).

**AWS Config** — enabled in `fanwire-workload` only (not `log-archive` or management).
- Recording strategy: all resource types, no overrides — global IAM resource types included, recorded in `ca-central-1`.
- Recording mode: continuous.
- Delivery bucket: `fanwire-config-294321867941` in `fanwire-workload`.
- IAM role: AWS Config service-linked role (default).
- No Config Rules are defined — recorder only, no compliance evaluation running.

**AWS Budgets** — one cost budget on the management account (rolls up the full consolidated org bill once member accounts have spend): $20/month, alerts at 80% and 100% of actual, emailed to `<aws-root-email>`. No automated actions configured.

**Outstanding**
- Resource policies (bucket, key and queue policies) are the one route the IAM fence does not cover; `cfn-exec-role` is scoped and every created role carries `FanwireRoleBoundary` (above).
- GuardDuty member-account propagation is unverified.
- No AWS Config Rules are defined.
- GuardDuty findings raise no alarm and are checked by hand; the alarm is a backlog item (`TODO/02-backlog.md`, "A GuardDuty-findings alarm"). DLQ depth alarms exist since `INFRA-004` ([[0x00a-architecture-infra]] "Alarms"), once an address is subscribed to the topic (`wiki/GeneralContext/Architecture/incident-runbook.md` "Known gaps").
- Security Hub is not enabled (optional at this budget, per [[wiki/CodeContext/Standards/security|Security]]).
