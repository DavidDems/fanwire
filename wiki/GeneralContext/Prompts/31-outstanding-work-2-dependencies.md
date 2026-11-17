---
type: prompt
---

# 31 — Outstanding work, track 2: dependencies, security alerts, model names

**Brief for a Director session.** Shared rules: [29](29-outstanding-work.md).

**Objective:** clear the new repository's supply-chain backlog and settle the
pipeline's model names, in the order the Director recommended and the human
accepted ([ADR 0035](../Decisions/0035-outstanding-work-answers.md)). Closes
backlog item 11 and `Prompts/19`.

## Read first, in this order

1. `Prompts/19-dependency-upkeep.md`: what Renovate's rules are and what a
   green CI cannot see (the CLI isolation flags, the synthesized stack).
   Its "Where things stand" cites the archive's dashboard; use the new one.
2. `Architecture/github-automation-setup-renovate.md` §7 and
   `.github/renovate.json`: the groups, and why majors wait for a tick.
3. `.ai/docs/handoff.md` §10.6, `Architecture/deploy-traps.md`.

## Where things stand (2026-11-17), verify, don't trust

- Dependency Dashboard is issue #2 of `DavidDems/fanwire`: about 20 branches
  "pending approval" and two "pending status checks"; none is created.
  `gh issue view 2 --repo DavidDems/fanwire`.
- Dependabot reports 3 open alerts on `main` (`minimatch` twice, `glob`,
  `deepmerge`; medium and low):
  `gh api repos/DavidDems/fanwire/dependabot/alerts`. They are probably
  transitive.
- Pending majors include `typescript` 7, `vite` 8, `vitest` 5, the React
  monorepo, `eslint` 10, `msw` 3, `jsdom` 31, `date-fns` 4, `zustand` 5,
  `@types/node` 26, `@vitejs/plugin-react` 6, `python` 3.15, `postgres` 18.
- `.ai/config.json` still names `claude-opus-5`, `claude-sonnet-5` and
  `claude-haiku-4-5`.

## Deliverables (in this order)

1. **The three alerts.** Find the parent that pulls each one in. Prefer
   a parent bump; use an `overrides` entry only when none exists. A Director
   PR (manifests are denied to unit roles). `npm audit` in `frontend/` and
   `infra/` stays clean at the CI's audit level.
2. **Non-major groups first**, then actions: the human ticks each box on the
   dashboard; you review each PR for what CI cannot see (the synthesized
   stack for `aws-cdk` and `aws-cdk-lib`, the pinned CLI for
   `@anthropic-ai/claude-code`). Never approve a bump that moves the CLI
   without reading `.ai/docs/handoff.md` §10.1 D2b.
3. **Majors, one per PR**, toolchain before UI: `@types/node`, `eslint`,
   `vitest` with `jsdom`, `msw`, `date-fns`, `zustand`, `@testing-library`,
   `@vitejs/plugin-react`; then `vite`; then `typescript` 7 and the React
   major last, each alone. A major that needs source changes is a `hand` unit
   with a spec (a frontend source edit is not a Director edit). Hold
   `python` 3.15 and `postgres` 18 until the AWS-side runtime and the RDS
   engine version support them: report, don't force.
4. **Model names (item 11).** Update `.ai/config.json` to `claude-sonnet-5-5`,
   `claude-opus-5-5` and `claude-haiku-5-5`, with the structural test that
   pins them, and every doc that quotes the old names.
5. **Close-out.** Delete `Prompts/19`; the dashboard shows nothing pending
   that you didn't decide; say in the PR which majors are held and why.

## How the human wants the work done

The human approves and merges every Renovate PR. Give them the order and a
one-line verdict per PR (merge, hold, needs a unit). A failed major is a
reason to hold it, not to loosen a test.

## Mechanics learned the hard way

- A bump that CI passes can still break the deploy: read the `cdk diff` step
  after the merge, and the human approves the deploy only after that.
- Renovate pull requests opened by a bot keep `action_required`; the human
  approves their runs.
- Frontend suites flake when run beside the backend and infra suites: rerun
  alone before blaming the bump.
