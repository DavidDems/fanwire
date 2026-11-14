---
type: runbook
---

# GitHub automation setup: secrets

Part of [GitHub automation setup](github-automation-setup.md).

## 2. Secrets — all are *repository* secrets

| Secret | For |
|---|---|
| `ANTHROPIC_API_KEY` | The provider. Must be a **Claude Console** key — a Pro/Max plan does not grant API access, and an Organization-settings key is not the same thing; with the wrong kind every worker run fails. Also read, in one step that holds no GitHub token, by `ci-summary.yml`, `coverage-check.yml`, `spec-drift.yml`, `wiki-proposal.yml` and `director-review.yml`. |
| `AGENT_DISPATCH_TOKEN` | A fine-grained PAT, this repository only, **Actions: read+write** and **Contents: read+write**, nothing else. Every dispatch step prefers it. |
| `TYPESAFE_API_KEY` | The direct TypeSafe key for `jev` (route `api.typesafe.ai/v1/systemone`, model `jev-latest`). Read only by `.ai/bin/ask_jev.py`, in one step of a job that holds no other credential: `jev-smoke.yml` (dispatch-only) and, wired but switched off ([ADR 0025](../Decisions/0025-jev-shadow-only-switched-off.md)), `coverage-check.yml` and `spec-drift.yml`. Never pasted into a session. |

There is no `AI_GATEWAY_API_KEY` (the Vercel gateway route): it is deleted
([ADR 0023](../Decisions/0023-human-gates-on-agent-work.md)).

### ⚠️ Repository secret, not an environment secret

The single most confusable thing in this setup. An **environment** secret
looks equivalent to a repository secret in the UI and is not.

An environment secret is only injected into a job that declares
`environment: <name>`, and none of the dispatch steps do. The expression
`${{ secrets.AGENT_DISPATCH_TOKEN || github.token }}` then resolves the left
side to empty and **silently falls back to `github.token`** — no error, no log
line, and the failure it was meant to fix stays exactly as it was. Environments
exist to gate deployments behind approvals, which is the opposite of what an
unattended orchestrator wants.

```powershell
gh secret list --repo DavidDems/fanwire
```

### Why the token is needed at all

GitHub does **not** fire `workflow_run` for a run that this repository's own
workflow started using the default `GITHUB_TOKEN`. That is precisely the
CI-finished leg of the chain, so without the PAT every task stalls at
`BASELINE_CI` and again at `IMPL_CI` and has to be nudged by hand twice.

`workflow_run` fires normally for `pull_request`- and `push`-triggered runs, so
neither of those is evidence the token works. **The only proof is a task
crossing a CI boundary with no manual nudge.**

### ⚠️ The token is a person's credential

A fine-grained PAT is owned by an account, so a workflow using it acts **as that
person** and inherits that person's ruleset bypass
(`github-automation-setup-ruleset.md` §3). The PR-creation step is deliberately
pinned to `github.token` so agent PRs stay bot-authored. **Keep it pinned, and
do not widen the PAT.**
