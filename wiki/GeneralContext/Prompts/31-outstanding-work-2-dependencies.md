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
(#46). Each unit's causes are in `.ai/tasks/FRONTEND-045`–`049/brief.md`.
ADR 0026 lines 38–40 still call the model switch pending; only a superseding
ADR can correct it, if the human wants one.

## Where things stand (2026-11-23, hand-over), verify, don't trust

`main` 1a9615d: React 19, eslint 10, jest-dom 8, the fold (#46). **Next: run
the `FRONTEND-049` unit** (spec and brief on `main`, `.ai/tasks/FRONTEND-049/`).
No frontend PR is open, so its start gate holds.

Open Renovate PRs, each reviewed 2026-11-23; the human merges one at a time,
"Update branch" on the next:

| PR | Verdict |
|---|---|
| #49 `ruff` 0.17.6 | **Merge** (all green, `backend-ruff` and `mypy` included). |
| #47 `github-actions non-major` | **Merge once `renovate/stability-days` is green.** SHAs checked: `codeql-action` is the `v4` tag (v4.39.4), `scorecard-action` is `v2.6.0`'s commit. |
| #48 `claude CLI` 2.1.329 | **Merge after** the human's `--help` shows `--setting-sources` and `--strict-mcp-config` (`.ai/docs/handoff.md` §10.1 D2b). |

On the dashboard, not yet PRs:

| Item | Verdict |
|---|---|
| `npm non-major` (new: `typescript-eslint` parts, `aws-cdk-lib`) | Waiting on stability days. Review its synth (`cd infra; npm run synth`, compare with `main`'s) for what CI cannot see. |
| `python` 3.15 | `INFRA-006` first. |
| `postgres` docker tag **19** | **The group now offers 19, not 18.** See unit 6. |
| `typescript` 7 | Held upstream (typescript-eslint, ts-jest, `openapi-typescript`). |

- Dependabot #4 (`infra/`, `minimatch` bundled in `aws-cdk-lib`, which no
  override reaches): upstream-blocked; or the human dismisses it.
- Frontend suite on 1a9615d: 217 files / 3,702 tests. Run suites alone and in
  the foreground: on this 8 GB machine Claude Code reaps background jobs under
  memory pressure.

## Unit plan, in order

Write each spec on a Director branch, merge it, then run the unit
(`Architecture/director-sessions.md`). Next free frontend id `FRONTEND-050`,
infra `INFRA-006`.

1.–3. **Done**: `FRONTEND-045`, `046`, `047` and their majors (above).
4. **`FRONTEND-049`, clean-up. Next.** Spec on `main` (#46), which also
   folds FRONTEND-047 and 048 into `BASE` (172,748 gzip, 554,736 raw), sets `ENTRY_JS_RAW_HARD_MAX` to 560,300 and moves
   `vite.config.ts` to `rolldownOptions.transform.define` (no role may write
   it). The unit drops msw 2's option and jsdom 25's Blob path, tightens
   `dev-server-config.test.ts`, and fixes the AccountSettings race (#45's first
   CI run: the shell's `GET /users/me` starts after the checkbox renders).
   Keep `dependencyMajor`: it is narrow.
5. **`INFRA-006`, Python 3.15:** the two `PYTHON_3_12` in `infra/lib/`;
   prove the backend suite on 3.15 (probe: wheels install; CDK 2.277 has
   `PYTHON_3_15`). Tick `python runtime` (workflows, Lambda
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
