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

## 1. Confirm GuardDuty is actually enabled — 2 minutes

- [ ] In the `fanwire-log-archive` account (the delegated administrator), check
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

**The workload account is enabled on guard duty, the log-archive account is not able to see this directly in the GuardDuty account list because it only has 'PowerUserAccess' and not 'AdministratorAccess'. The log-archive account can add and edit policies in GuardDuty, but cannot view the list of accounts for some reason. But the workload account was added by invitation and was confirmed by using the workload account and navigating to the GuardDuty page, which it had access to.**

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

- [ ] Decide which mode for the first deploy — **"no domain" is a fine first
      deploy** and de-risks it
- [ ] If going to production: register the domain, create the hosted zone in
      `fanwire-workload`, point the registrar's nameservers at it

**Cost:** domain registration (~$10–20/yr, registrar-dependent); Route 53
hosted zone $0.50/mo; ACM certs are free.

**Note:** CloudFront's ACM cert must be issued in `us-east-1` regardless of the
`ca-central-1` primary region. The `Fanwire-Edge` stack already handles this —
you do not need to do anything about it.

**Source:** [`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md)
(CDK app / stack table), [`aws-stack.md`](../wiki/CodeContext/Standards/aws-stack.md)
("Route 53 for DNS, ACM for TLS").

**I have just bought the domain 'daviddems.com' with godaddy.com. I believe because I previously bought daviddems.ca with hostpapa.com, they purchased my domain after it expired so that they can get me to come back and pay for it. Instead I will just use daviddems.com. The domain is already bought and paid for, all you need to do now is instruct me on what to do so that AWS can use it to serve the deployments to its address.**

---

## 3. Review the generated IAM policies — the hard gate before any deploy

**This is the one that must not be skipped or delegated.**
`GitHubActionsDeployRole` has **no permissions policy attached**. CI cannot
deploy or touch anything until you scope its permissions deliberately, having
read the policies CDK generates.

- [ ] Run `cd infra && npm run synth` and read the synthesized IAM policies
- [ ] Read the exception list in
      [`0x00-architecture.md`](../wiki/CodeContext/Modules/0x00-architecture.md)
      "IAM gate" — every entry is a place the automated rule was deliberately
      waived, and each one is a thing you are personally signing off
- [ ] Attach a scoped permissions policy to `GitHubActionsDeployRole`
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

**What I have to do for this step is not clear to me, I ran 'cd infra && npm run synth' and got the following output:**
``npm run synth

> fanwire-infra@0.1.0 synth
> cdk synth --quiet

'cdk' is not recognized as an internal or external command,
operable program or batch file.``
The exception list is not human-readable and I don't understand the risks I should be aware of.
For the second to last step, there is no instruction at all on how to actually 'Attach a scoped permissions policy to `GitHubActionsDeployRole`'.

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

- [ ] Confirm the post-free-tier figure in writing somewhere durable

**You have already answered this** — "the $35/mo is okay, continue with the
current implementation plan" — but that answer is currently **uncommitted in
your working tree** on `phase-4-docs`. Commit it, or it is lost.

Levers if you change your mind: fewer WAF managed rule groups (~$9 → less), or
single-AZ interface endpoints (already accepted, see
[`03-open-decisions.md`](03-open-decisions.md)).

**Shield Advanced is explicitly not to be enabled** — flat $3k/mo, not
justified at this scale.
([`security.md`](../wiki/CodeContext/Standards/security.md))

**Source:** `phase-4-manager-agent.md` "Open, needs a human decision"
*(unmerged `phase-4-docs` branch)*.

**I have been informed about the budget increase, its okay I approve it**

---

## 5. Optional: an API-SPORTS key for live scores in dev

Without it the feed simply shows no live scores. Nothing breaks.

- [ ] Register a free key at <https://api-sports.io> (basketball)
- [ ] Add to `backend/.env`:

```
API_SPORTS_KEY=<key>
API_SPORTS_BASE_URL=https://v1.basketball.api-sports.io
```

In production this comes from Secrets Manager, not `.env` — the ingestion
Lambda already reads it from there.

**Source:** `phase-4-manager-agent.md` frontend checklist item 7
*(unmerged `phase-4-docs` branch)*.

**Until much later in the project's lifecycle, we will strictly rely on data from existing games in a database. We will not get recent let-alone live game results. Another thing is that using an API key will require modeling how to call the API and transform the data to be usable for this project and the database.**

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
