# 02 — Deployment: what is still yours to do

**Status as of 2026-10-01: one thing is waiting on AWS, not on you** —
SES production access, requested and under review (§3). The fixes the
post-deploy checklist produced are deployed and verified (§2). The deploy-role
narrowing has its own session prompt.

Everything that was in this file and is now finished has moved into the wiki,
where it belongs as current-state fact rather than as a tick:

- **What each post-deploy check proved, and how** —
  `wiki/CodeContext/Modules/0x00-architecture.md` → "Post-deploy checks,
  2026-09-30": GuardDuty Malware Protection (working end to end), the ACM
  certificate and aliases, the `lambda-vpc-eni` review, the drift result, and
  the SES defect.
- **The incident runbook**, now naming the deployed resources:
  `wiki/GeneralContext/Architecture/incident-runbook.md`.
- **AWS account state** and the IAM waivers: same `0x00` file, "AWS account
  state" and "Infra (CDK) — implementation notes".

> **The dev S3 buckets** (the old §1) are done: created 2026-09-25, locked
> down, CORS and TLS-only policies applied, and the three variables are in
> `backend/.env`. Locally, an upload still stays `Quarantined`, because there
> is no GuardDuty to scan it — the dev-only processing script is `MEDIA-002` in
> `.ai/tasks/`, not a step of yours.

---

## 1. ~~Read why `Fanwire-App` drifted~~ — done, benign

One property, `DefaultStage`'s access-log ARN: CDK writes it with a trailing
`:*` and API Gateway stores it without. Same log group; nothing was changed by
hand and nothing is lost on deploy. Expect that diff on every future drift
check. Details: `0x00-architecture.md` → "Post-deploy checks".

## 2. ~~Deploy the two fixes~~ — done 2026-10-01

PRs #79 (notifications email is best-effort) and #77 (the SES identity in CDK)
were deployed with `npx cdk deploy Fanwire-App --exclusively`. Both observables
passed: the identity reads `verified: true`, DKIM `SUCCESS`, and a follow made
after the deploy produced exactly one notification.

## 3. SES production access — requested 2026-10-01, waiting on AWS

Filed with `aws sesv2 put-account-details --production-access-enabled …`
(no output means it was accepted). AWS reviews it by hand, usually within a
day, and may email follow-up questions — answer honestly: mail goes only to
users who signed up and verified their address through Cognito, only for
follows, replies and reposts, each of which they can switch off.

**Confirm it was granted:**

```powershell
aws sesv2 get-account --region ca-central-1 --profile fanwire-workload --query "{prod:ProductionAccessEnabled,review:Details.ReviewDetails.Status}"
```

`prod: true` closes this item — delete the section. Until then, email to an
address not verified in SES is rejected and logged by the notifications
Lambda; the in-app notification is unaffected.

## 4. Narrow `cfn-exec-role` — its own session

`cdk-hnb659fds-cfn-exec-role-*` still holds `AdministratorAccess`. Run
`wiki/GeneralContext/Prompts/07-deploy-role-scoping.md` with an agent; it
holds the service inventory taken on 2026-09-30, and you run every AWS
command in it.

---

## Deferred by the project, not waiting on you

- Reading DB credentials from Secrets Manager rather than `DATABASE_URL`.
- Automated security alerting (SNS/EventBridge), and a DLQ-depth alarm —
  planned, not built. Both are checked by hand today (the runbook says how).
- The agent follow-ups the checklist turned up — the `lambda-vpc-eni`
  self-deny, the two-click upload-then-attach in compose — are in
  `wiki/GeneralContext/Prompts/08-post-deploy-followups.md`, not here.
