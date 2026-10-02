# 03 — What is left for the human, and proving it got done

**Objective:** tell the human exactly what only they can do, hand them the
commands, then verify. Re-run this prompt whenever they report a step finished.

**Read:** `00-session-protocol.md`, `TODO/02-deployment-requirements.md` (whatever
is still in it; finished items are deleted), `TODO/04-first-deploy.md` §2 and §4, and
`wiki/CodeContext/Modules/0x00-architecture.md` "AWS account state".

Audit each item against reality — the repo, and read-only `aws` calls — rather
than the checkbox. Report only what is genuinely outstanding.

**Every command you give them is one line of PowerShell.** A multi-line or
`sh`-style command half-succeeds on their machine and has already broken a
Route 53 token. Never run `cdk deploy` yourself.
