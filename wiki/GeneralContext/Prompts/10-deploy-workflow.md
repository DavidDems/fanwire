# 10 — The automated deploy workflow

**Objective:** a standalone, separately-reviewed GitHub Actions workflow that
deploys the CDK app with `GitHubActionsDeployRole`. It is the end state that
`wiki/CodeContext/Standards/build-deployment.md` → "Automated deploy" names.
`07` made the role worth automating; this prompt writes the thing that uses it.

**Prerequisites, check them before starting:** `09` is merged and its Network
deploy is recorded. If it is not, stop and say so: an on-merge deploy would
replace the NAT instance on AWS's schedule.

**Read:** `00-session-protocol.md`; `build-deployment.md` → "Automated
deploy" and "Rebuilding the SPA"; `0x00-architecture.md` → "AWS account state"
(the OIDC role, `cfn-exec-role`, what is and is not proven); `infra/iam/README.md`;
`.ai/docs/handoff.md` §5.7; `.github/workflows/` (all four);
`docker/cdk-deploy.Dockerfile`; `TODO/04-first-deploy.md` §4 "Traps".

## The boundary this must keep

`handoff.md` §5.7 forbids wiring deployment into the **agent** workflows. This
is a separate workflow, and it must stay unreachable from them. That is a
technical property to build, not a sentence to write:

- **Tighten the OIDC trust first.** `GitHubActionsDeployRole` trusts
  `repo:DavidDems/fanwire:ref:refs/heads/main`. That trusts **any** workflow
  run from `main`, and the agent workflows also run from `main`. None
  requests `id-token: write` today, but nothing stops one from doing so. Put
  the deploy job in a GitHub **environment** (e.g. `production`) and change
  the trust's `sub` to `repo:DavidDems/fanwire:environment:production`. Then
  only a job that declares that environment can assume the role. The trust
  change is the human's to apply in IAM; commit the new trust policy beside
  `infra/iam/github-actions-deploy-role-policy.json` so it is a reviewed diff.
- `agent-guard` already keeps workers out of `.github/`. Confirm it, and do
  not add an exception.
- No `id-token: write` anywhere except the deploy job.

## Decisions to put to the human, with a recommendation each

- **Trigger.** Recommend `workflow_dispatch` only, at first, then `push` to
  `main` once a few dispatched runs are clean. Whatever the trigger, the
  environment can also require an approving reviewer before the job runs.
- **`--require-approval never`.** CI cannot answer CDK's IAM-change prompt.
  The review of an IAM change then happens at the PR (`iam-policy.test.ts`
  plus the human reviewer) and nowhere else. Say that in the PR body.
- **The frontend.** Steady-state deploys can build the bundle in Docker
  (`docker/frontend.Dockerfile`) with the `VITE_*` values, which are ids, not
  secrets, held as repository variables, then pass `-c deployFrontend=true`.
  Without the flag, a deploy of `Fanwire-Cdn` removes the live
  `BucketDeployment` (`TODO/04` traps).
- **Migrations.** A deploy that adds an Alembic revision needs the migration
  function invoked afterwards (`0x00` → `INFRA-003`). Decide whether the
  workflow invokes it. That needs `lambda:InvokeFunction` on the migration
  function, which the deploy role does not have, and adding it is a
  permissions change for the human to review.

## Shape

- One job, `concurrency` group with `cancel-in-progress: false`, so two
  deploys never overlap.
- Run the CLI from the pinned image (`docker/cdk-deploy.Dockerfile`), not from
  `npx` on the runner.
- `cdk diff` first, logged, then `cdk deploy --all`.
- Nothing in it may update `FanwireCdkCfnExecPolicy`. The deploy role cannot,
  and must not be able to. A stack change that adds an AWS service still
  needs the human to roll out a new policy version before the deploy that
  uses it (`00-session-protocol.md`, Standing limits).

## Not in this prompt

- **The permissions boundary** on created roles: the remaining route from
  "can get a template deployed" to admin (`infra/iam/README.md` → "What this
  does not close"). Recommend it as the next unit after this one. It changes
  all twelve live roles, so it is its own reviewed deploy.
- Running the workflow. You write it and the human dispatches it. You never
  run `cdk deploy`, from a session or by triggering a workflow.

Update `build-deployment.md` → "Automated deploy" and `0x00` → "AWS account
state" in the same PR. Nothing here has merge permission. One PR. Merge nothing.
