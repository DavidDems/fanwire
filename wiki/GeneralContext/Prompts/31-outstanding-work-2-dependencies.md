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

## Update 2026-11-18: paused for the human's ticks and one decision

Deliverable 4 is done (PR #9: every role runs a `*-5-5` model, pinned in
`.ai/tests/test_telemetry.py`; backlog item 11 deleted). ADR 0026 lines
38–40 still call the switch pending: `docs lint` refuses edits to a merged
decision, so correcting it needs a superseding ADR, if the human wants one.
Every pending major was probed locally, each alone from `main`'s manifest;
the results are below, so the next session reviews PRs, not reprobes.

**Open decision for the human:** a unit may not edit `package.json`
(`.ai/policy.json` `_dependency_changes`). A major whose source fix also works
on today's version lands as a unit first, then its Renovate PR goes green
alone. For one whose fix works only on the new version (`msw` 3,
`jsdom` 31's Blob internals), the docs name no route. Ask how those land:
the fix pushed onto the Renovate branch, a version-tolerant shim first, or a
spec that allows the manifest for that one unit.

## Where things stand (2026-11-18), verify, don't trust

- Dashboard issue #2: nothing ticked, no Renovate PR open.
- Dependabot: 2 open, both GHSA-g3hv-75wg-m249 (`minimatch` <11.0.1).
  #1 `frontend/`: cleared by `typescript-eslint` 8.73.0, which is inside the
  existing ranges; Renovate's 3-day age admits it from 2026-11-19 17:07 UTC,
  so `npm non-major` is the parent bump (probe: frontend audit 6 → 0).
  #4 `infra/`: `aws-cdk-lib` 2.277.0 still bundles `minimatch ^10.2.6`, which
  no override reaches; jest's `glob` 13 path also pulls 10.x. No override
  (it would not close the alert). Held until AWS ships minimatch 11, or the
  human dismisses it as tolerable risk (dev and synth time, patterns ours).
  `glob` and `deepmerge` alerts are not open (deepmerge's was withdrawn).
- `npm non-major` probe (aws-cdk-lib 2.277.0, aws-cdk 2.1148.1,
  typescript-eslint 8.73.0): build, lint, jest 409/409, synth pass; the
  templates differ only in `CDKMetadata` and the asset hashes of CDK's own
  cross-region export reader/writer handlers. No resource or IAM change.
- `claude CLI` 2.1.325: its `--help` (D2b flags) is unchecked. The auto-mode
  classifier refused running the new CLI; the human runs
  `npx --yes @anthropic-ai/claude-code@2.1.325 --help`.
- Frontend baseline alone: 212 files / 3,671 tests, 267 s. Run it alone and
  in the foreground: on this 8 GB machine Claude Code reaps background jobs
  under memory pressure, which killed three earlier runs.

| PR | Probe | Verdict |
|---|---|---|
| github-actions non-major, `ruff`, `k6` | not probed | merge on green CI |
| `npm non-major` | above | merge after the 2026-11-19 refresh |
| `claude CLI` | above | merge once both flags show |
| `actions/checkout` v7 | one `test-agent.yml` line on v5 | merge on green CI |
| `@types/node` 26 | infra all pass; frontend TS2322 at `src/test/form-data-file-names.ts:66` | unit first: type `Impl._buffer` and `bytesOf` as `Uint8Array<ArrayBuffer>` (typechecks on 22 too) |
| `eslint` 10 | infra passes; frontend `npm ci` ERESOLVE: `eslint-plugin-react-hooks` 5 peers `eslint` ≤9 | after the React unit |
| `vitest` 5 + `jsdom` 31 | 18 files / 117 tests red | unit: test-only `[popover]{display:block}` in `setupTests.ts` (works today); `Post{" "}` outside `VisuallyHidden` in `BoxScore.tsx:382` and `PlayerPage.tsx:342` (works today); Blob bytes via jsdom's `implForWrapper(...)._bytes` in `form-data-file-names.ts` (new version only) |
| `msw` 3 | all pass with `onUnhandledFrame: "error"` at `setupTests.ts:187`; msw 2 rejects that key | lands with its bump (open decision); its lockfile needs npm 11 (npm 10 crashes) |
| `date-fns` 4, `@testing-library/jest-dom` 7 | all pass | merge |
| `zustand` 5 | passes; nothing imports zustand | merge, or remove it (`build-deployment-packages.md` declares it for later) |
| `@vitejs/plugin-react` 6 | needs `vite` ^8 | tick with `vite` 8 |
| `vite` 8 (+ plugin-react 6) | `bundle-budget.test.ts`: lazy `Stats.module` 377 → 502 B; `optimizeDeps.esbuildOptions` deprecated for `rolldownOptions`, which `dev-server-config.test.ts` pins | unit; the budget is the human's call |
| `typescript` 7 | typescript-eslint refuses TS 7 (peers <6.1.0); ts-jest peers <7; `openapi-typescript` ^5; infra loses Node types without `"types": ["node"]` | hold for upstream |
| React 19 (+ react-hooks 7) | entry 175.6 KB gzip vs 153.3 KB budget; `AccountSettings.test.tsx:168` sees an extra `GET /users/me`; 16 react-hooks 7 compiler-rule errors (10 `refs`, 3 `set-state-in-effect`, 2 `globals`, 1 `immutability`) | unit, last; the budget is the human's call |
| `python` 3.15 | Lambda image exists, every wheel installs; CDK 2.275 has no `PYTHON_3_15` (2.277 does); suite run inconclusive | hold: planned work (Dockerfile, two `PYTHON_3_12`, `pyproject.toml`, ~15 workflow lines) |
| `postgres` 18 | CDK has `VER_18`; not run | hold: an RDS major upgrade (`allowMajorVersionUpgrade`, snapshot); locally also `backend/tests/conftest.py:65` |

Next free frontend id: `FRONTEND-045`. No spec is written yet.

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
4. **Model names (item 11).** Done, PR #9.
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
