# fanwire — frontend build handoff

**You are picking up a frontend build pass that is two units in.** This file is
your brief. Read it fully before touching anything; it is short, and most of it
is things that already went wrong once.

Written 2026-09-25 at the end of the session that specified the pass and
completed `FRONTEND-001`; revised 2026-09-28 at the end of the session that
completed `FRONTEND-002`.

---

## 1. What you are, and what you are not

You are the **Director**, running a human-supervised session. You read the task
spec, delegate the work to subagents, review what comes back, and commit it
yourself. The human is present and merges every PR.

That tier is now defined in `AGENTS.md`, and it is decided by the branch your
work lands on, not by this file telling you so. A Director has **no path
restrictions** — `.ai/`, `.github/`, `wiki/GeneralContext/` and `AGENTS.md`
included — because a tier that cannot edit the agent system cannot repair it,
and every defect in §5 lived in exactly those trees. What bounds you is that
you work on an ordinary human-named branch where one code-owner review is the
only control, so **say plainly in the PR body when you have edited one of
those trees**. A diff going to a branch named `agent/*` is a worker's diff
whatever the prompt says, and `agent-guard` will hold it to the spec.

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
configuration module, router shell and msw harness.

`FRONTEND-002` is **merged** (PR #57): `AuthService` and its one Cognito
implementation, the session context, the five auth pages, the route guards and
the token wiring. `0x08-frontend.md` records what both delivered and the
contracts they pinned — read its **Auth** and **Test harness facts** sections
before writing a line.

**Five units remain**, specified and validated, in `.ai/tasks/`:

```
FRONTEND-003  profile + follow          ┐ independent of each other,
FRONTEND-004  compose                   ┘ both unblocked now
                     │
               FRONTEND-005  feed + threads
                     │
                     ├── FRONTEND-006  notifications
                     └── FRONTEND-007  search
```

`INFRA-002`, `INFRA-003` and `MEDIA-002` are unrelated to the frontend critical
path and can be done at any time by anyone. `INFRA-003` was blocked on the
Lambda image carrying `alembic/`; that landed in #54, so it is ready.

**Do `FRONTEND-003` and `FRONTEND-004` next.** They are genuinely independent
and can run in parallel — but both specs claim `frontend/src/routes/**`,
`frontend/src/components/**`, `frontend/src/test/**` and `0x08-frontend.md`, so
two branches will collide in `routes.tsx`, `views.tsx` and the wiki file. Land
one, rebase the other onto it. Neither is blocked on a browser pass of
`FRONTEND-002`, but see §8 — that pass is still owed.

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

Six defects across two units, every one in the same place: **the artifacts and
scaffolding the tested core consumes.** Not one was in application code. Each
would have escalated a live dispatched run after the model had been paid for,
and each was outside the permitted paths of the agent that hit it — so no agent
could have fixed it.

| | Defect | Fixed in |
|---|---|---|
| 1 | `test_agent.deny` held `frontend/src/**/*.tsx`, and `deny` is checked **before** `write` — so the test agent was denied its own component tests. Every `FRONTEND-*` task would have escalated on its first commit | #46 |
| 2 | `backend/openapi.json` is compared byte-for-byte, but nothing pinned its line endings. `core.autocrlf=true` on Windows checked it out as CRLF against an LF export: 2429 carriage returns, drift gate red on a clean clone | #47 |
| 3 | `docker/backend.Dockerfile`'s `test` stage copied neither `scripts/` nor the committed schema, so that suite passed locally and failed in CI reporting a missing file rather than the missing `COPY` | #47 |
| 4 | Nothing supplied `VITE_*` in CI. `config.ts` throws at module load on a missing one, and `.dockerignore` excludes `**/.env.*` — so any test importing anything that reaches `config.ts` passed locally off `.env.local` and could not pass in the container | #55 |
| 5 | `openapi-fetch`'s `createClient` captures `globalThis.fetch` when constructed, and `api/client.ts` constructs `apiClient` at module load — *before* a setup file's `beforeAll` ran `server.listen()`. Every statically imported `apiClient` held the unpatched fetch and its requests left for the real network as `ECONNREFUSED`, pointing nowhere near msw | #55 |
| 6 | `agent-orchestrator.yml` woke on any `agent/*` branch and assumed it had dispatched it. A hand-authored branch has no `state.json`, so it exited 2 — and had it not, `agentctl next` answers `validate` for a stateless task, so it would have committed a state file onto the open review PR and dispatched a paid worker for work already done | #58 |

`handoff.md` §4 already says this is where this system breaks. It keeps being
right; defects 4 and 5 were found by the preflight this section tells you to do,
before a line of `FRONTEND-002` was written.

**So before starting each unit, ask what that unit's tests will need that is not
application code**, and check it exists: a fixture, a file the image must carry,
a line-ending guarantee, a permission, an env value. Cheaper than finding out
from CI — and measurably so, twice now.

Prefer fixing such a thing to documenting it. Defects 4 and 5 could have been a
wiki line telling five more units to dynamic-import their subject; they are two
config changes and `src/test/harness.test.ts` instead, and no later unit has to
know they ever existed.

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
- **A test uses an ordinary static `import`.** `vite.config.ts`'s `test.env`
  supplies all five `VITE_*` values, and `setupTests.ts` calls `server.listen()`
  at module scope, so both `config.ts` and a module-scope `apiClient` load
  correctly at import time. Do **not** copy the `vi.resetModules()` +
  dynamic-import pattern in `src/api/client.test.ts`; it predates the fix.
  `src/test/harness.test.ts` pins both properties — read it.
- **`frontend/.env.local` is untracked** and holds all five `VITE_*` values for
  `npm run dev` and `npm run build`. A **test run never reads it**: `test.env`
  outranks it, so the real dev pool is unreachable from a test and the values a
  test sees are the same on every machine and in CI.
- **`vitest` runs with `globals: false`.** Import `describe`/`it`/`expect`/`vi`
  from `vitest`. Testing Library registers no auto-cleanup of its own, but
  `setupTests.ts` already calls `cleanup()` in a global `afterEach` — you do not
  need your own.
- **msw runs with `onUnhandledRequest: "error"`.** Every request a test provokes
  needs a handler. A guard test that forgets `GET /users/me` fails as an
  unhandled request, not as the assertion you wrote.
- The pre-commit hook is **blocking on lint, advisory on tests** — precisely so
  the red test commit can land. If it complains about formatting, run
  `backend/.venv/Scripts/ruff.exe format <files>`.

## 7. The contracts `FRONTEND-001` pinned

Six units inherit these. They are pinned by tests, so changing one means
changing its test deliberately — which is a Director decision, not a
convenience:

- **Routes**: `/`, `/compose`, `/notifications`, `/search`, `/profile/:userId`,
  `/sign-in`, `/sign-up`, `/confirm`, `/forgot-password`, `*`, plus
  `/create-profile`. `/compose` and `/notifications` are behind `RequireAuth`;
  `/`, `/search` and `/profile/:userId` are public by decision and a guard on
  any of them is a regression. `routes.test.tsx` sweeps every route asserting
  no *other* view's heading is present, with anchored names (`^Feed$`), and
  records which guard state makes each route render.
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
  out; that is why they are not already separate. `FRONTEND-002` took the four
  auth views; five placeholders remain.

`FRONTEND-002` added five more, and the next units should **build on these
rather than reinvent them** — none is mentioned in any spec, because none
existed when the specs were written:

- **`src/test/auth.tsx`** — `FakeAuthService` (a double of the interface, not
  of the SDK), `renderWithAuth(ui, { authService, route })`, and the
  `GET /users/me` / `GET /events/teams` msw handler factories.
- **`src/auth/AuthContext.tsx`** — `useAuth()`, returning
  `{ session, status, signIn, signOut, authService }`. `status` is
  `"loading" | "anonymous" | "authenticated"`; the third value is load-bearing.
- **`src/auth/profile.ts`** — `PROFILE_QUERY_KEY` and `useProfile(enabled)`,
  the one shared react-query entry for `GET /users/me`. **Anything that changes
  the profile invalidates this key**; a second key hands one guard a 404
  another has already seen answered. `FRONTEND-003` edits the profile, so this
  is its business directly.
- **`src/routes/guards.tsx`** — `RequireAuth`, `RequireNewProfile`.
- **`src/components/FormField.tsx`** — `Field` and `describeField`, the
  label / `aria-invalid` / `aria-describedby` wiring all five auth forms share.
  `FRONTEND-004`'s compose form should use it.

- **Only `src/auth/CognitoAuthService.ts` may import the Cognito SDK**, and
  only `src/config.ts` may read `import.meta.env`. Both are enforced from disk
  by tests that walk the tree, so a violation fails wherever it is written.

## 8. Still owed by the Director, and not by any agent

From `TODO/04-first-deploy.md` §2 — check before the unit that needs each:

- [x] **The OpenAPI drift gate** in `.github/workflows/test-agent.yml`: a job
      that regenerates `backend/openapi.json` and fails on any diff, added to
      `gate`'s `needs:`. The file now exists, so this is unblocked and should be
      done soon — without it a backend route change silently breaks the
      generated client. Add its structural assertion to
      `.ai/tests/test_workflows.py` in the same commit, per `handoff.md` §4.
- [x] `docker/frontend.Dockerfile`: thread the `VITE_*` values into the `build`
      stage as build args. Needed for the deploy, not for any unit.
- [x] `docker/backend.Dockerfile` `lambda` target: copy `alembic/` and
      `alembic.ini`. **`INFRA-003` is unsatisfiable until this lands.**
- [x] Confirm no new frontend dependency is needed. Checked for
      `FRONTEND-002`: `amazon-cognito-identity-js@6.3.20` was already installed
      and imports cleanly under vitest/jsdom and in the container. Re-check per
      unit — `package.json` is denied to the code agent, so a missing
      dependency stops a unit dead and is a Director call, never a retry-loop
      one.
- [ ] **Browser-verify `FRONTEND-002` against the real dev pool.** It shipped
      without this, said so in PR #57, and it is still owed: sign up, confirm
      by email, sign in, land on profile creation, create a profile, land on
      the feed. Every Cognito call sits behind the `AuthService` seam and is
      covered only by the interface double, so the SDK call signatures in
      `CognitoAuthService.ts` are unverified against a live pool — a wrong
      argument shape there passes every test in the suite. `docker compose up
      -d --build backend-dev`, then `npm run dev`. Not a blocker for
      `FRONTEND-003`/`004`, but it is the one thing no test can replace.

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
