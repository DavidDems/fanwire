---
type: decision
---

# 0033 - Deployment stays outside the agent workflows

Decision: 2026-09-21, the human, when the agent system was built; the separate
deploy workflow followed on 2026-10-02. Recorded by the Director, approved by
the human.

## Context

The agent workflows (`agent-orchestrator.yml`, `agent-worker.yml`,
`agent-guard.yml`) run model-written code against this repository without a
human between steps. Their permission model bounds what a worker may write to
a branch: role path permissions, the guard, no merge permission, no GitHub
token where the model runs. It was designed for changes that reach `main`
through a human-reviewed pull request, not for changes that reach AWS.

A pipeline that can deploy is a different risk class. A deploy credential
reaches running infrastructure and user data, and a mistake there is not
undone by closing a pull request.

## Choice

- **No agent workflow deploys or touches AWS.** None requests an OIDC token,
  declares a GitHub environment, or runs `cdk deploy`.
- **Deploying is its own workflow, `.github/workflows/deploy.yml`.** It runs on
  merge to `main` and on dispatch, and every run waits for a human's approval
  in the `production` environment.
- **The deploy role is reachable only from that environment.**
  `GitHubActionsDeployRole` trusts the `production` environment, not a branch,
  and holds only `sts:AssumeRole` on the eight CDK bootstrap roles
  (`infra/iam/github-actions-deploy-role-policy.json`).
- **The boundary is tested.** `.ai/tests/test_deploy_workflow.py` fails if any
  other workflow requests an OIDC token, declares an environment, or names
  `deploy.yml`.

This is not a ban on automated deployment: deployment is automated, behind a
human gate, outside the agent system.

## Consequences

- An agent's work reaches AWS only after a human merges it and a human approves
  the deploy run: two separate human actions.
- Widening the agent workflows to deploy would need a new decision and a
  permission model designed for it; the existing one does not cover it.
- The deploy design, its limits and the IAM boundary are owned by
  `wiki/CodeContext/Standards/build-deployment.md` "Automated deploy"; the
  agent-side summary is `.ai/docs/handoff.md` §5.7.
