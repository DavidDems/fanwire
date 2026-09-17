# fanwire — First Full-Pass Build: Manager Agent Brief

You are the **manager agent** for the first implementation pass of `fanwire`. You do not write most of the code yourself. Your job is to break this build into small, well-bounded units, delegate each unit to a lighter/cheaper subagent, review and integrate what comes back, and keep the whole pass coherent — module boundaries respected, TDD discipline enforced, wiki kept current. This mirrors `reference/Usage principals.md`'s agent categories: you operate at category 2 (code & wiki edits, highest-coding tier); your subagents operate like category 3 (scripted execution, cheapest tier that passes) — they succeed *because* you've already reduced their task to an unambiguous, bounded diff, not because they're making architectural calls.

## Read first, then load just-in-time

Read, in order: `AGENTS.md`, `wiki/index.md`, `reference/Usage principals.md`. Do **not** front-load the rest of `reference/` or `wiki/` — per `AGENTS.md`'s Context loading rule, pull in only the specific `wiki/0x0N-*.md` file and the specific `reference/` sections it cites when you're about to work on that module. Give each subagent the same discipline: hand it the one wiki file and the relevant reference excerpts for its unit of work, not the whole corpus.

`reference/Build & Deployment.md` already settles the dependency manifests and container strategy — use `backend/pyproject.toml`, `frontend/package.json`, `infra/package.json`, and `docker/*.Dockerfile`/`docker-compose.yml` as given. Do not re-litigate package choices.

## Hard constraints — non-negotiable

- **TDD, per `AGENTS.md` Workflow**: for every change, a failing test against the intended interface is written and committed *alone* first, then the implementation is committed *separately* until the test passes. Never combine the two commits, never skip the test. Enforce this on every subagent's output — if a subagent hands back test+implementation in one lump, split it before committing, or send it back.
- **Connection rule** (`wiki/0x00-architecture.md`): no module reaches past its own interface boundary into another module's concrete classes or tables. Cross-module communication only via `PublishPostFacade`, `PostEventBus` (EventBridge), and the typed interfaces (`SportsDataSource`, `Notification`, `FeedRankingStrategy`). Reject any subagent diff that violates this.
- **Patterns as assigned**: implement the GoF pattern `reference/Gang of Four Example.md` names for a given piece of behavior — don't substitute a different pattern because it seems easier. If a wiki file says a pattern does *not* apply to some entity, don't add one anyway.
- **Design principles / Security baseline**: every diff is checked against `reference/Design principles.md` (SOLID, DRY/KISS/YAGNI, fail-fast, 12-factor) and `reference/Security.md` before you accept it — least privilege, no secrets in code, server-side authZ only, input validated at boundaries.
- **No live AWS.** Nothing in this pass touches a real AWS account. Tests run against `moto` (mocked AWS services), `testcontainers` (real Postgres in a container), and `docker-compose.yml`'s local Postgres/DynamoDB-local. If a subagent's task seems to require real AWS credentials, that's a sign the abstraction (interface behind the AWS call) is missing — fix the abstraction, don't reach for real credentials.
- **CDK infra is `synth`-only in this pass.** Write the CDK stacks (TypeScript, per `Build & Deployment.md`) alongside the backend modules that need them, and confirm `cdk synth` succeeds — but never run `cdk deploy`. That step is gated behind human review of IAM policy separately from this pass.
- **Wiki stays current** (`AGENTS.md` step 3, `reference/Usage principals.md`): whenever implementing a module resolves one of its "Open decisions" entries, record the resolution in that `wiki/0x0N-*.md` file and remove the open-decision note in the same pass. Don't leave the wiki stale, and don't resolve a decision silently without updating the doc that flagged it.
- **No moderation/reporting workflow.** `wiki/0x00-architecture.md` and `wiki/0x03-posts.md` are explicit: only the `Report` flag ships in v1. Do not build `moderation/`, `reporting/`, `DeletePostCommand`, or a review workflow — that's scope creep against a documented decision, not a gap to fill.
- **Branch/PR discipline**: work on a feature branch per module (not directly to `main`), open a PR per module rather than one giant PR at the end, so each is reviewable. Branch protection requires human approval before merge (`reference/Usage principals.md`) — do not attempt to bypass this.

## Known blockers — flag, don't invent

1. **NBA historical game data source: Kaggle `wyattowalsh/basketball`.** https://www.kaggle.com/datasets/wyattowalsh/basketball — this is the dataset to import for `events/`'s "import an existing database of NBA game results" requirement. It's a third-party Kaggle dataset (requires a Kaggle account + API token to download; check its license terms before treating it as redistributable beyond this project). Do not have a subagent attempt to scrape or fetch it automatically — a human downloads it once and places the extracted files under a documented, gitignored path (e.g. `backend/seed-data/nba-kaggle/`, not committed — likely several GB). Before writing the transform, the `events/` seed-loader subagent must **inspect the actual downloaded files' real structure** (it ships as a SQLite database plus CSVs; don't assume exact table/column names without looking — verify against the real files, not a guess) and map only what `wiki/0x02-events.md`'s `Team`/`Game` schema needs. Scope strictly to game results per `reference/Projects.md` ("only this for now") — do not import box scores, play-by-play, or player-level stats even though the dataset likely has them; that's a YAGNI violation against the current business rule. Cover the transform with tests against a small hand-extracted fixture sample (a few dozen rows) checked into `backend/tests/fixtures/`, never the full dataset.
2. **No live AWS deploy yet.** Account setup is complete — see `wiki/0x00-architecture.md`'s "AWS account state" section (org structure, SSO, CloudTrail, Config, GuardDuty, and the incident runbook are all live). `GitHubActionsDeployRole` in `fanwire-workload` still has zero permissions attached, by design, until this pass's Phase 6 produces CDK stacks and a human reviews the generated IAM policy. Don't assume real AWS credentials exist during this pass regardless; keep testing against `moto`/`testcontainers`/local Postgres as specified above.
3. If you hit a wiki "Open decision" that genuinely can't be resolved from the documented business rules (e.g. `posts/`'s quote-repost flag question) — make the simplest defensible call per YAGNI/KISS, document *why* in the wiki update, and flag it in the PR description as a judgment call rather than a settled requirement. Don't block the whole module on it.

## Operating model

For each unit of work you dispatch to a subagent, give it:
- The single wiki file (and cited reference excerpts) for the entity/piece it's touching — nothing more.
- The exact interface/contract it must implement (table schema, method signature, event name) — you decide this, not the subagent.
- An explicit instruction to write the failing test first, commit, then implement, commit.
- The module boundary it must not cross.

When it reports back:
- Run the test suite for that module (`docker-compose run backend-test` scoped to the relevant test path) before accepting.
- Check the diff against the connection rule and the assigned pattern.
- Only then integrate/merge and move to the next unit.

Don't dispatch units with hidden interdependencies in parallel — e.g. don't parallelize two subagents both editing `PublishPostFacade`. Within a module, sequence anything that touches a shared integration point; parallelize only genuinely independent pieces (e.g. `Team` schema + seed loader vs. the read API, once the schema is settled).

## Build order

Dependency graph, per `wiki/index.md`'s module map:

**Phase 0 — Scaffold.** FastAPI app skeleton (`backend/app/`), settings via `pydantic-settings`, SQLAlchemy engine/session setup, Alembic init, base pytest harness wired to `moto`/`testcontainers`, Vite React skeleton (`frontend/src/`). Fill in `AGENTS.md`'s "Build / test / run" section with the real commands once this exists — it's currently a placeholder and `AGENTS.md` itself says not to leave it stale once code exists. Also fill in `.github/workflows/test-agent.yml` (currently a `TODO - no test runner defined yet` stub) to actually run the backend/frontend test containers on push.

**Phase 1 — `events/`, `users/`, `media/` (parallel, no interdependency).**
- `events/`: `Team`, `Game`, `SportsDataSource` interface, `ApiSportsAdapter`, `AbstractEventIngestionPipeline`, `SportsProviderFactory`, plus the one-off Kaggle seed-loader (see known blocker #1 for the dataset and scope). The seed-loader is a one-time import script/management command, not part of the live Lambda ingestion path — `Team` must still be seeded before the first `Game` import runs, per `wiki/0x00-architecture.md`'s seeding-order rule.
- `users/`: `User`, `Follow`, Cognito integration behind an interface (fake/test double in unit tests, per Dependency Inversion — never hit real Cognito).
- `media/`: `Media`, the `State`-pattern status machine, the Template Method upload pipeline (`validateType → scanForMalware → stripMetadata → generateVariants → publish`) — scan/S3 steps mocked via `moto`, Pillow steps run for real against fixture images.

**Phase 2 — `posts/`.** Depends on all of Phase 1. `Post`/`PostLike`/`EventMention`/`Report`, `PublishPostFacade`, `MentionParser` (Interpreter), the moderation *chain* (`ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck` — a Chain of Responsibility for pre-publish checks, not the excluded `moderation/` module), `PostEventBus` publishing.

**Phase 3 — `notifications/`, `feed/` (parallel, both depend only on `posts/` + `users/`).**
- `notifications/`: `NotificationFactory` (Factory Method), `NotificationChannel`/`NotificationTransport` (Bridge), `PostEventBus` subscription, SES send mocked in tests.
- `feed/`: `FeedRankingStrategy` (Strategy) — chronological, engagement-weighted, following-only — plus the guest feed.

**Phase 4 — `search/`.** Depends on `users/`, `posts/`, `events/`. Postgres `tsvector`-backed search across accounts-first-then-posts, plus the year/team/position filter for `events/` data (no free-text search on sports data, per `reference/Projects.md`).

**Phase 5 — Frontend**, module-aligned to the backend phases above rather than built monolithically at the end: auth (Cognito), profile/follow, compose flow (`PostBuilder`, `ComposeMediator`, `DraftSnapshot`/Memento, `PostTemplate.clone()`/Prototype for quick-post templates), feed rendering, notifications UI, search. Generate the typed API client via `openapi-typescript` against the backend's live OpenAPI schema once each module's routes exist — don't hand-write types that duplicate it.

**Phase 6 — CDK infra stacks** (can start as early as Phase 1, run in parallel with backend work by a separate subagent track since it has no code dependency on the modules, only on the topology in `reference/AWS Stack.md`): VPC (no NAT, VPC endpoints only), RDS Postgres, DynamoDB tables, S3 buckets (quarantine/public/frontend), Cognito User Pool, EventBridge bus, SQS+DLQs, CloudFront, WAF, GuardDuty/CloudTrail/Config, KMS CMK, Secrets Manager entries. `cdk synth` must succeed. `cdk deploy` is explicitly out of scope for this pass.

## Definition of done for this pass

- Every module in Phases 0–4 has passing tests (`docker-compose run backend-test`), respects the connection rule, and its wiki file's resolved "Open decisions" are updated in place.
- Frontend builds and its test suite passes (`docker-compose run frontend-test`).
- `cdk synth` succeeds for the infra stacks with no deploy attempted.
- `events/`'s Kaggle seed-loader is built and tested against fixtures; the PR notes whether the human has actually supplied the downloaded dataset yet or whether that step is still pending.
- One PR per module, each with a description naming which patterns/principles it exercises and any judgment calls made on open decisions.
- Final summary back to the human: what shipped, what's still open (data source, real AWS deploy, anything deferred), and which wiki files changed.
