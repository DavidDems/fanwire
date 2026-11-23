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

Done (PRs): model names (#9); non-majors and small majors (#11–#17, #21,
#23, #43); `FRONTEND-045` and `@types/node` 26, `jsdom` 31,
`vitest` 5, `msw` 3 (#27–#31); `FRONTEND-046` and `vite` 8, `plugin-react` 6
(#32–#36); `FRONTEND-047`, [ADR 0041](../Decisions/0041-react-19-entry-budget.md),
React 19, `eslint` 10 (#37–#41); `jest-dom` 8 (#42); `FRONTEND-048`, the
delete-focus flake (#44, #45); the `FRONTEND-049` spec and the React 19 fold
(#46); `ruff` 0.17.6 (#49), `claude CLI` (#48). Each unit's causes are in `.ai/tasks/FRONTEND-045`–`049/brief.md`.
ADR 0026 lines 38–40 still call the model switch pending; only a superseding
ADR can correct it, if the human wants one.

## Where things stand (2026-11-23, second hand-over), verify, don't trust

`main` 6060e4d. **Open, for the human:**

| PR | Verdict |
|---|---|
| #51 `FRONTEND-049` | All green. Merge. |
| Director PR, `INFRA-006` and `INFRA-007` specs | Merge; then the Director runs `INFRA-006`, then `INFRA-007`. |
| #47 `github-actions non-major` | Merge once `renovate/stability-days` is green (SHAs checked 2026-11-23). |

On the dashboard, not yet PRs:

| Item | Verdict |
|---|---|
| `npm non-major` (`typescript-eslint` parts, `aws-cdk-lib`) | Waiting on stability days. Review its synth against `main`'s. |
| `python` 3.15 | Tick after `INFRA-006` merges; merge once CI's backend-test is green on the 3.15 image. |
| `postgres` docker tag **19** | Hold. Needs `allowedVersions: "<19"` on the `postgres runtime` rule first (Director, `.github/renovate.json`; this session's edit was blocked by the auto-mode classifier, so the human makes it or approves it), then tick for 18 after `INFRA-007`. |
| `typescript` 7 | Held upstream (typescript-eslint, ts-jest, `openapi-typescript`). |

- Dependabot #4 (`infra/`, `minimatch` bundled in `aws-cdk-lib`, which no
  override reaches): upstream-blocked; or the human dismisses it.
- Frontend suite on #51: 217 files / 3,703 tests. Run suites alone and in
  the foreground: on this 8 GB machine Claude Code reaps background jobs.
- **Local backend container:** every database test errors at testcontainers'
  Reaper, on 3.12 `main` as on 3.15 (722 pass, 1,803 error, both). Setting
  `TESTCONTAINERS_RYUK_DISABLED` hangs instead. CI is the backend proof.

## Unit plan, in order

Write each spec on a Director branch, merge it, then run the unit
(`Architecture/director-sessions.md`). Next free frontend id `FRONTEND-050`, infra `INFRA-008`.

1.–3. **Done**: `FRONTEND-045`, `046`, `047` and their majors (above).
4. **`FRONTEND-049`, clean-up: #51**, green, waiting for merge. About ten
   test comments still say msw runs with `onUnhandledRequest`; outside its
   paths, left for track 5.
5. **`INFRA-006`, Python 3.15:** spec in the open Director PR. The two zip
   Lambdas to `PYTHON_3_15`. Probed: CDK 2.277 has it; the 3.15 image builds,
   `mypy` (also `--python-version 3.15`) clean, 722 non-database tests pass as
   on 3.12. Then the human ticks `python runtime`; then a Director PR moves
   mypy's `python_version`, `build-deployment.md`'s image row and
   `.ai/docs/architecture.md`'s "Python 3.12".
6. **`INFRA-007`, Postgres 18:** spec in the same PR. CDK 2.277 has no
   Postgres `VER_19` (stops at `VER_18_3`; the `VER_19_*` are Oracle), so 18,
   no question for the human. `VER_18` with `allowMajorVersionUpgrade`,
   `conftest.py` on 18. The human checks 18 is a `ValidUpgradeTarget` of the
   live minor (no AWS CLI on the Director's machine) and snapshots before
   approving the deploy. `build-deployment.md`'s compose line follows the
   Renovate PR.
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

- **`frontend/vite.config.ts` is no role's to write** (`code_agent` writes
  `frontend/src/**` only), so a change to it goes in the Director's spec PR,
  with its own proof (#46: a forced dev pre-bundle, plus a control without
  the define).
- **A unit's PR can be cut before its spec merges**: branch `agent/<ID>` from
  the spec branch. Once the spec merges (a merge commit), "Update branch"
  leaves only the unit's commits; `guard-gate` passes only after that.
- **Timing races in tests: hold, don't hope.** The post stubs have
  `hold()` (`src/test/post-menu.ts`); hold the response until the in-flight
  state renders, then release. A window that records requests must start
  after the shell's own `GET /users/me` (await the Account menu).
- **A CI red on a Renovate PR is not the bump until shown.** #43's and #45's
  reds were existing races; reproduce on the PR branch, then on `main`.

- **Probe a major before its spec**, from today's `main`, in a throwaway
  worktree (`npm install -D <pkg>@<major>`, never committed). Run the suite
  in the foreground, sharded: `npx vitest run --shard=1/3 --maxWorkers=2
  --reporter=json --outputFile=<scratch>`. The full suite in one process gets
  reaped for memory on this machine, and crashed workers inflate the count.
- **An assertion that stops at its first `expect` hides the rest.** Re-measure
  what it checks yourself (FRONTEND-046's entry split hid behind one row,
  and `ComposePage` behind the first lazy assertion).
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
