---
type: runbook
---

# GitHub automation setup: Renovate

Part of [GitHub automation setup](github-automation-setup.md).

## 7. Renovate

The Mend Renovate app is installed on this repository, on Mend's free plan.
Its configuration is `.github/renovate.json`, and
`TestRenovateNeverMergesAnything` in `.ai/tests/test_workflows.py` holds its
safety properties. Mend's repository setting "Dependency Updates (Renovate)"
must be **Interactive**: Silent mode scans and opens nothing (step 8 below).

**What it does.** Weekly, before 6am Monday Toronto time, it opens pull
requests updating dependencies:

| PR | Covers |
|---|---|
| `github-actions non-major` | Every action. They are pinned to a full SHA with a `# vN` comment; Renovate moves the SHA and the comment together (`helpers:pinGitHubActionDigests`). |
| `npm non-major` | `frontend/` and `infra/`. |
| `pip non-major` | `backend/pyproject.toml`, exact pins (ruff, mypy) included. |
| `docker non-major` | The base images in `docker/*.Dockerfile` and `docker-compose.yml`. |
| `claude CLI` | `providers.anthropic.cli_version` in `.ai/config.json`, via a custom regex manager. Labelled `recheck-d2b-flags`: before approving, confirm the new CLI still accepts `--setting-sources user --strict-mcp-config` (`.ai/docs/handoff.md` §10.1 D2b). The PR body says how. |
| one per package | Every major update, **only once you tick it in the Dashboard** (`dependencyDashboardApproval`). Majors are never grouped: a PR carrying several majors is unreviewable. (Renovate's monorepo preset still keeps one monorepo's packages together, e.g. `@vitest/*`.) |
| `python runtime`, `node runtime`, `postgres runtime` | The language and database versions, **only once you tick them**, each its own PR, never inside a non-major group. They follow what AWS runs, which Renovate cannot see: Python moves with `lambda.Runtime.PYTHON_3_12` in `infra/lib/app-stack.ts`, Postgres with `PostgresEngineVersion.VER_16` in `infra/lib/data-stack.ts`. Edit those in the same PR. |

Nothing is proposed until a release is **3 days old**, and `internalChecksFilter:
strict` means the branch is not even created before then, so a compromised
release pulled within days never reaches a PR. At most 5 PRs are open at once,
each labelled `dependencies`. The **Dependency Dashboard** issue lists what is
pending, waiting out its age, or blocked.

`pip non-major` rarely has anything to do: `backend/pyproject.toml` states
`>=` ranges, which every release already satisfies, and only ruff and mypy
are exact. **`director-review` skips Renovate's PRs** by design, even the
`claude CLI` one that edits `.ai/`: its `if:` excludes bot authors, because
the human's own approval is the review (below).

**No automerge, ever** (`.ai/docs/philosophy.md` §8). `automerge` and
`platformAutomerge` are both `false`, and the test fails if any
`automerge`-like key is turned on anywhere, or a preset brings one in. A
dependency bump is code from outside the repository; a human reads every one.

**You can approve these PRs for real.** They are authored by `renovate[bot]`, a
different actor from you, so your review satisfies the 1-approval rule of
`github-automation-setup-ruleset.md` §3 the way it does for agent PRs, rather
than waiving it through the admin bypass the way your own Director PRs merge.
Use a normal approval.

**`agent-guard` skips them, correctly.** Their branches are `renovate/*`
(`branchPrefix` is stated explicitly), and `agent-guard` acts only on `agent/*`,
so `guard` is skipped and `guard-gate` passes. Renovate is not a worker and has
no task spec to be checked against; the test fails if the prefix ever starts
with `agent/`. `gate` (the test suites) still runs and is still required.

### Installing it (human)

1. Merge the PR that adds `.github/renovate.json` first. Renovate looks for a
   config on the default branch; finding one, it treats the repository as
   already onboarded and opens no onboarding PR.
2. Open <https://github.com/apps/renovate> and click **Install** (or
   **Configure** if the Mend Renovate app is already on the account).
3. Choose the account `DavidDems`, then **Only select repositories** →
   `DavidDems/fanwire`. Not "All repositories". Approve the permissions it
   asks for; it needs workflow write access because the action pins live in
   `.github/workflows/`.
4. If it lands you on Mend's developer-portal sign-up, sign in with GitHub and
   accept; the free tier is enough.
5. If a **"Configure Renovate"** onboarding PR appears anyway (the app was
   installed before step 1 merged), close it without merging: its
   `renovate.json` would compete with ours. Renovate reads
   `.github/renovate.json` on `main` from its next run.
6. Within about an hour, check the **Issues** tab for **"Dependency
   Dashboard"**. Its existence proves the app is running. Update PRs follow in
   the next Monday-morning window; ticking a box in the dashboard requests one
   immediately.
7. If a Renovate PR shows no checks, look in the Actions tab for a run waiting
   on approval and approve it as in `github-automation-setup-actions.md` §4.
8. If no Dashboard appears, the app is installed but Mend is not running it.
   Sign in at <https://developer.mend.io> with GitHub, open `DavidDems` →
   `fanwire`. Its settings must have Renovate **enabled** for the repository
   and the mode **Interactive** (Silent mode scans but opens nothing). Then
   use **Run Renovate scan** and read that job's log: a config error or a
   missing permission is named there.

**To decline or remove it:** <https://github.com/settings/installations> →
**Mend Renovate** → **Configure** → **Uninstall** (or drop `fanwire` from its
repository list), then delete `.github/renovate.json` and its test in a Director
PR. The fallback is `.github/dependabot.yml`, one entry per ecosystem
(`github-actions`, `npm` for `frontend/` and `infra/`, `pip` for `backend/`,
`docker`), each weekly with a `groups:` block and a `cooldown` of 3 days, and a
modest `open-pull-requests-limit`. Dependabot also keeps SHA pins current, but
it has no equivalent of the regex manager on `.ai/config.json`: the CLI pin
would go back to being bumped by hand.
