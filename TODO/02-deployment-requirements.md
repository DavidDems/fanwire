# 02 — Deployment: what is still yours to do

**Status as of 2026-09-30: the post-deploy checklist is worked, and three
things are left for you** — read why `Fanwire-App` drifted, deploy the two
fixes that came out of the checklist, and turn on SES. The deploy-role
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

## 1. Read why `Fanwire-App` drifted

Drift detection on 2026-09-30 found seven stacks `IN_SYNC` and `Fanwire-App`
`DRIFTED`. Drift is something in the live stack that no longer matches its
template — a hand change, or a property AWS rewrites. It matters before §2,
because **the next `cdk deploy Fanwire-App` overwrites it** whatever it is.

```powershell
aws cloudformation describe-stack-resource-drifts --stack-name Fanwire-App --stack-resource-drift-status-filters MODIFIED DELETED --region ca-central-1 --profile fanwire-workload --query "StackResourceDrifts[].{id:LogicalResourceId,type:ResourceType,status:StackResourceDriftStatus,diffs:PropertyDifferences[].{path:PropertyPath,type:DifferenceType,expected:ExpectedValue,actual:ActualValue}}" --output json
```

Hand the output to an agent session (`05-post-deploy.md`) to read. If it is a
change you made on purpose, it has to go into CDK first or it is lost on
deploy.

## 2. Deploy the two fixes — after both PRs are merged

Two PRs came out of the checklist, and both land in `Fanwire-App`:

- **Notifications: email is best-effort.** A failed send no longer fails the
  SQS record, so it no longer duplicates the notification on every retry.
  This is the live bug: right now every follow, reply and repost is
  notified up to five times.
- **The SES domain identity, in CDK**, with its three DKIM records published
  into the hosted zone, so it verifies itself.

One deploy ships both. From `infra/`, with `main` checked out and up to date —
verify that first, as its own command (`TODO/04-first-deploy.md` §4 "Traps"):

```powershell
git branch --show-current
```
```powershell
git log --oneline -3
```
```powershell
npx cdk deploy Fanwire-App --exclusively --profile fanwire-workload
```

It rebuilds the backend image, which is how the notifications fix ships.

**Confirm it worked — two observables:**

1. The identity verifies. DKIM can take up to 72 hours, usually minutes; you
   want `"verified": true` and `"dkim": "SUCCESS"`:
   ```powershell
   aws sesv2 get-email-identity --email-identity fanwire.daviddems.com --region ca-central-1 --profile fanwire-workload --query "{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}"
   ```
2. No more duplicates. Follow an account from a second account, wait
   15 minutes, and open the followed account's notifications: **exactly one**.

## 3. Request SES production access — after §2's identity verifies

A new SES account is sandboxed: it sends only to addresses verified in SES,
so real users get no email. After §2 that is a logged skip, not a bug, but
email notifications do not reach anyone until this is done. AWS reviews it by
hand, usually within a day.

```powershell
aws sesv2 put-account-details --production-access-enabled --mail-type TRANSACTIONAL --website-url https://fanwire.daviddems.com --contact-language EN --additional-contact-email-addresses daviddemers92@gmail.com --region ca-central-1 --profile fanwire-workload
```

AWS may reply by email asking how you collect addresses and handle bounces —
the honest answer is that mail goes only to users who signed up and verified
their address through Cognito, and only for follows, replies and reposts, each
of which they can switch off. The console route is the same form: SES →
*Account dashboard* → *Request production access*.

**Confirm:** `aws sesv2 get-account --region ca-central-1 --profile fanwire-workload --query ProductionAccessEnabled` returns `true`.

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
