# 01 — Things only you can do

**Human-facing.** Each item needs a person: a credential, an account, a
console click or a judgement. Rewritten 2026-10-07, when the frontend's last
unit (`FRONTEND-007`, #114) merged and the finished files (`02` deployment,
`03` open decisions, `04` first deploy) were deleted. What they recorded now
lives in the wiki as current-state fact:

- the deploy record and what each check proved:
  `wiki/CodeContext/Modules/0x00-architecture.md`;
- the traps every AWS session reads first:
  `wiki/GeneralContext/Architecture/deploy-traps.md`;
- answered decisions, including the browser-tool question (Playwright MCP,
  2026-10-06): `wiki/GeneralContext/Architecture/human-decisions.md`.

Work an agent can do is not here; it is `02-backlog.md`.

---

## 1. Store the `jev` key as a repository secret — after the workflow review

You have a **direct TypeSafe key** for `jev` (System One), the typed-decision
model the `jev-decision-layer` branch wires in. That branch is parked and
still points at the Vercel AI Gateway route (`AI_GATEWAY_API_KEY`), which
never returned a 200. Its direct route reads **`TYPESAFE_API_KEY`**.

**Settled by the workflow review (2026-10-08, `.ai/docs/handoff.md` §10.3):**
the name stays `TYPESAFE_API_KEY`, read by a CI job only. Set it when
`02-backlog.md`'s `jev` item starts, after the first three agent-system fixes
have merged. Then:

- **Never paste the key into a chat or a file.** `gh secret set` prompts for
  the value without echoing it.

```powershell
gh secret set TYPESAFE_API_KEY --repo DavidDems/fanwire
```
```powershell
gh secret list --repo DavidDems/fanwire
```

**Confirm:** the list shows `TYPESAFE_API_KEY`. The proof that it *works* is
the branch's merge precondition: one real call returning 200 with a
`confidence` field.

If the direct route replaces the gateway, delete the then-unused
`AI_GATEWAY_API_KEY` (`gh secret delete AI_GATEWAY_API_KEY --repo DavidDems/fanwire`):
a gateway key reaches every model in its catalogue, so an unused one is pure
blast radius.

## 2. Check the API credit balance before the orchestrator runs again

Every agent the orchestrator dispatches bills **metered API credits** from
`ANTHROPIC_API_KEY` (a Claude Console key; a Pro/Max plan does not cover it).
It has not run a task since 2026-09-23. Check the balance and set a spend
limit in the Claude Console before the first automated task. A full task has
cost $0.27–$0.38 so far (`.ai/telemetry/`).

## 3. Watching the live site

The deploy path is finished and needs only watching. Each deploy: approve it
when queued, read its `cdk diff` step, then check
`gh run list --workflow deploy.yml --limit 1` shows `success`.

- [x] **The first deploy that changed `backend/`** (#96, the PyJWT swap,
      2026-10-06) built and pushed the backend image from the CI container
      and succeeded.
- [ ] **Log in on the live site once** and check the app's own
      `/api/users/me` returns 200. #96 replaced JWT verification, and nothing
      on record has logged in to production since
      (`build-deployment.md` → "Automated deploy", step 5).
- [ ] **The first post with an image, follow and ingestion run under the
      permissions boundary** (applied 2026-10-05). An `AccessDenied` in the
      Media, Notifications or Ingestion logs means a granted action is missing
      from `infra/iam/fanwire-role-boundary-policy.json`; report it.
- **A PR that changes `infra/iam/cdk-cfn-exec-role-policy.json` or
  `fanwire-role-boundary-policy.json`** needs you to roll the new version out
  (`infra/iam/README.md`) before its deploy can pass.

## 4. axe on every route — not done anywhere

Every styling unit's browser checklist has its axe row **NOT DONE**: there is
no axe dependency, and loading it from a CDN would put a third-party script
into the check (`FrontendUI/verification.md` §3a). Run the axe DevTools
browser extension on each route, light and dark, and paste the serious and
critical counts into a session; anything found becomes a backlog unit.

## 4. SES production access — refused 2026-10-03; email is off on purpose

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
- Automated security alerting (SNS/EventBridge). Checked by hand today
  (`incident-runbook.md` says how). The DLQ-depth alarm is in `02-backlog.md`.
