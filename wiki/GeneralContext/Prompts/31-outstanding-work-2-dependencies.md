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
deployed); `npm non-major` (#21, #23 `allow-remote=all`), a test flake
(#25). **Units 1–3 are done:**
`FRONTEND-045` (#27) and its four majors (#28–#31); `FRONTEND-046` (#32, #33
the fold, #34) and `vite` 8, `plugin-react` 6 (#35, #36); `FRONTEND-047`
(#37 spec with [ADR 0041](../Decisions/0041-react-19-entry-budget.md), #38).
2026-11-22: React 19 (#40), `eslint` 10 (#41), `jest-dom` 8 (#42; probe: no
change needed, 3,698 tests green). `FRONTEND-048` fixes the delete-focus flake
(below) before `npm non-major` (#43) merges.
ADR 0026 lines 38–40 still call the model switch pending; only a superseding
ADR can correct it, if the human wants one.

## Where things stand (2026-11-21, hand-over), verify, don't trust

`main` 6939ae2 still runs React 18 and eslint 9; FRONTEND-047 made the code
pass on React 19, react-hooks 7 and eslint 10 (proof in #38). Dependency
Dashboard issue #2, unticked:

| Item | Verdict |
|---|---|
| `npm non-major` (`@tanstack/react-query`, `msw`, `react-router-dom`, `vitest`) | #43: CI's one red is the delete-focus flake, not the bump. Rerun and merge, after `FRONTEND-048` if it lands first. |
| `github-actions non-major` (`codeql-action`, `scorecard-action`), `ruff` 0.17.6 | Merge; read the diff for what CI cannot see. |
| `claude CLI` 2.1.327 | The human runs its `--help` for both D2b flags (`.ai/docs/handoff.md` §10.1) before ticking. |
| `python` 3.15 | `INFRA-006` first. |
| `postgres` docker tag **19** | **The group now offers 19, not 18.** See unit 6. |
| `typescript` 7 | Held upstream (typescript-eslint, ts-jest, `openapi-typescript`). |

- Dependabot #4 (`infra/`, `minimatch` bundled in `aws-cdk-lib`, which no
  override reaches): upstream-blocked; or the human dismisses it.
- Frontend suite on 6939ae2: 217 files / 3,698 tests. Run suites alone and in
  the foreground: on this 8 GB machine Claude Code reaps background jobs under
  memory pressure.

Probe findings still open (each major alone from `main`); the done rows'
causes are in `.ai/tasks/FRONTEND-045`–`047/brief.md`:

| Major | Needs |
|---|---|
| `typescript` 7 | held: typescript-eslint, ts-jest, `openapi-typescript` refuse it. |
| `python` 3.15 | wheels install; CDK 2.277 has `PYTHON_3_15`; suite unproven. |
| `postgres` 18/19 | CDK has `VER_18`; 19 unchecked; not run. |

## Unit plan, in order

Write each spec on a Director branch, merge it, then run the unit
(`Architecture/director-sessions.md`). Next free frontend id `FRONTEND-049`,
infra `INFRA-006`.

1. **Done (#27–#31).** `FRONTEND-045`, test harness on both versions: the `@types/node`,
   `jsdom` and `msw` rows above, each written to work on today's and the new
   version. Then tick `@types/node` 26, `vitest` 5, `jsdom` 31, `msw` 3.
2. **Done (#32–#36).** `FRONTEND-046`, vite 8 ready: the budget measures the
   entry with its static imports; #33 folded five merged units; `vite` 8 and
   `plugin-react` 6 merged.
3. **Done (#37, #38).** `FRONTEND-047`, React 19 ready: the 16 react-hooks 7
   sites fixed on both versions, `combine`'s `dependencyMajor` exception, React
   19's entry declared (+25,000 gzip, +85,000 raw). No trim: a lazy `/search`
   made the entry larger. React and `eslint` 10 merged (#40, #41).
4. **`FRONTEND-049`, clean-up**, once React and eslint 10 are on `main`. Its
   spec PR (Director) first **folds FRONTEND-047**: measure `main` with the
   probe below, write React 19's numbers into `BASE`, set
   `ENTRY_JS_RAW_HARD_MAX` to the measured entry raw plus about 1% (ADR 0041;
   about 559.7 kB), delete `bundle-budgets/FRONTEND-047.ts`. The unit then
   drops msw 2's option (`setupTests.ts`, `onUnhandledRequest`), jsdom 25's
   Blob path (`src/test/form-data-file-names.ts`, the `_buffer` symbol) and
   moves `optimizeDeps.esbuildOptions` to `rolldownOptions` (`vite.config.ts`,
   pinned by `dev-server-config.test.ts`). Keep `dependencyMajor`: it is narrow.
5. **`INFRA-006`, Python 3.15:** the two `PYTHON_3_12` in `infra/lib/`;
   prove the backend suite on 3.15. Tick `python runtime` (workflows, Lambda
   image). mypy's `python_version` in `backend/pyproject.toml` is a manifest,
   so a Director edit (`requires-python >=3.12` already admits 3.15).
6. **`INFRA-007`, Postgres:** ADR 0036 says 18; Renovate now offers the
   docker tag 19. Probe first: does `aws-cdk-lib` have `PostgresEngineVersion`
   `VER_19`, and does RDS offer 19 in the stack's region? If both, ask the
   human 18 or 19 (`AskUserQuestion`); if not, do 18 and hold the docker tag
   at 18 (a `renovate.json` rule, Director). Then `allowMajorVersionUpgrade`,
   `backend/tests/conftest.py:65`, and the human snapshots RDS before
   approving the deploy, then runs the Migration Lambda if asked.
7. **Close-out** (deliverable 5).

## Deliverables

1. **The alerts:** done but Dependabot #4 (above).
2. **Non-majors:** the human ticks each; you review each PR for what CI
   cannot see (the synthesized stack for `aws-cdk` and `aws-cdk-lib`; never
   a CLI bump without `.ai/docs/handoff.md` §10.1 D2b).
3. **Majors, one per PR**, by the unit plan. One that needs source changes is
   a `hand` unit with a spec.
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
- **React 19's entry growth** (+23.4 kB gzip, +79.5 kB raw, all
  `react-dom`) is past R1's 480 kB raw cap and R13's 1 kB per unit; the human
  chose to raise the cap for a declared dependency major
  ([ADR 0041](../Decisions/0041-react-19-entry-budget.md)), not to trim 75 kB
  or hold React. FRONTEND-049's spec folds FRONTEND-047 and sets
  `ENTRY_JS_RAW_HARD_MAX` to the measured entry plus about 1%.
- **`docker compose run --rm frontend-test` reuses a built image**: it
  tests whatever was copied at the last build. Run `docker compose build
  frontend-test` first (check the file count moved). FRONTEND-047's first
  container run tested stale code.
- **Measure the bundle with a scratch probe**, not the budget test (it stops
  at its first failing assertion): a vitest file under `src/test/` that runs
  `build()` exactly as `bundle-budget.test.ts` does, takes
  `entryClosure(entry, chunks)`, and writes each closure chunk's and lazy
  output's gzip and raw size to a file (vitest swallows `console.log`).
  Delete it before committing. `chunk.modules[id].renderedLength` gives a
  per-package breakdown.
- **CI flake, fixed by `FRONTEND-048`:** `features/feed/delete-focus.test.tsx`
  "a failed delete keeps the confirm open" (#38, #43) was a real defect: the
  disabled-while-pending action drops focus to `<body>`, and nothing restored it
  after a failure. It showed only when the pending render beat the 403. Hold
  the response with the stub's gate to make such a race deterministic.
- **Pin a refactor's behaviour on today's code, then mutate:** put the old
  production files back, check the new tests pass, then remove the guarded
  line and check they fail (FRONTEND-047 did this for two of its pins).
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
