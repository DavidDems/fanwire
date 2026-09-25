# fanwire — frontend build handoff

**You are picking up a frontend build pass that is one unit in.** This file is
your brief. Read it fully before touching anything; it is short, and most of it
is things that already went wrong once.

Written 2026-09-25, at the end of the session that specified the pass and
completed `FRONTEND-001`.

---

## 1. What you are, and what you are not

You are the **Director**, running a human-supervised session. You read the task
spec, delegate the work to subagents, review what comes back, and commit it
yourself. The human is present and merges every PR.

**You are not the `.ai/` orchestrator, and you must not start it for these
tasks.** `.github/workflows/agent-orchestrator.yml` would run the same specs by
dispatching workers that call the Anthropic API with a repository secret. That
bills metered credits; a Claude subscription does not cover it. The human's
explicit decision is that the first pass of frontend code is done this way
instead. See `TODO/04-first-deploy.md` §5.

That decision is under review *after* this pass, not during it. If the human
raises switching to the pipeline mid-pass, point them at §7 below.

## 2. Where things stand

`FRONTEND-001` is **merged** (PR #48): the foundation, typed API client,
configuration module, router shell and msw harness. `0x08-frontend.md` records
what it delivered and the contracts it pinned.

**Six units remain**, specified and validated, in `.ai/tasks/`:

```
FRONTEND-002  auth: AuthService, Cognito, route guard, profile creation
     │
     ├── FRONTEND-003  profile + follow          ┐ independent
     └── FRONTEND-004  compose                   ┘ of each other
                          │
                    FRONTEND-005  feed + threads
                          │
                          ├── FRONTEND-006  notifications
                          └── FRONTEND-007  search
```

`INFRA-002`, `INFRA-003` and `MEDIA-002` are unrelated to the frontend critical
path and can be done at any time by anyone.

**Do `FRONTEND-002` next.** Everything except the guest feed needs a real token,
so nothing after it can be browser-verified until it lands.

## 3. The loop that worked

Per unit. Do not compress it — the ordering is enforced by CI, and the review
steps are where every defect so far was caught.

1. **Cut the branch from `origin/main` explicitly.**

   ```powershell
   git switch -c agent/FRONTEND-00N origin/main
   ```

   `git switch -c <name>` alone branches from whatever HEAD is, and in a session
   that has been inspecting other branches that is not `main`. Bug 17 is what
   that looks like.

   Use the real `agent/` prefix. It makes `agent-guard.yml` actually run the
   permission check against your diff instead of skipping — free verification
   that the spec's `allowed_paths` are sufficient, which is how the first defect
   below was caught. The missing `state.json` is handled: the workflow prints
   "no state file; treating as a hand-authored branch".

2. **Delegate the tests to a subagent.** Give it the acceptance criteria, the
   exact list of files it may write, and the traps. Tell it explicitly: tests
   only, no implementation, no placeholder modules to make an import resolve, no
   skips, and do not commit.

3. **Review, verify the red yourself, commit the tests alone.** The red must be
   red for the right reason. Distinguish "red because the thing under test does
   not exist" from "red because the test file is broken" — only the first is a
   baseline. Commit message: `FRONTEND-00N test: <what it pins>`.

4. **Delegate the implementation to a second subagent.** Its contract is the
   committed tests. Tell it plainly it may not modify, delete, rename or weaken
   a test file — `allow_test_edits_during_impl` is false for every one of these
   specs, and a diff containing a test change is discarded wholesale.

5. **Review, run every gate yourself, commit the implementation separately.**

6. **Update `wiki/CodeContext/Modules/0x08-frontend.md`** in the same pass if the
   unit changed a documented decision. It is in every spec's `allowed_paths` for
   this reason.

7. **Push, open the PR, wait for checks, hand to the human.** Nothing self-merges
   and nothing in this repo has merge permission. Keep it that way.

### Verify with all of these, not a subset

```powershell
cd frontend; npm test; npm run typecheck; npm run lint; npm run build
docker compose run --rm backend-test          # then: docker compose down
python -m pytest .ai -q; python .ai/bin/agentctl.py selfcheck
```

**A local pass is a hint; the container is the result.** One defect below was
invisible to `npm test` and `pytest` locally and only appeared in the container.

⚠️ `docker compose run` reuses a tagged image if one exists. A stale image from
an earlier branch will run the *wrong code* and report failures that are not
yours. Rebuild explicitly when the branch changed:

```powershell
docker build -q -f docker/backend.Dockerfile --target test -t fanwire-backend-test:latest .
```

This bit me once and I briefly reported three failures that were my own tooling.

## 4. Verify what subagents tell you

A subagent's report is evidence, not a result. Every load-bearing claim gets
checked by you, against the thing itself:

- Run the guard yourself over the real diff (see §5) rather than trusting "guard
  check passed".
- Run every gate yourself rather than pasting the agent's output.
- `git status` before committing — confirm no test file moved in an
  implementation pass.

This is not distrust as a posture; it is that the subagents have been *right*
about their own work and wrong about the environment around it. Both defects in
§5 came from a subagent flagging something, and both needed independent
confirmation before they were actionable.

Equally: **take their objections seriously.** Both real bugs this pass surfaced
were raised by a subagent saying "I cannot do this and here is why", and both
were correct. An agent reporting that `allowed_paths` is too narrow is doing the
thing bug 16 exists to teach.

## 5. What has actually gone wrong, and where to look next

Three defects, all found in one unit, all in the same place: **the artifacts the
tested core consumes.** None was in application code. Each would have escalated
a live dispatched run after the model had been paid for, and each was outside
the permitted paths of the agent that hit it — so no agent could have fixed it.

| | Defect | Fixed in |
|---|---|---|
| 1 | `test_agent.deny` held `frontend/src/**/*.tsx`, and `deny` is checked **before** `write` — so the test agent was denied its own component tests. Every `FRONTEND-*` task would have escalated on its first commit | #46 |
| 2 | `backend/openapi.json` is compared byte-for-byte, but nothing pinned its line endings. `core.autocrlf=true` on Windows checked it out as CRLF against an LF export: 2429 carriage returns, drift gate red on a clean clone | #47 |
| 3 | `docker/backend.Dockerfile`'s `test` stage copied neither `scripts/` nor the committed schema, so that suite passed locally and failed in CI reporting a missing file rather than the missing `COPY` | #47 |

`handoff.md` §4 already says this is where this system breaks. It was right.

**So before starting each unit, ask what that unit's tests will need that is not
application code**, and check it exists: a fixture, a file the image must carry,
a line-ending guarantee, a permission. Cheaper than finding out from CI.

Run the guard yourself over a real diff like this:

```python
import sys, json
sys.path.insert(0, ".ai")
from agentlib import guard, spec
s = spec.load(".ai/tasks/FRONTEND-002")
p = json.load(open(".ai/policy.json", encoding="utf-8"))
paths = [l.strip() for l in open("changed.txt") if l.strip()]
r = guard.check_diff(paths, "code_agent", s, p)   # or "test_agent"
print(r.ok, guard.format_violations(r.violations))
```

## 6. Things that will cost you a pass if you do not know them

- **No agent may write `.ai/`, `.github/`, `wiki/GeneralContext/`, `AGENTS.md`
  or the git dotfiles** — `guard.ALWAYS_FORBIDDEN`, not overridable by any spec.
  A task spec naming one fails validation.
- **The code agent may not write `frontend/package.json`, `docker/**`,
  `docker-compose.yml`, `*/pyproject.toml` or any test file.** Dependency and
  build changes are Director calls.
- **A Director fix cannot ride on an `agent/*` branch.** `agent-guard` rejects
  always-forbidden paths there, and the scope check rejects anything outside the
  task's `allowed_paths`. Both #46 and #47 needed their own branch off `main`,
  merged first. Expect to do this again; it is the correct shape, not friction.
- **Never `git stash`.** The stash stack is shared across worktrees and sessions.
  `git worktree add --detach` or `git show <rev>:<path>`.
- **`frontend/.env.local` is untracked** and holds all five `VITE_*` values.
  `config.ts` throws at module load on any missing one — deliberately. Tests stub
  with `vi.stubEnv`; `npm run dev` and `npm run build` need the real file.
- **`vitest` runs with `globals: false`.** Import `describe`/`it`/`expect`/`vi`
  from `vitest`, and remember Testing Library registers no auto-cleanup.
- The pre-commit hook is **blocking on lint, advisory on tests** — precisely so
  the red test commit can land. If it complains about formatting, run
  `backend/.venv/Scripts/ruff.exe format <files>`.

## 7. The contracts `FRONTEND-001` pinned

Six units inherit these. They are pinned by tests, so changing one means
changing its test deliberately — which is a Director decision, not a
convenience:

- **Routes**: `/`, `/compose`, `/notifications`, `/search`, `/profile/:userId`,
  `/sign-in`, `/sign-up`, `/confirm`, `/forgot-password`, `*`.
- **Client**: `createApiClient(provider)`, the `apiClient` singleton, and
  `setTokenProvider(provider)`. The singleton reads the current provider through
  a closure — **this is the seam `FRONTEND-002` uses** to install the real
  Cognito token getter after module load.
- **No `Authorization` header at all** when the provider returns null, never an
  empty one.
- **`config.ts`** exports one `config` object and is the only reader of
  `import.meta.env`, enforced by a test that walks the source tree.
- **The base URL resolves against `window.location.origin`.** `/api` handed
  straight to `createClient` throws `Invalid URL` under vitest.
- **Views live in one file** (`src/routes/views.tsx`). Each unit lifts its own
  out; that is why they are not already separate.

## 8. Still owed by the Director, and not by any agent

From `TODO/04-first-deploy.md` §2 — check before the unit that needs each:

- [ ] **The OpenAPI drift gate** in `.github/workflows/test-agent.yml`: a job
      that regenerates `backend/openapi.json` and fails on any diff, added to
      `gate`'s `needs:`. The file now exists, so this is unblocked and should be
      done soon — without it a backend route change silently breaks the
      generated client. Add its structural assertion to
      `.ai/tests/test_workflows.py` in the same commit, per `handoff.md` §4.
- [ ] `docker/frontend.Dockerfile`: thread the `VITE_*` values into the `build`
      stage as build args. Needed for the deploy, not for any unit.
- [ ] `docker/backend.Dockerfile` `lambda` target: copy `alembic/` and
      `alembic.ini`. **`INFRA-003` is unsatisfiable until this lands.**
- [ ] Confirm no new frontend dependency is needed. Everything the six units
      call for is already in `package.json`, which the code agent cannot write.

## 9. When this pass is done

`TODO/04-first-deploy.md` is the sequencing document for everything between here
and `https://fanwire.daviddems.com`. §3 is the task graph, §4 is the three-phase
deploy and why it has to be three phases.

The human's stated plan is to adopt the `.ai/` pipeline for ordinary work after
this first pass, when changes are smaller. That is a reasonable read. One
caveat worth giving them: **`FRONTEND-001` is the worst possible unit to
generalise from** — it bootstrapped two generators and had no existing code to
lean on. `FRONTEND-006` or `INFRA-003` is a fairer test of what a dispatched run
costs and how well a spec survives with no human in the loop.

And the three defects above are an argument for one thing specifically: the
pipeline is sound, but the scaffolding around it still has holes that only
appear when something actually runs. Each unit run locally is also a cheap audit
of that scaffolding.
