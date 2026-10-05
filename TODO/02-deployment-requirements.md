# 02 — Deployment: what is still yours to do

**Status as of 2026-10-05: nothing is waiting on you.** AWS refused SES
production access, so email notifications are switched off on purpose
(`sendEmailNotifications: false` in `infra/cdk.json`) and in-app
notifications carry on. Reapplying is optional and later (§1). Deploys go
through `.github/workflows/deploy.yml` (`Prompts/10`, done): a merge to `main`
that changes a deployable path queues one, and you approve it and read its
diff. The deploy-path work still to do is §2.

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
- **The `Fanwire-App` drift** (benign, expect it on every drift check), and
  **the two fixes deployed 2026-10-01** (#77, #79): `0x00` → "Post-deploy
  checks", the drift and SES rows.
- **`cfn-exec-role` scoped 2026-10-02**: `0x00` → "AWS account state". Rolling
  out a later edit to its policy is yours —
  `aws iam create-policy-version ... --set-as-default`, in `infra/iam/README.md`.

> **The dev S3 buckets** (an earlier §1) are done: created 2026-09-25, locked
> down, CORS and TLS-only policies applied, and the three variables are in
> `backend/.env`. Locally, an upload still stays `Quarantined`, because there
> is no GuardDuty to scan it — the dev-only processing script is `MEDIA-002` in
> `.ai/tasks/`, not a step of yours.

---

## 1. SES production access — refused 2026-10-03; email is off on purpose

Case `179090803100437`: auto-denied for missing detail on 2026-10-01,
answered with the reply below, then **refused** after human review with a
form letter that gives no reason. A brand-new account with no billing or
sending history is the commonest refusal, so this is most likely about the
account's age, not the use case.

**What runs today:** `sendEmailNotifications` is `false` in `infra/cdk.json`,
so the notifications function has no `NOTIFICATION_FROM_ADDRESS` and no
`ses:SendEmail` grant, and `SesEmailSender` skips without calling AWS. In-app
notifications are unaffected. The SES identity stays verified (it costs
nothing), so turning email on later needs no DNS work.

**Optional, later — reapply** once the account has a few weeks to months of
history. Not before: a fresh request on the same account days later is
likely to get the same answer.

1. SES console → *Account dashboard* → *Request production access*, pasting
   the reply below into the use-case box. Check the suppression list first
   (the first command below); it is what makes the bounce answer true.
2. When `get-account` shows `prod: true`, turn email on with a PR that sets
   `"sendEmailNotifications": true` in `infra/cdk.json`, then deploy
   `Fanwire-App` from `infra/` with the third command below. Proof it
   worked: a follow sends the email.

```powershell
aws sesv2 get-account --region ca-central-1 --profile fanwire-workload --query SuppressionAttributes
```
```powershell
aws sesv2 get-account --region ca-central-1 --profile fanwire-workload --query "{prod:ProductionAccessEnabled,review:Details.ReviewDetails.Status}"
```
```powershell
npx cdk deploy Fanwire-App --exclusively --profile fanwire-workload
```

**The reply that was sent** (subjects and body are copied from
`app/notifications/email.py`; do not claim SNS bounce handling — it is not
built):

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

---

## Deferred by the project, not waiting on you

- Reading DB credentials from Secrets Manager rather than `DATABASE_URL`.
- Automated security alerting (SNS/EventBridge), and a DLQ-depth alarm —
  planned, not built. Both are checked by hand today (the runbook says how).
- The agent follow-ups the checklist turned up — the `lambda-vpc-eni`
  self-deny, the two-click upload-then-attach in compose — are in
  `wiki/GeneralContext/Prompts/08-post-deploy-followups.md`, not here.

## 2. The deploy workflow: what is left (updated 2026-10-05)

Done 2026-10-05 and recorded in `0x00` → "AWS account state": PR #86 deployed
through the workflow; the actions moved to their Node 24 majors; deploy on
merge is on (PR #88), and its first merge-triggered run was clean.

1. **The permissions boundary** on the roles that templates create
   (`infra/iam/README.md` → "What this does not close"). It is the remaining
   route from "can get a template deployed" to admin. Now that every merge to
   `main` can queue a deploy, that also means from "can get a PR merged and its
   deploy approved". It changes all twelve live roles, so it is its own
   reviewed deploy. A session with Claude.
2. **Watch the first deploy that changes `backend/`.** It is the first real
   build and push of the backend image from inside the CI container. If it
   fails, paste the failing step's log into a session.

Each deploy: approve it when it is queued, read its `cdk diff` step, then
check that `gh run list --workflow deploy.yml --limit 1` shows `success`.
After a change that touches login or the API, log in on the site and check
that the app's own `/api/users/me` request returns 200 (`build-deployment.md`
→ "Automated deploy", step 5).
