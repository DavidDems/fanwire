---
type: runbook
---

# Account lifecycle activation status

Reviewed in Outstanding-work track 6 (2026-11-25). The rollout plan this
follows is [account-lifecycle-proof](account-lifecycle-proof.md) step 9.

Documentation only: nothing here ran against AWS (the SSO token had expired)
and nothing was switched on. Every live check is a read-only command in the
track 6 PR's manual steps and the activation PR's body. **Today, with the flag off, `DELETE /users/me/data`
answers 503 for everyone** (`delete_account_data` raises `LifecycleUnavailable`
when the flag is off and no operation exists), so the flag is what switches
deletion on for real users. It is set in the separate activation PR (`outstanding-track-6-activate`), which merges only after the track deploy, the Migration Lambda and every gate below are green.

| Gate | Evidence in hand | Missing | State |
|---|---|---|---|
| 1. Schema and backfill | `9c009a110001` creates the authority tables and backfills one authority per existing profile, preserving `deleted_at` as inactive. A profile created after that, while dormant, has none, and `authority_for_sub(adopt_profile=True)` adopts it on first fence. `ready()` refuses every fenced request if the flag is on and the tables are missing | which revisions the Migration Lambda applied (its logs keep 30 days only) | UNKNOWN |
| 2. Legacy identities | after activation, `prepare_profile` adopts a Cognito identity with no authority only if Cognito's `UserCreateDate` is at or after `ACCOUNT_LIFECYCLE_CUTOVER_AT`; an older one gets `LifecycleUnavailable` (503) on profile creation. Profiles are adopted whatever their age. So the only identities at risk are pre-cutover ones with no profile: incomplete signups, or leftovers of a partial deletion | the inventory: Cognito's list (read-only command prepared) compared with production `users.cognito_sub`. No read-only tool reads production profiles; the human knows the few accounts | UNKNOWN |
| 3. Media bucket versioning | `QuarantineBucket` and `PublicMediaBucket` are `versioned: false` in `storage-stack.ts`; the worker holds `s3:DeleteObject` only | `get-bucket-versioning` on both: empty means never versioned (green); `Suspended` or `Enabled` blocks activation for a reviewed version-cleanup plan | UNKNOWN |
| 4. Consumer drain | every function runs one image and reads the flag from the same `common` env, so one deploy switches API, consumers and reconciler together. During the CloudFormation update some functions are briefly on and others off, but dormant code still fences: once the authority tables exist, `ready()` is true and `_namespace` returns the trusted issuer whenever the pool id is set, so a dormant consumer consults the same authorities. In-flight messages meet one fence or the other, never none | queue and DLQ depth before and after the deploy (commands prepared); all should be 0 | UNKNOWN |
| 5. Alarms and schedule | `AccountDeletionSchedule` is `rate(5 minutes)` with `retryAttempts: 0`; the handler raises when any operation needs a retry, so `AccountDeletionErrorsAlarm` (from the construct-tree sweep) fires on stuck work; DLQs alarm on their first message | the rule's state and target, the function's invocations and errors, the alarms' state and actions, the alarm topic's subscription (commands prepared) | UNKNOWN |
| 6. Warning copy | the dialog says images are deleted and "Backup copies expire within 7 days" (RDS `backupRetention: 7 days`, true). But `/media/*` is `CACHING_OPTIMIZED` (24 h default TTL) and nothing sets `Cache-Control` on media, so an edge can serve a deleted image for up to 24 hours. Fixed by `FRONTEND-060` (copy only, not switched on) | the human's approval of the wording | GREEN once FRONTEND-060 merges, if the wording is approved |

## What the human approves

1. **Schema**: read the Migration log command's output. If its newest `revision` is not `fd9d2851baf5` (or the head after this track), approve one Migration Lambda invoke right after the track deploy.
2. **Legacy identities**: read the Cognito list. For each identity with no profile created before the cutover, decide: adopt (set the cutover earlier than its `UserCreateDate`), leave it unable to create a profile, or delete it in the console. Never invent a deleted subject. If every identity has a profile, the cutover is simply the activation deploy's time.
3. **Buckets**: confirm both answer empty.
4. **Drain**: confirm every queue and DLQ is 0 just before merging the activation PR, and again after.
5. **Alarms and schedule**: confirm the rule is `ENABLED`, targets the AccountDeletion function, the function has invocations and 0 errors, and the alarms are `OK` with the alarm topic as their action.
6. **Copy**: approve or overturn FRONTEND-060's sentence.
