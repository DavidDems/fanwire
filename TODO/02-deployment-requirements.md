# 02 — Deployment: what is still yours to do

**Status as of 2026-10-01: one thing is waiting on AWS, not on you** —
SES production access: auto-denied for missing detail, answered on the support case, under review (§3). The fixes the
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

## 3. SES production access — requested, auto-denied for missing detail, answered

The first request (2026-10-01, `put-account-details` with no use-case text)
came back `DENIED` within minutes — an automated "needs more information",
case `179090803100437`. It is answered by **replying to the support case** in
the console (Support Center, signed in to `fanwire-workload`; the Support API
needs a paid plan), with all six things AWS asks for in one message. The
reply that was sent is below so a second round does not start from scratch.

**Before replying, make the bounce/complaint answer true** — the account-level
suppression list for both reasons:

```powershell
aws sesv2 get-account --region ca-central-1 --profile fanwire-workload --query SuppressionAttributes
```
```powershell
aws sesv2 put-account-suppression-attributes --suppressed-reasons BOUNCE COMPLAINT --region ca-central-1 --profile fanwire-workload
```

**The reply** (subjects and body are copied from `app/notifications/email.py`;
do not claim SNS bounce handling — it is not built):

> **Website:** https://fanwire.daviddems.com — a social app for sports fans.
> **Email type:** transactional only — a notification that someone followed the
> user, replied to or reposted their post. No marketing, no imported lists.
> Sign-up verification and password resets are sent by Cognito, not this account.
> **Volume:** under 100/day, under 1,000/month.
> **Recipient source:** registered users only; Cognito requires confirming the
> address with a code before the account works. Users can switch email
> notifications off in the app at any time.
> **Bounces and complaints:** account-level suppression list on for both;
> send failures logged to CloudWatch; SES reputation metrics monitored.
> **Sample:** From notifications@fanwire.daviddems.com — Subject "You have a new
> follower on fanwire" — Body "You have a new follower on fanwire. Open fanwire
> to see it."
> **Identity:** fanwire.daviddems.com, verified in ca-central-1 with Easy DKIM.

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
