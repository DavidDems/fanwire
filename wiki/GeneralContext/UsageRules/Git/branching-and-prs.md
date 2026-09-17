# Branching & PRs

## MUST NOT
- Commit directly to `main`. Every change lands on a feature branch first.
- Bundle more than one module's work into a single PR — one PR per module, so each is independently reviewable.
- Open a PR that mixes a failing-test commit and an implementation commit into one commit — the two-commit sequence (test, then implementation) must be visible in the PR history, per `wiki/GeneralContext/UsageRules/Coding/tdd.md`.
- Leave a PR description without naming which pattern(s)/principle(s) it exercises and any judgment calls made on open decisions — an unexplained PR is not reviewable at speed.
- Force-push a shared branch or rewrite history another agent/human may already be building on.
