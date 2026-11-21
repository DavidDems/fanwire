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

## Update 2026-11-20: decided, now the units

The human chose the route ([ADR 0036](../Decisions/0036-dependency-majors-route.md)):
dual-version `hand` units, each proven on a local merged preview with the new
versions, then its Renovate pull request merges unchanged; a follow-up unit
in this track removes old-version support. vite 8's and React 19's growth are
declared budgets (React trims first). Python 3.15 and Postgres 18 are done
here, last. Nobody edits `package.json` by hand to land a major.

Done: model names (PR #9); github-actions non-major, `ruff`, `k6`,
`actions/checkout` v7, `date-fns` 4, `jest-dom` 7, `zustand` 5 (#11–#17,
deployed). 2026-11-20: `npm non-major` (#21, after #23 gave Renovate
`allow-remote=all` for npm 12's `EALLOWREMOTE` on `aws-cdk-lib`'s bundled
tarball), a short-hash test flake (#25), **unit 1 `FRONTEND-045`** (#27), then
its four majors `@types/node` 26, `jsdom` 31, `vitest` 5, `msw` 3 (#28–#31,
deploy running at hand-over). **Unit 2's spec `FRONTEND-046`** is a Director PR
on `director/frontend-046-spec`; once it merges, run the unit. ADR 0026 lines 38–40 still call the model switch pending; only a
superseding ADR can correct it, if the human wants one.

## Where things stand (2026-11-20), verify, don't trust

- Dashboard issue #2: `npm non-major` ticked (it carries `typescript-eslint`
  8.73.0, which closes Dependabot #1; probe: no resource or IAM change, the
  templates differ only in `CDKMetadata` and CDK's own handler hashes).
  `claude CLI` now offers 2.1.326: the human runs its `--help` for both D2b
  flags before ticking. Every major is unticked.
- Dependabot #4 (`infra/`, `minimatch` bundled in `aws-cdk-lib`, which no
  override reaches): upstream-blocked; or the human dismisses it.
- Frontend baseline alone: 212 files / 3,671 tests, 267 s. Run suites alone
  and in the foreground: on this 8 GB machine Claude Code reaps background
  jobs under memory pressure.

Rows 1–3 of the table below are done (`FRONTEND-045`; its brief has the
corrected causes). `vite` 8 + `plugin-react` 6 re-probed on `b6cde48`: one
test red, the bundle budget, because Rolldown splits the entry into preloaded
chunks (`.ai/tasks/FRONTEND-046/brief.md`).

Probe findings (each major alone from `main`; file and line on 2026-11-18):

| Major | Needs |
|---|---|
| `@types/node` 26 | `src/test/form-data-file-names.ts`: `Impl._buffer` and `bytesOf` as `Uint8Array<ArrayBuffer>` (fine on 22 too). infra passes. |
| `vitest` 5 + `jsdom` 31 | 117 tests red: a test-only `[popover]{display:block}` in `setupTests.ts`; `Post{" "}` outside `VisuallyHidden` at `BoxScore.tsx:382`, `PlayerPage.tsx:342`; Blob bytes via jsdom's `implForWrapper(blob)._bytes`, the old symbol `_buffer` kept for 25. |
| `msw` 3 | `setupTests.ts:187` `onUnhandledFrame: "error"`; msw 2 knows only `onUnhandledRequest`. Its lockfile needs npm 11. |
| `vite` 8, then `plugin-react` 6 | lazy `Stats.module` 377 → 502 B; `optimizeDeps.esbuildOptions` deprecated for `rolldownOptions` (pinned by `dev-server-config.test.ts`). plugin-react 6 requires vite 8. |
| React 19 (+ react-hooks 7) | entry 175.6 KB gzip vs 153.3 KB; `AccountSettings.test.tsx:168` sees an extra `GET /users/me`; 16 react-hooks 7 errors (10 `refs`, 3 `set-state-in-effect`, 2 `globals`, 1 `immutability`). |
| `eslint` 10 | after React (react-hooks 5 peers eslint ≤9); infra passes. |
| `typescript` 7 | held: typescript-eslint, ts-jest, `openapi-typescript` refuse it. |
| `python` 3.15 | wheels install; CDK 2.277 has `PYTHON_3_15`; suite unproven. |
| `postgres` 18 | CDK has `VER_18`; not run. |

## Unit plan, in order

Write each spec on a Director branch, merge it, then run the unit
(`Architecture/director-sessions.md`). Next free frontend id `FRONTEND-045`,
infra `INFRA-006`.

1. **Done (#27–#31).** `FRONTEND-045`, test harness on both versions: the `@types/node`,
   `jsdom` and `msw` rows above, each written to work on today's and the new
   version. Then tick `@types/node` 26, `vitest` 5, `jsdom` 31, `msw` 3.
2. **`FRONTEND-046`, vite 8 ready** (spec #32, corrected by the fold PR on
   `director/frontend-046-fold`): the budget measures the entry with its
   static imports, and declares `ComposePage`, `StatsNav.module` and the
   entry CSS against the folded base. The unit is built on `agent/FRONTEND-046`
   (local, rebased onto the fold) and pushed once the fold merges. Tick
   `vite` 8, merge, then tick `plugin-react` 6.
3. **`FRONTEND-047`, React 19 ready:** the 16 rule sites, the extra request,
   trim, then declare the entry budget. Tick React, then `eslint` 10.
4. **`FRONTEND-048`, clean-up:** drop msw 2's option, jsdom 25's Blob path
   and `esbuildOptions` for `rolldownOptions`.
5. **`INFRA-006`, Python 3.15:** the two `PYTHON_3_12` in `infra/lib/`;
   prove the backend suite on 3.15. Tick `python runtime` (workflows, Lambda
   image). mypy's `python_version` in `backend/pyproject.toml` is a manifest,
   so a Director edit (`requires-python >=3.12` already admits 3.15).
6. **`INFRA-007`, Postgres 18:** `VER_18` with `allowMajorVersionUpgrade`, and
   `backend/tests/conftest.py:65`. The human snapshots RDS before approving
   the deploy. Tick `postgres runtime`.
7. **Close-out** (deliverable 5).

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

- **Probe a major before its spec**, from today's `main`, in a throwaway
  worktree (`npm install -D <pkg>@<major>`, never committed). Run the suite
  in the foreground, sharded: `npx vitest run --shard=1/3 --maxWorkers=2
  --reporter=json --outputFile=<scratch>`. The full suite in one process gets
  reaped for memory on this machine, and crashed workers inflate the count.
- **An assertion that stops at its first `expect` hides the rest.** Re-measure
  what it checks yourself (FRONTEND-046's entry split hid behind one row,
  and `ComposePage` behind the first lazy assertion).
- **Fold merged units' budget files into `BASE` before measuring a major
  against it** (`bundle-budget.ts`): an unfolded file's ceiling is a
  vite 7 measurement, and only the base can be re-measured.
- **`src/test/**` is the test role's**, so a harness-only unit's
  implementation commits are test-role commits; guard-check each by role.
- **A unit's spec PR, then its `agent/<ID>` PR, then the human ticks the
  majors.** Each Renovate PR is reviewed for what CI cannot see and merged
  one at a time: they share the lockfile, Renovate rebases the next.

- A bump that CI passes can still break the deploy: read the `cdk diff` step
  after the merge, and the human approves the deploy only after that.
- Renovate pull requests opened by a bot keep `action_required`; the human
  approves their runs.
- Frontend suites flake when run beside the backend and infra suites: rerun
  alone before blaming the bump.
