# 03 — Open decisions waiting on you

Questions agents have asked and are blocked on, or answered but not yet
recorded durably. Each says what it blocks.

**Source for most of this:** `wiki/GeneralContext/Prompts/phase-4-manager-agent.md`,
"Frontend: human input needed before Phase 5a starts" and "Decisions needed
from the human" — currently on the **unmerged `phase-4-docs` branch**.

---

## Answered, but not yet on `main`

You have answered these. They live on `phase-4-docs`, which has four unmerged
commits, and one answer is not even committed there.

| Question | Your answer | Where it is |
|---|---|---|
| No-NAT vs. external calls — Lambdas need the VPC for RDS but also need API-SPORTS and Cognito JWKS | Use a cheap **NAT instance** (~$3/mo), not a NAT Gateway | `phase-4-docs`, committed |
| VPC interface-endpoint cost (~$7/mo each per AZ) | **Single-AZ endpoints acceptable** | `phase-4-docs`, committed |
| Local auth for browser testing | **Real auth, not an in-house fake** → led to the real dev Cognito pool | `phase-4-docs`, committed; implemented |
| Is DOB hidden from public profiles the intended rule? | **Yes** — held by the DB after registration, never on public profiles | `phase-4-docs`, committed |
| Infra idle cost ~$35/mo after free tier | **Accepted** | ⚠️ **uncommitted in your working tree** |

- [ ] Commit the infra-cost answer and merge `phase-4-docs`, or these decisions
      stay invisible to any agent that reads only `main`

**Why this matters more than it looks:** an agent starting fresh reads `main`.
A decision you made in a branch that has not landed is, to that agent, a
decision that has not been made — so it will either ask again or guess.

---

## Merge order for the remaining backend PRs

- [ ] Merge **#18** first, then **#19** and the Lambda-handlers PR (either
      order)

#19 and the handlers PR are both **stacked on #18**. Merge them top-down and
nothing reaches `main` — that has already happened once on this project, and is
why every later brief verifies ancestry first.

Consider turning on **Settings → General → "Automatically delete head
branches"**, which makes the failure mode mechanical rather than a rule someone
has to remember. It is listed as a candidate automation in
[`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) §6.

---

## Still unanswered — blocks Phase 5a (frontend)

These are quoted from the phase-4 brief's checklist. Answer them in that file
so they land with the merge.

### 1. Dev media uploads

Locally there is no S3 and no GuardDuty, so an uploaded image never reaches
`Processed` and cannot be attached — compose-with-media cannot be clicked
through in a browser.

- (a) Create real dev S3 buckets (quarantine + public) with CLI steps like the
  Cognito ones, plus a dev-only script that runs the processing pipeline on
  demand
- (b) Run a local S3 emulator in compose
- (c) Accept that media upload is `msw`-tested only, browser-verified later

Your stance on auth ("real, not a shortcut") points at **(a)**.

- [ ] **Your answer:**

### 2. Test accounts in the dev Cognito pool

Sign-up sends a real confirmation email. Which inbox should browser-test
sign-ups use? A `+alias` of your address works. Alternatively, may an agent
confirm test users with `aws cognito-idp admin-confirm-sign-up` using your SSO
profile? That needs an active `aws sso login` on the machine during the session.

- [ ] **Your answer:**

### 3. Browser automation

The frontend briefs require a real click-through, which needs the
Claude-in-Chrome extension installed and allowed on `http://localhost:5173`.

- [ ] **Your answer:** (set up / report browser verification as not done)

### 4. When date of birth is collected

The backend requires `date_of_birth` at profile creation (`POST /users`), right
after Cognito confirms the email. Is that the intended step? Is there a minimum
age (e.g. 13+) the form should enforce? Nothing in the business rules says so —
and this is a legal question as much as a product one.

- [ ] **Your answer:**

### 5. UI design

`aws-stack.md` suggests installing `omer-metin/skills-for-antigravity`'s
`ui-design` skill yourself, after reviewing it. Install it, or have the
frontend use plain CSS modules with a small token file (the default if
unanswered)? Any brand colours or name styling?

- [ ] **Your answer:**

---

## How to answer these

Answer **in the source file**, not here — `phase-4-manager-agent.md` has
`> _your answer:_` slots, and that file is what the next manager agent reads.
This page is an index, and an index that holds the only copy of an answer is a
place answers go to be lost.

Then commit and merge, so `main` carries them.
