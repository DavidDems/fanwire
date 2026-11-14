---
type: runbook
---

# 01 — Things only you can do

**Human-facing.** Each item needs a person: a credential, an account, a
console click or a judgement. Work an agent can do is not here; it is
`02-backlog.md`. The account state is
`wiki/CodeContext/Modules/0x00c-architecture-aws-account.md`, the traps every AWS session
reads first are `wiki/GeneralContext/Architecture/deploy-traps.md`, and
answered decisions are `wiki/GeneralContext/Decisions/`.

---

## 1. Sports data

`wiki/GeneralContext/Prompts/06-nba-data.md` is the thread.

- **After the API-SPORTS infra clean-up deploys:** the idempotency table and
  the API-SPORTS secret are `RETAIN`, so they stay in the account after
  leaving the template. Delete them by hand; that PR names them.
- **For `EVENTS-008` only, later:** check that the Kaggle dataset is updating
  during the season (the 2026-10-25 download at `C:\data\nba` already holds
  the first 2026-27 games). If it is, create a Kaggle API token
  (kaggle.com → Settings → API) and store it in Secrets Manager under the
  name the `EVENTS-008` spec gives.

## 2. Watching each deploy

A merge to `main` queues `deploy.yml`, which waits for you.

1. Approve the deploy when it is queued.
2. Read its `cdk diff` step.
3. Check this shows `success`:

   ```powershell
   gh run list --workflow deploy.yml --limit 1
   ```

4. **If the deploy's PR adds a migration,** invoke the `Migration` function
   right after (`wiki/CodeContext/Standards/build-deployment-post-deploy.md` "Run
   migrations" has the commands). Until then the routes on the changed tables
   answer 500. Check that this prints `200`:

   ```powershell
   curl.exe -s -o NUL -w "%{http_code}" https://fanwire.daviddems.com/api/events/teams
   ```

**A PR that changes `infra/iam/cdk-cfn-exec-role-policy.json` or
`fanwire-role-boundary-policy.json`** needs you to roll the new version out
(`infra/iam/README.md`) before its deploy can pass. An `AccessDenied` in a
function's logs means an action is missing from
`infra/iam/fanwire-role-boundary-policy.json`; report it.

## 3. axe on every route — not done anywhere

Every styling unit's browser checklist has its axe row **NOT DONE**: there is
no axe dependency, and loading it from a CDN would put a third-party script
into the check (`FrontendUI/verification-browser.md` §3a). Run the axe DevTools
browser extension on each route, light and dark, and paste the serious and
critical counts into a session; anything found becomes a backlog unit.

## 4. SES production access — refused; email is off on purpose

Case `179090803100437`: auto-denied for missing detail on 2026-10-01,
answered with the reply below, then **refused** on 2026-10-03 after human
review with a form letter that gives no reason. A brand-new account with no
billing or sending history is the commonest refusal, so this is most likely
about the account's age, not the use case.

**What runs today:** `sendEmailNotifications` is `false` in `infra/cdk.json`,
so the notifications function has no `NOTIFICATION_FROM_ADDRESS` and no
`ses:SendEmail` grant, and `SesEmailSender` skips without calling AWS. In-app
notifications are unaffected. The SES identity stays verified (it costs
nothing), so turning email on later needs no DNS work.

**Optional, later — reapply** once the account has a few weeks to months of
history. Not before: a fresh request on the same account days later is
likely to get the same answer.

1. Check the suppression list first; it is what makes the bounce answer true:

   ```powershell
   aws sesv2 get-account --region ca-central-1 --profile fanwire-workload --query SuppressionAttributes
   ```

2. SES console → *Account dashboard* → *Request production access*, pasting
   the reply below into the use-case box.
3. Wait until this shows `prod: true`:

   ```powershell
   aws sesv2 get-account --region ca-central-1 --profile fanwire-workload --query "{prod:ProductionAccessEnabled,review:Details.ReviewDetails.Status}"
   ```

4. Turn email on with a PR that sets `"sendEmailNotifications": true` in
   `infra/cdk.json`, then deploy `Fanwire-App` from `infra/`:

   ```powershell
   npx cdk deploy Fanwire-App --exclusively --profile fanwire-workload
   ```

   Proof it worked: a follow sends the email.

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
- Automated security alerting (SNS/EventBridge). Checked by hand today
  (`incident-runbook.md` says how).
