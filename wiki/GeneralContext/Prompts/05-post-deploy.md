# 05 — After the first deploy

> **Worked 2026-09-30; loose ends are in `TODO/02`.** Every checklist item was
> checked by its observable — the results are
> `wiki/CodeContext/Modules/0x00-architecture.md` → "Post-deploy checks,
> 2026-09-30". It produced two fix PRs (notifications email is best-effort;
> the SES identity in CDK) and a context update.
>
> **If you are picking this up,** what is left is `TODO/02-deployment-requirements.md`
> §1–§3, in order: read the `Fanwire-App` drift output with the human, verify
> the deploy of the two fixes by their two observables (identity verified; one
> follow → exactly one notification), then SES production access.
> `cfn-exec-role` is `07`; the agent follow-ups are `08`. Do not re-run the
> checks that already passed.

**Objective:** work the post-deploy checklist and the fallout. Each item
silently does nothing until someone does it, and several were unverifiable
before real resources existed.

**Read:** `00-session-protocol.md` and `TODO/02-deployment-requirements.md` §2 —
GuardDuty Malware Protection on the quarantine bucket (compose-with-media stays
broken until it is on), the SES identity and production-access request, the ACM
certificate and aliases, re-running the IAM gate against reality, and the
`lambda-vpc-eni` design review.

Narrowing `cfn-exec-role` is on that checklist too, but it is large enough and
risky enough to own a prompt: `07-deploy-role-scoping.md`. Inventory it here,
do it there.

Same split as `03`: the human runs AWS, one line of PowerShell at a time, and
you verify. Fixes to repo code go through the ordinary loop.

**State you inherit (2026-09-30):** all eight stacks are live and egress works
— the NAT instance's bootstrap was replaced in PR #75 after the default one
was OOM-killed, which had silently broken every call to Cognito, EventBridge,
Secrets Manager and SES. The ACM/aliases item is already evidenced. Read
`TODO/04-first-deploy.md` §4 "Traps" before handing over any command; the
`charmap` one bites any `aws … | Select-String` line.

**Prove things with a route that exercises them.** Twice in the first deploy a
green check proved less than it seemed: `/api/health` touches neither the
database nor egress, and a clean synth says nothing about what happens at
boot. For each checklist item, name the observable that would fail if it were
not done, and check that.
