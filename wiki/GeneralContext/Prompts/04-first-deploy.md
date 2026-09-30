# 04 — The first deploy

> **Completed 2026-09-30.** The site is live; `TODO/04-first-deploy.md` §4 has
> the outcome and its traps. Do not re-run this prompt. To ship a frontend
> change, follow `wiki/CodeContext/Standards/build-deployment.md` →
> "Rebuilding the SPA"; for everything after the deploy, run `05`.

**Objective:** get `https://fanwire.daviddems.com` serving the SPA. **The human
runs every AWS command; you never run `cdk deploy`.** You prepare each phase,
hand over one-line PowerShell, read the output back and say what it means.

**Read:** `00-session-protocol.md` and `TODO/04-first-deploy.md` §4, which
explains why this is three phases and not one.

Phase 1 brings up all eight stacks (~30–45 min, full monthly cost starts).
Phase 2 invokes the migration function once. Phase 3 reads the stack outputs,
builds the bundle against them, redeploys with `-c deployFrontend=true`.

Expect the media pipeline and the IAM gate to surprise you.
