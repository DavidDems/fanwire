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

## §3. Browser automation — Playwright MCP, for hand-run sessions (2026-10-06)

**Answer:** the human installed Playwright MCP as a local Claude Code MCP
server on 2026-10-06 (`claude mcp add playwright -- npx @playwright/mcp@latest`).
A hand-run Director session may drive it against `npm run dev` or `vite
preview` on localhost, signed in only with the two dev-pool test accounts; a
row it really checked counts as done. It is not a repo dependency and not in
CI, so **dispatched workers have no browser**, and anything a tool did not
really drive is still reported as **NOT DONE**. axe stays NOT DONE until the
human runs the browser extension. How it is used:
`wiki/CodeContext/FrontendUI/verification.md` §3a.

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

## §6. After the frontend: back to the automated workflow, with `jev` (2026-10-07)

- **Focus.** With every planned frontend unit merged (`FRONTEND-007`, #114),
  the project's focus moves back to the automated agent workflow: agents
  dispatched through the API once a task branch and spec exist, rather than
  units run by hand from Claude Code. Before any task runs, the workflow is
  reviewed for safety, performance and cost, and the human decides the
  changes (the review prompt, done and deleted 2026-10-08; outcome in §7). The
  remaining build work is `TODO/02-backlog.md`.
- **`jev`.** The "System One" typed-decision layer (TypeSafe's `jev`) is to
  be incorporated. The human has a **direct TypeSafe key** (route
  `api.typesafe.ai`, model `jev-latest`), not the Vercel AI Gateway route the
  parked `jev-decision-layer` branch points at. Stored as the repository
  secret `TYPESAFE_API_KEY` on 2026-10-08; how it is wired is §7.

## §7. The agent workflow review (2026-10-08)

The review in §6 reported; its findings (D1–D7) and evidence are
`.ai/docs/handoff.md` §10, and the work queue is `TODO/02-backlog.md` →
"Agent system". The human decided:

- **Order.** D1–D3 (the CI-verdict trust hole, the worker's readable token
  and shell injection, the silent stalls) first — plus D2b, found while
  doing D2 and not yet designed, one Director PR each; then
  the test-kit deny, D4–D6; then D7, the newer models, the CLI pin and the CI
  half of bug 17. **No task is dispatched until D1–D3 have merged**, and
  none without the human saying go. The first real task is `MEDIA-002`.
- **`jev` in shadow mode**, after D1–D3: asked beside the Opus Manager and
  recorded, not applied, until enough agreement is on record. Flake
  forgiveness by model confidence is declined.
- **`ESCALATED` gets a human exit**: `MANAGER_RETRY`/`MANAGER_RESCOPE` become
  legal from it.
- **The test kit is closed to the code agent**: `frontend/src/test/**` joins
  `code_agent.deny`.
- **Bot-opened PRs keep `action_required`**: a deliberate human gate before CI
  spends on agent work.
- **Models**: Sonnet roles to `claude-sonnet-5-5`, the Manager to
  `claude-opus-5-5`.
- **Spend controls** (set by the human): Claude Console monthly limit $40,
  auto-recharge to $15 below $5; about $10 of TypeSafe credit. Until D6 lands,
  the cost of a run is measured by recording both balances before and after
  it, not from `.ai/telemetry/`.
- **Repository settings changed**: fork-PR workflow approval is now
  `all_external_contributors`; `AI_GATEWAY_API_KEY` deleted. Both are
  recorded in `github-automation-setup.md`.
