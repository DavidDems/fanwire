# 05 — After the first deploy

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
