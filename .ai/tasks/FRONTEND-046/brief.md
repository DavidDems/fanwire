# FRONTEND-046: vite 8 ready

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 2, unit 2 (`wiki/GeneralContext/Prompts/31-outstanding-work-2-dependencies.md`,
[ADR 0036](../../../wiki/GeneralContext/Decisions/0036-dependency-majors-route.md)).
`vite` 8 and `@vitejs/plugin-react` 6 (which requires vite 8) are held on the
Dependency Dashboard. This unit makes the one test that fails on them pass on both
versions. After it merges, the human ticks `vite` 8, merges its PR, then ticks
`plugin-react` 6.

## What the probe found (2026-11-20, `main` at `b6cde48`)

Both installed together. Typecheck, lint and build are clean. The full suite, alone in 3
shards: **3,678 tests, 1 failed**, `bundle-budget.test.ts` "keeps every lazy output within
its budget". The build warns that `optimizeDeps.esbuildOptions` is deprecated for
`rolldownOptions`. That's a warning only, and FRONTEND-048 handles it.

The failing assertion reports only `Stats.module` (377 → 502 B), but it stops at its first
`expect`. Behind it, Rolldown splits the old entry into the entry chunk plus six chunks
`index.html` preloads:

| Chunk | gzip | |
|---|---|---|
| `index` (entry) | 103,505 | |
| `chunk-6KYCQHYJ` | 30,137 | a hash-like name: do not budget it by name |
| `client` | 10,194 | |
| `jsx-runtime` | 3,246 | |
| `InlineAlert` | 1,376 | |
| `useBaseQuery` | 545 | |
| `useQuery` | 128 | |
| **sum** | **149,131** (raw 474,368) | BASE entry: 151,669 gzip, 477,274 raw |

Measured by the isEntry chunk alone, the entry would "shrink" by 48 kB, and those six
chunks would count as new lazy outputs. So the budget must measure the entry as the
entry chunk plus its static-import closure. On vite 7 nothing is split off the entry, so
the numbers don't change.

**Correction (2026-11-20, on running the unit).** The paragraph this replaces said every
other moved output shrinks under an unfolded unit file's ceiling. One does not: the
failing test stops at its first `expect`, so the probe never saw `ComposePage` at 3,745
against `FRONTEND-040`'s 3,700. Five merged units' files (`FRONTEND-037`, `040`, `043`,
`044`, `USERS-008`) had never been folded, so the Director PR that corrects this spec folds
them into `BASE` on `main` 85e3527 (vite 7) and deletes them. Against that base, vite 8
(8.3.8 with plugin-react 6.3.0) moves three things past tolerance:

| Output | vite 7 (BASE) | vite 8 | Declared |
|---|---|---|---|
| `ComposePage` | 3,642 | 3,745 | changed, 3,900 |
| `StatsNav.module` | 655 | 504 | changed, 700 (a shrink; undeclared outputs are held to ±100 B) |
| entry CSS | 7,031 | 7,066 + 275 (`InlineAlert.css`) | `entryCssGzipGrowth` 400 |

`Stats.module` (454 → 502) is now within tolerance and is not declared. Several outputs
grow by 79 to 96 B on vite 8 (`ProfileSetupPage` +96, `ForgotPasswordPage` +87,
`NotificationsPage` +85, `SignUpPage` +82): inside tolerance, but if Renovate's vite 8
patch differs, rerun the probe before blaming the bump. The vite 8 entry closure is
149,210 gzip and 474,565 raw on 85e3527.

## Traps

- Rollup's `OutputChunk.imports` is static imports only; `dynamicImports` are the lazy
  edges. `isDynamicEntry` chunks are lazy even when something also imports them
  statically, so follow the closure from the entry rather than filtering by flag.
- The test's build inlines `test.env`, so measure with the test's build, not `npm run
  build`. It differs by about 0.2 kB raw.
- Everything this unit writes is under `src/test/`, which the guard gives the test role.
  The red test commit and the implementation commit are both test-role commits; run
  `guard check --role test_agent` on each.
- Run suites alone and in the foreground; shard the new-version run (`--shard=1/3
  --maxWorkers=2`) on the 8 GB machine.
