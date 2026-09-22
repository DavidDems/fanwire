# 03 — Open decisions waiting on you

Questions agents have asked and are blocked on, or answered but not yet
recorded durably. Each says what it blocks.

**Source for most of this:** `wiki/GeneralContext/Prompts/phase-4-manager-agent.md`,
"Frontend: human input needed before Phase 5a starts" and "Decisions needed
from the human" — **now merged to `main`**.

---

## Answered and on `main` ✅

Verified 2026-09-21: `phase-4-docs` is fully merged (`git log
origin/main..origin/phase-4-docs` is empty), so every one of these is readable
by an agent that only reads `main`.

| Question | Your answer |
|---|---|
| No-NAT vs. external calls — Lambdas need the VPC for RDS but also need API-SPORTS and Cognito JWKS | Use a cheap **NAT instance** (~$3/mo), not a NAT Gateway |
| VPC interface-endpoint cost (~$7/mo each per AZ) | **Single-AZ endpoints acceptable** |
| Local auth for browser testing | **Real auth, not an in-house fake** → led to the real dev Cognito pool |
| Is DOB hidden from public profiles the intended rule? | **Yes** — held by the DB after registration, never on public profiles |
| Infra idle cost ~$35/mo after free tier | **Accepted** — on `main`, and restated in [`02`](02-deployment-requirements.md) §4 |

- [x] Commit the infra-cost answer and merge `phase-4-docs`

The warning that the cost answer was uncommitted is **stale** — it landed with
the merge. Kept visible rather than deleted, because the reasoning still holds:
an agent starting fresh reads `main`, so a decision made on an unmerged branch
is, to that agent, a decision that has not been made.

---

## Merge order for the remaining backend PRs ✅

- [x] Merge **#18** first, then **#19** and the Lambda-handlers PR

Both merged 2026-09-19 (#18 at 00:40:57Z, #19 at 00:41:12Z), in the right order.

- [x] **Settings → General → "Automatically delete head branches"**

Enabled 2026-09-21 (`delete_branch_on_merge: true`) — the stacked-PR trap is now
mechanical rather than a rule to remember, closing that candidate automation in
[`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) §6. The 28 pre-existing
remote branches are unaffected; see [`01`](01-ai-workflow-setup.md) §11.

---

## Phase 5a questions — four answered 2026-09-21, one deferred

⚠️ **These answers are not yet in the file that matters.** The canonical slots
are in
[`phase-4-manager-agent.md`](../wiki/GeneralContext/Prompts/phase-4-manager-agent.md)
items 2–7, and that file is under `wiki/GeneralContext/`, which `AGENTS.md`
marks as never writable by an agent. So they are staged here and **have to be
copied across by you** — until then, a manager agent reading only its own brief
still sees unanswered questions.

- [ ] Copy the answers below into `phase-4-manager-agent.md`'s
      `> _your answer:_` slots (items 2, 3, 5, 6; item 4 is "not set up", item 7
      is declined in [`02`](02-deployment-requirements.md) §5)

### 1. Dev media uploads — **(a) real dev S3 buckets + a dev script**

Locally there is no S3 and no GuardDuty, so an uploaded image never reaches
`Processed` and cannot be attached — compose-with-media cannot be clicked
through in a browser.

**Answer: (a).** Create real dev S3 buckets (quarantine + public) in
`fanwire-workload` with documented CLI steps, like the dev Cognito pool, plus a
dev-only script that runs the processing pipeline on demand. Consistent with the
auth decision: real service, not an emulator.

What this implies, so it is not a surprise later:

- The **GuardDuty scan verdict still has to be simulated** in dev. Malware
  Protection for S3 needs enabling against a real bucket
  ([`02`](02-deployment-requirements.md) §6) and does not run against a
  hand-made dev bucket by default — so the dev script supplies the verdict that
  moves an object `Quarantined → Processed`. That is the one fake in this path,
  and it should be loud about being one.
- Cost is pennies (storage + requests at dev volume), but the buckets are real
  and public-readable on the public side. They need the same TLS-only and
  block-public-ACL posture as the CDK ones, or dev becomes the weak link.

### 2. Test accounts in the dev Cognito pool — **`+alias`, human confirms**

**Answer: a `+alias` of your own address**, with you clicking the real
confirmation link. No agent gets `admin-confirm-sign-up`.

This is the stricter of the two options and worth stating why it is right: an
agent holding `cognito-idp:AdminConfirmSignUp` on the dev pool can create
confirmed identities at will, and the whole point of the dev pool being real is
that its auth path is trustworthy. A human in the loop for account creation
costs seconds and keeps the identity provider outside what any agent can reach —
the same reasoning as `GITHUB_TOKEN: ""` in `agent-worker.yml`.

Practical note: browser-test sign-ups use `daviddemrs92+fw<n>@gmail.com`. Gmail
delivers all of them to the one inbox, and Cognito treats each as a distinct
identity.

### 3. Browser automation — **not confirmed; report as not done**

The frontend briefs require a real click-through, which needs the
Claude-in-Chrome extension installed and allowed on `http://localhost:5173`.

**No answer given, so the default holds: browser verification is reported as
NOT DONE** rather than assumed. A brief that claims a click-through happened
when it did not is worse than one that says it was skipped.

- [ ] If the extension *is* installed, allow it on `http://localhost:5173` and
      say so here — then Phase 5a can claim real browser verification.

### 4. When date of birth is collected — **at profile creation, minimum 16**

The backend requires `date_of_birth` at profile creation (`POST /users`), right
after Cognito confirms the email.

**Answer 2026-09-21: keep it at profile creation. Age must be a positive value
and at least 16 years.** 16 also avoids the parental-consent regime under GDPR
in the strictest EU member states, so it is the stricter of the two defaults
that were on the table.

**Nothing enforces this today.** `CreateUserRequest.date_of_birth` in
`backend/app/users/schemas.py:37` is a bare `date`, so `POST /users` currently
accepts a one-year-old and — because a `date` has no upper bound — a DOB in
2030, which yields a *negative* age. "Positive values only" is the other half of
this answer and it is a real gap, not a formality.

The rule, stated so it can be tested:

- `date_of_birth` must be **strictly in the past** — a future date is rejected,
  which is what makes age positive by construction.
- Age at the time of the request must be **≥ 16 years**, counting whole years
  (someone 16 tomorrow is not 16 today).
- Rejection is a `422` from the schema, not a 500 or a silent coercion.
- Enforced **at the API boundary**, with the form matching it for a decent error
  message — `validate at boundaries only` from
  [`design-principles.md`](../wiki/CodeContext/Standards/design-principles.md)
  means the boundary is authoritative and the browser is a courtesy.

Two things this decision does *not* settle, flagged rather than assumed:

- **Existing rows are not covered.** Nothing backfills or re-checks users
  created before the gate exists. In dev that is fine; if it ever ships with
  real accounts, retrofitting is the expensive version of this task.
- **A self-declared DOB is not age verification.** It is the industry norm and
  almost certainly what you want, but it is a checkbox, not a guarantee, and
  16+ in a form does not make the product compliant on its own.

- [x] **Your answer:** at profile creation; positive age; minimum 16 years.

This is a **well-shaped first real task for the agent pipeline** — one module,
one boundary, acceptance criteria that fail before they pass — and
[`handoff.md`](../.ai/docs/handoff.md) §6 asks for exactly that next. It needs a
task spec under `.ai/tasks/`, a failing test per criterion, and an update to
`0x01-users.md`'s Security section, which documents the DOB rules today.
**Not implemented in this pass** — it is backend behaviour change, not setup.

### 5. UI design — **install the `ui-design` skill, after reviewing it**

**Answer: install it.** `aws-stack.md` points at
`omer-metin/skills-for-antigravity`'s `ui-design` skill and is explicit that you
review it before installing, which is the right order — an installed skill's
instructions shape every frontend file an agent writes afterwards, so it is
third-party input into your build, not just a convenience. Read what it tells an
agent to do before it starts telling agents what to do.

- [ ] Review and install the skill. It is your action, not an agent's: an agent
      installing a skill that then governs agents is a loop with no human in it.
- [ ] **Brand colours / name styling — still needed.** Unanswered, and no
      default can be invented for it. Until you give colours, the token file
      gets neutral placeholders and every screen will need revisiting.

---

## How to answer these

Answer **in the source file**, not here — `phase-4-manager-agent.md` has
`> _your answer:_` slots, and that file is what the next manager agent reads.
This page is an index, and an index that holds the only copy of an answer is a
place answers go to be lost. The answers above are staged here *only* because
that file is agent-unwritable; moving them across is the checkbox at the top of
this section.

Then commit and merge, so `main` carries them.
