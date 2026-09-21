# Philosophy: building software with agents, safely and reliably

**This is the entry point for reviewing or improving the agent workflow.** If
you are a reasoning model asked to critique, extend or redesign any part of
this system, read this file first, then `architecture.md`, then the code it
points at. The last two sections tell you how to do that review and what a
good proposal looks like.

---

## 1. The thesis

An LLM agent is a fast, capable, and *unreliable* worker. It is unreliable in a
specific and useful way: it is far more likely to do something plausible-
but-wrong than to do nothing, and it will report success either way.

Every design decision here follows from that one observation.

You do not make an unreliable worker reliable by asking it to be careful. You
make the *system* reliable by arranging things so that the worker's
unreliability is bounded, detected, and cheap:

- **Bounded** — it can only affect a small, declared set of files.
- **Detected** — something other than the worker decides whether the work is good.
- **Cheap** — a wrong answer costs one attempt out of a fixed budget, not a
  corrupted repository and an afternoon of archaeology.

The agent is a component with a known failure rate, not a colleague you trust.
Design around it the way you would design around a flaky network call: assume
failure, bound the blast radius, make retries safe, and never let it be the
thing that reports its own success.

## 2. What this project actually is

fanwire is a sports discussion app. That is the *byproduct*.

The real objective is an automated AI development pipeline — a repeatable
process that takes a specification and produces reviewed, tested, working
software with as little human involvement as the work genuinely requires. The
app exists to give that pipeline something real to build, with real
constraints, real regressions and real cost.

This matters when you are reviewing the system, because it changes what counts
as a good decision. A change that ships the app faster but makes the pipeline
less observable is a **bad** trade here. A change that costs an extra CI minute
but turns a prose rule into an enforced one is a **good** trade here. Optimise
for the pipeline.

## 3. The ordering: safety, determinism, observability, cost, maintainability

When two of these conflict, the earlier one wins. The ordering is not a slogan;
it resolves real arguments.

**Safety first.** An agent must not be able to widen its own permissions,
modify the thing that checks it, or merge its own work. When convenience and
safety conflict, safety wins even when the convenience is large. This is why
the code agent cannot edit `pyproject.toml` — yes, that occasionally blocks a
legitimate change, and that is the correct trade for a permission that would
otherwise let a retry loop make a supply-chain decision.

**Determinism second.** If a script can do it, a script does it. Git operations,
branch naming, retry counting, state transitions, permission checks, log
parsing, token accounting: all deterministic, all unit-tested, none of it
billed per token. Models are for reasoning — architecture, writing tests,
implementation, interpreting genuinely ambiguous failures. Nothing else.

A useful test when adding anything: *could this be a script?* If yes, and you
are reaching for a model because it is easier to write a prompt than a parser,
you are making the system slower, more expensive and less predictable to save
yourself thirty minutes.

**Observability third.** A human must be able to answer "what is it doing, why,
what failed, and what happens next" without opening an agent session. If a
change makes the system smarter but less inspectable, it is usually not worth
it. State that only exists inside a model's context window is state that does
not exist.

**Cost fourth.** Real, and measured (`agentctl telemetry report`), but never at
the expense of the three above. The way to be cheap is to do less model work,
not to weaken a check.

**Maintainability last, but not optional.** Another developer must be able to
read the entire workflow. A clever orchestration framework nobody can follow is
worse than a plain state machine with a few rough edges.

## 4. Enforcement, not instruction

This is the principle the whole repository turned on.

An earlier version of this project's agent rules was a folder of Markdown files
full of "MUST NOT" bullets. They were deliberately taken off `main`, because an
instruction an agent can ignore is not a rule — it is a hope with formatting.
That draft was held back until it could be backed by something technical. This
system is that backing.

The test for any rule you want to add:

> If an agent ignores this, what stops it?

If the answer is "nothing, but we told it not to", it is not a rule yet. Either
find the enforcement, or write it down honestly as unenforced. Both are fine.
Pretending is not — and `permissions.md` therefore closes with an explicit list
of what is *not* technically enforced, because a security model that overstates
itself is worse than one with known gaps.

Prompts still matter. They steer behaviour, and good steering means fewer
violations to catch. But a prompt is an optimisation; the guard is the control.

### The best enforcement is structural

There are three grades, and you should always reach for the highest available:

1. **Impossible** — the agent has no credential, no permission, no path. The
   model process gets no GitHub token, so no amount of persuasion makes it
   dispatch a workflow. Nothing to detect, because nothing can happen.
2. **Detected and reverted** — the guard checks the diff and discards work
   outside the declared paths. The attempt happens; it just cannot land.
3. **Detected and escalated** — CI fails, a human looks.

The red-baseline check is grade 1 applied to a *process* rule rather than a
permission. "Write the test first" was unenforceable prose for years. Requiring
the tests-only CI run to be **red** before implementation is dispatched makes
test-first a property of the machine: a test that pins nothing cannot get past
the gate, no matter what any agent claims. That is the pattern to look for when
you want to enforce a process rule — find the observable consequence of the
rule being followed, and gate on that instead of on the behaviour.

## 5. Untrusted by default

Assume repository contents are hostile. Not because they are today, but because
the discipline that assumption produces is the same discipline that makes the
system robust to ordinary confusion — a stale comment, a misleading docstring,
a test name that lies.

Trusted instruction is exactly two things: `.ai/prompts/*.md` and the task
contract. Everything else — source, comments, Markdown, CI output, fetched data
— is fenced and labelled as data before it reaches a model.

The corollary that gets forgotten: **never parse a decision out of prose.** The
workflow reads three structured fields from model output and nothing else. A
manager's decision comes from a `decision` field, never from its reasoning
text, because reasoning text can quote a file, and a file can say anything.

## 6. The optimization loop

This system is not finished and is not supposed to be. The standing question,
asked continuously and never considered answered:

> **What just happened by hand, or by a model, that a deterministic action
> could have done instead?**

Every manual intervention, every escalation, every retry, every "oh, I have to
remember to do X first" is a candidate. The loop:

```
observe a friction   →   ask if it is mechanical   →   if yes, automate it
      ↑                                                       │
      └──────────────  the trace shows whether it helped  ─────┘
```

### Traces are the input

Optimisation proposals must come from evidence, not from taste. Four traces
exist, and all four are durable:

| Trace | What it answers | How to read it |
|---|---|---|
| **`state.json` history** | Which transitions actually happen. Where tasks stall, how often the manager is reached, which failure modes recur. | `agentctl state show <ID>`, `agentctl status` |
| **Git tree** | What agents actually produced, in what order, and what a human had to change afterwards. The gap between the agent's final commit and the merge commit is the cost of its mistakes. | `git log`, PR review diffs |
| **Telemetry** | Where tokens and money go, per role and per model. Cost per *successful* task is the number that matters. | `agentctl telemetry report` |
| **CI runs** | Ground truth on correctness, and the only trace an agent cannot influence. | the Actions tab |

A proposal that says "the code agent seems confused about X" is worth little. A
proposal that says "seven of the last twelve tasks escalated with
`red_baseline_not_red`, so acceptance criteria are being written untestably,
so the spec validator should reject criteria without an observable predicate"
is worth acting on. **Cite the trace.**

### Signals worth watching

- **Escalation rate climbing** → task specs are under-specified. That is a
  Director problem, not a model problem, and no amount of prompt tuning fixes it.
- **Attempts-per-task climbing** → either the tests pin the wrong thing, or the
  context handed over is insufficient. Compare against which files the code
  agent actually touched.
- **Manager cost dominating** → the deterministic retry policy is giving up too
  early, or failures are genuinely ambiguous and the distiller needs better
  categories.
- **The same human intervention twice** → automate it. Twice is a pattern.
- **A guard violation that was legitimate** → `allowed_paths` is too narrow, and
  the spec was wrong, not the agent.

### Candidate automations, already identified

These came out of earlier build phases as prose rules or recurring friction.
Each is a real candidate for grade-1 or grade-2 enforcement; none is built yet.
Treat this as a live backlog, not a record.

| Friction | Currently | Candidate |
|---|---|---|
| Stacked PRs merged top-down never reached `main` | Every brief tells the agent to verify ancestry | A CI check asserting a PR's base is `main`; GitHub's "automatically delete head branches" |
| `git stash` used by subagents — the stash stack is shared across worktrees and sessions | Nothing | A hook or wrapper refusing `git stash` in an agent session |
| `docker compose run --rm` leaves dependency containers holding host ports; parallel worktrees then fail with "port is already allocated" | A prose rule to run `docker compose down` | A pre-flight port check, or a wrapper script |
| Lint debt accumulating | `pre-commit` hook, opt-in per clone | Ruff in CI as a required check (the hook is a convenience, not a control) |
| The IAM "no `*` in Action" rule | `infra/test/iam-policy.test.ts` — **this one is already done right**, and is the model to copy | — |
| Acceptance criteria written untestably | Caught late, by the red-baseline gate | Spec validation that rejects criteria with no observable predicate |
| Context handed to a worker is too large or too small | Judgement | Measure it: prompt size is already known per run; correlate with attempts-per-task |

### Where automation is the wrong answer

Not everything should be automated, and proposing otherwise is a failure mode
of its own:

- **Merge approval.** A human reading the diff is the last line of defence
  against plausible-but-wrong code. Nothing in this system may merge itself,
  ever, and no measured improvement in throughput justifies changing that.
- **Architectural decisions.** These are cheap to make and expensive to unmake.
  Leave them slow.
- **Anything used once.** A script for a one-off is a maintenance liability with
  no payoff. Twice is a pattern; once is a Tuesday.
- **Anything whose failure is silent.** An automation that fails quietly is
  worse than the manual step it replaced, because now nobody is watching.

## 7. How to review this system

If you have been asked to critique or improve the agent workflow, this is the
protocol.

**Read, in order:** this file → `architecture.md` → `state-machine.md` →
`permissions.md` → `threat-model.md`. Then `agentlib/state.py` and
`agentlib/guard.py`, which are the two files where being wrong matters most.

**Then gather evidence before proposing anything:**

```bash
python .ai/bin/agentctl.py status            # where tasks are stalling
python .ai/bin/agentctl.py telemetry report  # where cost goes
git log --oneline origin/main..              # what agents produced
cd .ai && python -m pytest -q                # is the core actually sound
```

**Ask these questions:**

1. **Where is a model doing a script's job?** Every one of these is pure cost
   and variance.
2. **Where is a rule stated but not enforced?** Cross-check every "must" in
   `.ai/prompts/` against `policy.json` and the guard. `permissions.md`'s
   not-enforced list should be complete — if you find something missing from
   it, that is a finding.
3. **Where could an agent's failure be silent?** Trace every path that does not
   end in a state transition or a CI result.
4. **What does a human still do by hand, more than once?**
5. **What would break if a run were cancelled right here?** Pick a state at
   random. The answer should always be "nothing; the next orchestrator run
   picks up from `state.json`". If it is not, that is a bug.
6. **Is the system still readable?** If your change makes the workflow harder
   for a person to follow end to end, it needs to buy a lot.

**A good proposal states:**

- the trace it came from, with numbers
- which grade of enforcement it achieves (impossible / detected / escalated)
- what it costs — CI minutes, tokens, complexity, and what it makes harder
- how you would know afterwards whether it worked
- what it would take to reverse it

**A bad proposal** adds an agent, adds a framework, adds a speculative
abstraction for a case that has not occurred, or replaces a working
deterministic check with a smarter model.

## 8. Things deliberately not done

Recorded so they are not re-proposed without new information:

- **No custom orchestration engine.** GitHub Actions plus small scripts plus
  structured state is sufficient and legible. A bespoke engine would be a
  second system to maintain and debug.
- **No agent-to-agent conversation.** Agents communicate through committed
  repository state. Conversational handoff is lossy, unauditable, and makes the
  workflow depend on a session staying alive.
- **No long-lived agent processes.** Every worker starts, does one step, and
  dies. Nothing to supervise, nothing to leak, nothing to get stuck.
- **No self-modification.** An agent cannot change `.ai/`, `.github/`, or its
  own permissions. Not with review, not with a flag. Changes to the system come
  from a human-reviewed PR from outside the agent branch namespace.
- **No auto-merge.** See above; this one is load-bearing.
- **No speculative skills or roles.** Three real skills beat nine empty ones.
  Add a role when a task cannot be expressed with the existing ones, not when
  one seems architecturally tidy.

## 9. The measure of success

Not "the agents wrote a lot of code". The pipeline is working when:

- **Cost per successful task** is falling, while the escalation rate holds or falls.
- **Human interventions per task** is falling, and the ones that remain are
  genuinely judgement — architecture, priorities, trade-offs — not mechanics.
- **The diff between what an agent produced and what was merged** is shrinking.
- **Nothing has ever reached `main` that a human did not approve.**

That last one is not a metric that improves. It is a metric that must never
change.
