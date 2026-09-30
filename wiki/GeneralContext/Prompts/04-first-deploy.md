# 04 — The first deploy

**Objective:** get `https://fanwire.daviddems.com` serving the SPA. **The human
runs every AWS command; you never run `cdk deploy`.** You prepare each phase,
hand over one-line PowerShell, read the output back and say what it means.

**Read:** `00-session-protocol.md` and `TODO/04-first-deploy.md` §4, which
explains why this is three phases and not one.

Phase 1 brings up all eight stacks (~30–45 min, full monthly cost starts).
Phase 2 invokes the migration function once. Phase 3 reads the stack outputs,
builds the bundle against them, redeploys with `-c deployFrontend=true`.

Expect the media pipeline and the IAM gate to surprise you.
