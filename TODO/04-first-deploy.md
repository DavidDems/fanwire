# 04 — The first deploy: everything between here and `fanwire.daviddems.com`

**Written 2026-09-25**, after `TODO/02` closed its last available item (the dev
S3 buckets). **Its objective was met on 2026-09-30** — see §4. What is still
open here is §2's last item and `FRONTEND-007` in §3.

This file is the sequencing document for the rest of the build. It
names every change still needed, says who is allowed to make it, and puts them
in an order that works.

**Done means**: `https://fanwire.daviddems.com` serves the SPA, the SPA's calls
reach the API through CloudFront's `/api` behaviour, and the API reaches a
database whose schema exists.

Everything in `TODO/02` §2 is *after* that — it is the post-deploy checklist,
and none of it can be done before the resources exist.

---

## 1. Why this is not one job

Three different authorities have to make changes, and they are not
interchangeable:

| Who | May write | Why it is separate |
|---|---|---|
| **Director** (a human-driven session) | `.ai/`, `.github/`, `docker/`, `*/package.json`, `wiki/GeneralContext/`, this file | These are in `guard.ALWAYS_FORBIDDEN` or explicitly denied in `.ai/policy.json`. **No agent can write them**, and a task spec that names one fails validation. |
| **Agents** (`.ai/tasks/*`) | application code and tests, within each spec's `allowed_paths` | The pipeline's normal work. |
| **The human, at a keyboard** | AWS | `cdk deploy` is out of scope for every workflow in this repo, deliberately — `.ai/docs/handoff.md` §5.7. |

The ordering trap: **a Director prerequisite that has not landed makes the agent
task that depends on it unsatisfiable**, and the pipeline discovers that by
burning a live run and escalating. That is bug 16, and it cost a whole
successful pass. Check §2 before dispatching anything in §3.

---

## 2. Director prerequisites

### Done already, 2026-09-25

- [x] **`frontend/vite.config.ts`** — the `/api` dev proxy with the prefix
      strip, matching what CloudFront does in production. Left out of every
      frontend spec's `allowed_paths` so it stays settled.
- [x] **`.ai/policy.json`** — `backend/openapi.json` granted to the code agent
      as one exact path. Without it `FRONTEND-001` cannot commit the generated
      contract and escalates on the guard.
- [x] **`.ai/skills/frontend-unit/SKILL.md`** — the repo-specific frontend
      mechanics. Every `FRONTEND-*` spec requires it by name, and
      `task validate` rejects a spec naming a skill with no `SKILL.md`.
- [x] **`wiki/CodeContext/Modules/0x08-frontend.md`** — the module file the
      context maintainer appends to after each frontend unit.

### Still to do

- [x] **`docker/backend.Dockerfile`, `lambda` target: copy `alembic/` and
      `alembic.ini`.** `INFRA-003` is unsatisfiable without it — `docker/**` is
      denied to the code agent, so the agent cannot add it and cannot work
      around it.
- [x] **`docker/frontend.Dockerfile`, `build` stage: accept the `VITE_*` values
      as build args and pass them into `npm run build`.** Vite inlines them at
      build time; today the stage runs `npm run build` with none of them set, so
      it can only ever produce a bundle configured for nothing. Needed by §4
      phase 3, not by any agent task.
- [x] **`.github/workflows/test-agent.yml`: an OpenAPI drift gate.** A job that
      regenerates `backend/openapi.json` and fails on any diff, added to
      `gate`'s `needs:`. **Add it after `FRONTEND-001` merges**, not before —
      the file it checks does not exist yet, and a required check that fails on
      every PR blocks the work that would fix it.
      Per `handoff.md` §4, add its structural assertion to
      `.ai/tests/test_workflows.py` in the same commit.
- [x] **`frontend/.env.local`** (untracked, per-developer): the dev pool's
      `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`,
      plus `VITE_API_BASE_URL=/api` and `VITE_MEDIA_BASE_URL`. Needed the moment
      `FRONTEND-001`'s `config.ts` lands, because it throws on a missing value by
      design. Values are in `wiki/GeneralContext/Architecture/dev-auth-setup.md`.
- [ ] **Confirm no new frontend dependency is needed.** Everything the seven
      units call for is already in `frontend/package.json`, and it is denied to
      the code agent. If a unit reports a missing package, that is a Director
      decision and a separate PR — not something a retry loop resolves.

---

## 3. The agent tasks

Nine specs, all validated (`agentctl selfcheck` passes). Arrows are hard
dependencies — the later task imports or extends what the earlier one committed.

```
FRONTEND-001  foundation, typed client, config, router shell, msw
     │
FRONTEND-002  auth: AuthService, Cognito, route guard, profile creation
     │
     ├── FRONTEND-003  profile + follow          ┐ independent
     └── FRONTEND-004  compose (Builder/Mediator/│ of each other
                       Memento/Prototype, media) ┘
                          │
                    FRONTEND-005  feed + threads (Composite, Decorator)
                          │
                          ├── FRONTEND-006  notifications
                          └── FRONTEND-007  search (two separate UIs)

INFRA-002   BucketDeployment behind the deployFrontend flag   ─┐ DONE 2026-09-29
INFRA-003   migration runner                                  ┘ (PRs #72, #73)
MEDIA-002   dev-only media processing script — optional, not on the deploy path
```

**`INFRA-002` and `INFRA-003` are both merged** (2026-09-29). The two mechanisms
§4 depends on therefore exist: `cdk deploy -c deployFrontend=true` uploads
`frontend/dist` and invalidates `/*`, and the `Migration` function applies the
schema when a human invokes it. Nothing in §4 changes — it was written
anticipating both — but its phases are now executable rather than prospective.

`MEDIA-002` is not needed to deploy; it is needed to click through a media
upload locally.

**Nothing here merges itself.** Every branch reaches `main` through a
human-approved PR, and a PR opened by the workflow arrives with no checks until
a human approves the run (`handoff.md` §1a).

---

## 4. The deploy itself — human, at a keyboard

`cdk deploy` is out of scope for every workflow in this repo and must stay that
way. `handoff.md` §5.7 is not a preference: a pipeline that can deploy is a
different risk class, and this permission model was not designed for it.

### Why it takes three phases

Vite inlines `VITE_*` at **build** time. The production Cognito pool id and SPA
client id do not exist until `Fanwire-Auth` has deployed. So the bundle cannot
be built before the first deploy, and the first deploy therefore cannot contain
the bundle.

There is no way around this ordering short of a runtime-fetched config file,
which was not chosen. It is a property of the design, not an oversight.

> ## ✅ All three phases are done, 2026-09-30
>
> `https://fanwire.daviddems.com` serves the SPA; sign-up, verification,
> login, profile creation and posting all work against production. The full
> record is `wiki/CodeContext/Modules/0x00-architecture.md` → "First deploy,
> 2026-09-29" and "Phase 3, 2026-09-30". The rebuild-and-upload recipe (what
> `06` and any later frontend change needs) is
> `wiki/CodeContext/Standards/build-deployment.md` → "Rebuilding the SPA".
>
> **Live outputs:** distribution `E2AXWWXMA8YAE8` ·
> `d3fb0uyhisvzkz.cloudfront.net` · pool `ca-central-1_eSfPUMRq8` · client
> `1vskugrl60gggpt0lmib4ka85j`.
>
> What each phase cost, in short:
>
> - **Phase 1** rolled back once on `reservedConcurrentExecutions` (account
>   concurrency limit 10; since raised to 1000, and the reservation stays off).
> - **Phase 2** returned `{"revision": "f4a1c9d2b6e7"}`.
> - **Phase 3** served the SPA first time, then exposed that **the NAT
>   instance had never forwarded anything**: CDK's default bootstrap was
>   OOM-killed on the t4g.nano. Every authenticated route returned 500 until
>   PR #75 replaced the bootstrap and `Fanwire-Network` was redeployed.
>
> ### Traps that will catch the next person
>
> - **An empty frontend bucket serves `403 AccessDenied`, not `404`** — the OAC
>   policy grants `s3:GetObject` and not `s3:ListBucket`. Reaching that XML
>   means DNS, TLS, the certificate and OAC all work.
> - **Verify the branch before deploying.** `git switch` fails when the branch
>   is checked out in another worktree, and PowerShell's `;` carries on. Check
>   `git branch --show-current` and the property you think you changed, as
>   separate commands.
> - **`VITE_MEDIA_BASE_URL` is the site origin, not `/media`.** Public keys
>   already start with `media/`; a `/media` base produces `/media/media/…`.
> - **Build the bundle in Docker, never with a bare `npm run build`.**
>   `frontend/.env.local` holds the *dev* pool and Vite reads it in production
>   mode too; the Docker build excludes it and fails on any missing value.
> - **`/api/health` proves nothing past API Gateway.** It touches neither the
>   database nor egress. A logged-in `/api/users/me` is the first real check.
> - **The infra tests used to leak ~50 MB per synth into `%TEMP%`** and filled
>   the disk mid-session (fixed in PR #76). If Docker Desktop hangs with no
>   output, check free space first.
> - **`aws … | Select-String` can die with `'charmap' codec can't encode`**
>   when the output holds a non-ASCII character. Prefix the line with
>   `$env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1';`.

The three phases, for reference — each is now a recipe rather than a plan:

**Phase 1 — bring up the stacks.** All eight, ~30–45 minutes. There is no
frontend-only deploy — `CdnStack` needs `AppStack`'s HTTP API id, and
`AppStack` depends on everything else. Leave `deployFrontend` unset.

**Phase 2 — apply the schema.** Invoke `INFRA-003`'s migration function once,
by hand, and confirm it returns a head revision. Re-run it after any deploy
that adds a migration.

**Phase 3 — build the bundle against the real outputs, then deploy it.** See
`wiki/CodeContext/Standards/build-deployment.md` → "Rebuilding the SPA" for the
exact commands.

### Then, and only then

The post-deploy checklist — worked 2026-09-30. What each check proved is in
`wiki/CodeContext/Modules/0x00-architecture.md` → "Post-deploy checks,
2026-09-30"; what it left for a human is `TODO/02-deployment-requirements.md`.

---

## 5. A standing note on where the model spend goes

Worth recording here because it changes how §3 gets run, not just what it costs.

`.github/workflows/agent-worker.yml` invokes the provider CLI with
`ANTHROPIC_API_KEY` from repository secrets. **That bills metered API credits.**
A Claude Pro or Max subscription does not cover it, and no part of the pipeline
reads a subscription. Every figure in `.ai/telemetry/` — DEMO-001 at $0.27,
USERS-002 at $0.38 — is credit spend.

There is no manager agent calling a sub-agent anywhere in this system. The
orchestrator dispatches one worker per role, each worker is one CLI invocation
against the API, and `manager` is just another such role that happens to run on
a more expensive model. The "manager delegating to subagents" shape belongs to
the older `wiki/GeneralContext/Prompts/phase-*-manager-agent.md` briefs, which
were run by a human in an interactive session — a different execution model that
the `.ai/` pipeline replaced.

Both can run these specs. A spec is a contract, not a dispatch mechanism: an
interactive session can read `brief.md`, delegate to subagents, and produce the
same branch and PR without the orchestrator being involved at all. The
difference is only who pays and who supervises.
