# Incident Runbook

**Status: interim.** Written pre-CDK, when nothing is deployed to `fanwire-workload` except account-level
scaffolding. The "lockout" and "asset inventory" sections below are deliberately generic because there are no
application resources yet to name specifically. **This must be revisited once Phase 6 (CDK stacks) lands and
`GitHubActionsDeployRole` receives real permissions** — at that point, name the actual roles/Lambdas/buckets
the CI role can touch, and add a second, concrete lockout sequence alongside this one.

## Trigger

Act on GuardDuty findings of **Medium or High** severity only. Low-severity findings are informational/noisy
by design in GuardDuty and are not actioned under this runbook (revisit this threshold once real traffic
exists and a baseline of "normal" Low findings is established).

Detection is currently **manual**: no SNS/EventBridge alerting is wired up yet, so findings are only seen by
periodically checking the GuardDuty console in `fanwire-log-archive` (delegated admin). A push notification
(EventBridge → SNS → email) is a planned follow-up, not yet built — until it exists, periodic manual checks
are the only detection mechanism, so check on some regular cadence.

## Priority order of suspicion

1. **`GitHubActionsDeployRole`** (in `fanwire-workload`) — the single highest-risk credential once it carries
   real deploy permissions post-Phase-6. Currently has zero permissions attached, so it is not yet a live
   threat vector, but treat it as priority #1 the moment that changes.
2. Personal SSO session (Identity Center) — lower risk than #1 because it requires David's own MFA-backed
   login, but still reviewed if flagged.
3. AWS service-linked roles (GuardDuty, Config, etc.) — lowest priority; these are AWS-managed and narrowly
   scoped by definition.

## Response steps

1. **Note the finding.** Record the GuardDuty finding ID, affected account, resource, and timestamp before
   touching anything — CloudTrail evidence in the Object-Locked `log-archive` bucket is already durable, but
   the finding record itself and the flagged resource's live state are not, so capture them before acting.
2. **Do not delete the flagged resource and do not disable CloudTrail.** Preserve evidence first.
3. **Revoke the specific flagged credential's active sessions**, not a broad set of credentials:
   - If it's `GitHubActionsDeployRole`: remove/replace its permissions policy immediately (it should have none
     until Phase 6 review anyway) and check whether the OIDC trust policy needs tightening.
   - If it's David's SSO session: sign out that session in Identity Center and rotate nothing else unless the
     finding indicates broader compromise.
4. **Check CloudTrail** (in `log-archive`) for what the flagged credential actually did in the window around
   the finding, scoped to that credential's ARN.
5. **Rotate anything the credential could plausibly have reached** — based on what CloudTrail shows it
   touched, not a blanket rotation of everything.
6. **Write a short post-incident note** in the repo (e.g. a dated entry — location TBD, but keep it in-repo)
   covering: what fired, what it turned out to be (real or false positive), and what changed as a result. No
   external communication needed — this project is currently solo, so all incident communication stays within
   the repo and David himself.

## Out of scope for now

- Automated alerting (SNS/EventBridge) — planned, not built.
- Named resource-level lockout steps — blocked on Phase 6 CDK stacks existing.
- Security Hub — optional at this budget per `wiki/CodeContext/Standards/security.md`, not part of this runbook.