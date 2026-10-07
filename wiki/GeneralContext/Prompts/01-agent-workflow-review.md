# 01 — Review the automated agent workflow, then decide with the human

**Objective:** the app is built and live; the project's real objective, the
automated AI development pipeline in `.ai/`, is the focus again
(`.ai/docs/philosophy.md` §2). Before it runs another task, review it: find
what is sub-optimal for **safety, performance and cost**, and talk through
with the human how to improve it. **This session analyses and discusses. It
changes nothing until the human has agreed what to change.**

You are a **Director** (`AGENTS.md` "Agent system";
`wiki/GeneralContext/Architecture/director-sessions.md`). The fixes this review
leads to touch `.ai/` and `.github/`, which no worker may write, so they land
as Director PRs on human-named branches, read by the human before they merge.

## Where things stand (2026-10-07)

Verify each of these rather than trusting it; they are your starting point,
not your evidence.

- **The pipeline ran two real tasks, both in September.** `DEMO-001`
  (2026-09-21) and `USERS-002` (2026-09-23, the first complete unattended
  pass: 14 minutes, one attempt, **$0.38**). `.ai/docs/handoff.md` records
  what is proven and what is not, and §4 lists seventeen bugs, sixteen of them
  in *when work fires*, not in the tested core.
- **Nothing has gone through it since.** Every unit after that
  (`INFRA-002`/`003`, `FRONTEND-001`…`007`, `UI-001`…`008`) was run by hand
  from Claude Code on hand-cut `agent/<ID>` branches, which `agent-guard`
  still held to their specs. The reason was cost: the orchestrator bills
  metered API credits, while a subscription session doesn't
  (`director-sessions.md` → "Who pays"). So `agentctl status` shows those
  tasks as `DRAFT`, and the orchestrator correctly no-ops on their CI (no
  state file).
- **The hand-run sessions learned things the automated roles were never
  told.** `director-sessions.md` and `wiki/CodeContext/FrontendUI/verification.md`
  hold them: tree scans that read test files, prettier on named files only,
  the Vitest 4 CSS Module proxy, testing sibling PRs together, guard per role
  per commit, browser rows. Compare them with `.ai/prompts/` and
  `.ai/skills/`.
- **Handoff §9.2 lists five open agent-system items**, and §9.1 asks for a
  read-only flow enumeration before any of them is fixed. That enumeration
  was never done.
- **`jev`, a "System One" model (TypeSafe), is meant to be the typed-decision
  layer**: the Manager's retry/re-scope/escalate call, flake forgiveness, and
  a spec-readiness check before dispatch. It is built on the branch
  `jev-decision-layer` (`.ai/agentlib/decision.py`, `.ai/bin/ask_jev.py`,
  `.ai/questions/*.json`, a worker-workflow change), **parked** because no
  call ever returned 200. That branch is 270 commits behind `main` and still
  points at the Vercel AI Gateway route. **The human now has a direct
  TypeSafe key** (route `api.typesafe.ai/v1/systemone`, model `jev-latest`,
  secret `TYPESAFE_API_KEY`). It is **not yet a repository secret**
  (`TODO/01-for-you.md` §1). Read the branch with `git show` and
  `git diff`, not by checking it out over your work.
- **Secrets today:** `ANTHROPIC_API_KEY`, `AGENT_DISPATCH_TOKEN`,
  `AI_GATEWAY_API_KEY`. **The repository is public.**
- **The remaining build work** is `TODO/02-backlog.md`. It is meant to go
  through the pipeline once this review's changes land, so it is also your
  test load: which of those items could the pipeline run today, and which
  would it fail on?

## Read

1. `.ai/docs/philosophy.md`, all of it. §7 is the review protocol, and §8 is
   what was deliberately not done; don't re-propose those without new
   evidence.
2. `.ai/docs/handoff.md`, then `architecture.md`, `state-machine.md`,
   `permissions.md`, `threat-model.md`, `operations.md`.
3. The code where being wrong matters most: `.ai/agentlib/state.py`,
   `guard.py`, `orchestrator.py`, `.ai/bin/invoke_agent.sh`,
   `.ai/config.json`, `.ai/policy.json`, and the four workflows
   (`agent-orchestrator.yml`, `agent-worker.yml`, `agent-guard.yml`,
   `test-agent.yml`), plus `deploy.yml` for what a merge sets off.
4. `wiki/GeneralContext/Architecture/github-automation-setup.md`: the
   repository settings, which aren't in version control.
5. The evidence: `agentctl status`, `agentctl telemetry report`, the
   telemetry files, and the real run history (`gh run list`,
   `gh run view <id> --log`).

## Do

**1. The flow enumeration first, by a subagent.** Run handoff §9.1 as
written: a read-only subagent, given exactly that brief, enumerates every
condition under which the repository does automated work and what wakes each
task next. Don't read its result as ground truth; spot-check its citations.

**2. Your own review**, along the human's three axes, each finding cited:

- **Safety.** Can an agent widen its permissions, reach a secret, or get work
  to `main` without a human? Look hardest at what being public adds (forks,
  `pull_request` from forks, which events see secrets, `workflow_run`
  privilege), at the worker step that holds a provider key, at prompt
  injection through repository content into each role, and at what the `jev`
  seam would add: a new outbound call carrying repository content, and
  decisions that advance state on a model's confidence.
- **Performance.** Time from dispatch to PR, and where it goes: CLI install
  per run (unpinned, 20–30 s), container rebuilds, CI minutes per task,
  the two orchestrator runs before the test agent starts, how many CI runs a
  task triggers. Which waits are necessary and which are mechanics?
- **Cost.** Per role and per task. Are the models in `config.json` the right
  ones and still current? Check the provider's current model list and prices
  rather than the file's. Is the prompt context each role gets the right size
  (`required_context`, skills)? What a retry costs. What `jev` would replace
  versus add: does a typed System One answer make the Manager's Opus call
  unnecessary, and at what price per decision?

Also judge what the hand-run sessions did better, and what it would take for
the pipeline to match it (test review between red and implementation,
"the committed test is wrong" objections, browser checks), without adding an
agent where a script would do (`philosophy.md` §3, §7).

**3. Report, then discuss.** Bring the human a ranked list, most severe
first. Each finding states, per `philosophy.md` §7: the trace or citation it
came from, with numbers; the grade of enforcement a fix would reach
(impossible / detected / escalated); what the fix costs; how you'd know it
worked; and how to reverse it. Separate **defects** (wrong today) from
**improvements** (better trade-offs). For `jev`, give a recommendation with
its preconditions: where it plugs in, what it replaces, the merge gate, and
what the system does when it is unreachable.

Then **stop and discuss.** The human decides what is worth doing and in what
order. Use `AskUserQuestion` for decisions with clear options.

## After the discussion

Write the agreed decisions down before building anything: update
`.ai/docs/handoff.md` (it is dated 2026-09-23 and is the agent system's state
document) and `TODO/02-backlog.md`'s "Agent system" section with the agreed
plan, in a Director PR. Each fix after that is its own Director PR, with its
structural assertion in `.ai/tests/test_workflows.py` where the change is to
a workflow (handoff §4). Then pick the first `TODO/02-backlog.md` item as the
first real task through the reviewed pipeline, and write its spec.

## Limits

- **Never start `agent-orchestrator.yml`** in this session, and never dispatch
  a worker. Every run bills credits; that starts once the human says so.
- **Never handle the `jev` key's value.** If a call needs it, the human sets
  the secret (`TODO/01-for-you.md` §1) and the call runs in CI, or the human
  runs it.
- Never `cdk deploy`; nothing here deploys. Every command you hand the human
  is one line of PowerShell.
- Nothing merges itself. Merge nothing.
