# Human decisions log

**Manager-tier.** Product and process questions agents asked, with the human's
answers. Each entry names where the decision is now *implemented or recorded as
current state*. This page is a log and an index, not the place an agent learns
the rule: the linked file is.

These answers were staged in `TODO/03-open-decisions.md` while their intended
home, `Prompts/phase-4-manager-agent.md`, was agent-unwritable. That file was
deleted on 2026-09-29 (commit `2fc5de9`), so the answers live here instead. The
section numbers match the old `TODO/03` sections, which older links cite.

## Infrastructure and cost (answered by 2026-09-21)

| Question | Answer | Recorded in |
|---|---|---|
| Lambdas need the VPC for RDS but also call API-SPORTS and Cognito JWKS | A cheap **NAT instance**, not a NAT Gateway | `wiki/CodeContext/Modules/0x00-architecture.md` → "Egress" |
| VPC interface-endpoint cost | Single-AZ acceptable. Superseded: no interface endpoints at all, everything goes through the NAT instance | 0x00 → "Egress" |
| Local auth for browser testing | **Real auth, no in-house fake.** Led to the dev Cognito pool | `dev-auth-setup.md` |
| Is DOB hidden from public profiles? | **Yes.** Held after registration, never shown publicly | `0x01-users.md` |
| Infra idle cost of about $35/month | **Accepted** | This log. The budget alert is in 0x00 → "AWS Budgets" |
| NAT AMI upgrade cadence (2026-10-02) | **On advisories only**, no schedule | `wiki/CodeContext/Standards/build-deployment.md` → "Upgrading the NAT instance's AMI" |

## §1. Dev media uploads — real dev S3 buckets plus a dev script (2026-09-22)

Locally there is no S3 and no GuardDuty, so an uploaded image never reaches
`processed`. **Answer: (a), real dev buckets**, created by hand in
`fanwire-workload` with the same TLS-only and block-public-ACL posture as the
CDK buckets, plus a dev-only script that supplies the scan verdict. That verdict
is the one fake in the path, and it must say loudly that it is one.

- Buckets: done 2026-09-25. Their configuration is `infra/dev/`.
- Script: `MEDIA-002` (`.ai/tasks/MEDIA-002/`). Until it lands, a local upload
  stays un-`processed`, as `0x08-frontend.md` → "Compose" describes.

## §2. Test accounts in the dev Cognito pool — `+alias`, a human confirms

**Answer: a `+alias` of the human's own address** (`daviddemrs92+fw<n>@gmail.com`),
with the human clicking the real confirmation link. **No agent gets
`cognito-idp:AdminConfirmSignUp`**: an agent holding it could create confirmed
identities at will, and the dev pool is real precisely so that its auth path can
be trusted. Recorded for operators in `dev-auth-setup.md` → "Test accounts".

## §3. Browser automation — not confirmed, so reported as not done

The frontend briefs ask for a real click-through, which needs a browser tool
allowed on `http://localhost:5173`. **No answer has been given, so the default
holds: browser verification is reported as NOT DONE** rather than assumed. A
brief that claims a click-through that did not happen is worse than one that
says it was skipped. Open in `TODO/03` until the human confirms a tool.

## §4. When date of birth is collected — at profile creation, minimum 16 (2026-09-21)

DOB must be strictly in the past, and the user at least 16 in whole years; a
violation is a `422` at the API boundary. **Implemented** by `USERS-002`.
Recorded in `0x01-users.md` → `POST /users`.

Not settled by this decision: rows created before the gate are not re-checked,
and a self-declared DOB is not age verification.

## §5. UI design, palette and name styling

- **`ui-design` skill:** install after review. Installed 2026-09-22, by copying
  the files rather than running the installer.
- **Palette:** Jet Black / Teal / Pale Sky, decided 2026-09-22.
- **Name styling (2026-10-02):** `fanwire` is always lowercase. That applies to
  the name only: other copy uses sentence case. There is no wordmark or icon yet.

- **Brand (2026-10-05, `Prompts/12`):** a wire-`f` symbol plus a typeset
  wordmark in Outfit SemiBold (600). The palette is kept, with
  `--color-accent-on-dark` `#279ab1` added (the sea-green alternative was
  declined). The jurisdiction for rights questions is Canada. The assets are on
  `main` under `brand/`, and the trademark-database check found nothing similar
  (2026-10-06).

All of these are recorded, with the measured contrast table, in
`wiki/CodeContext/FrontendUI/decisions.md`.
