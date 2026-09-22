# Agent system — architecture

A small state machine whose workers happen to be language models.

Git is the durable history. GitHub Actions is the orchestrator. `agentctl` is
the only thing that changes state. Agents are ephemeral workers that start,
produce a commit, and terminate.

## The shape of it

```
Human ─► Director (interactive)
              │  writes .ai/tasks/<ID>/task.json, human-reviewed PR
              ▼
        agent-orchestrator.yml ◄────────────────────────┐
              │  agentctl next                          │
              │                                         │
    ┌─────────┼──────────┬───────────────┐              │
    ▼         ▼          ▼               ▼              │
 validate  run_ci   dispatch_agent    distill           │
    │         │          │               │              │
    │         ▼          ▼               │              │
    │   test-agent.yml  agent-worker.yml │              │
    │   (the real      (one model, one   │              │
    │    test suites)   role, one step)  │              │
    │         │          │               │              │
    └─────────┴──────────┴───────────────┴──────────────┘
                     every path ends by waking the orchestrator
```

Nothing waits for anything. Each run does one thing and exits; the thing it
started wakes the orchestrator again. A cancelled run, an expired session or a
dead runner costs one step, not the task.

## The five deterministic rules

**1. Git is the source of truth, not an agent's memory.** Everything needed to
continue a task is in `.ai/tasks/<ID>/`. A Manager session id may be recorded
and resumed as an optimisation, but the workflow is correct when every session
is gone. `test_e2e_workflow.py::TestStatelessReconstruction` pins this.

**2. CI is the only authority on whether tests pass.** `test-agent.yml` is the
existing repository quality gate and the agent system does not replace it,
wrap it, or add a parallel one. No agent's claim about test results is read by
anything.

**3. A script does anything a script can do.** Git operations, branch naming,
retry counting, state transitions, permission checks, CI-log parsing, token
accounting — all deterministic Python in `.ai/agentlib/`, all unit-tested. A
model is invoked for architectural reasoning, writing tests, implementing, and
interpreting genuinely ambiguous failures. Nothing else.

**4. Permissions are enforced, not requested.** `.ai/policy.json` plus the
task's `allowed_paths` are checked against the actual diff, in CI, by a
workflow the agents cannot modify. Prompts describe the boundary; the guard
*is* the boundary.

**5. Repository content is data.** Source files, comments, Markdown, test
output and CI logs are fenced and labelled before they reach a model. See
[threat-model.md](threat-model.md).

## Roles

| Role | Invoked | Does | Writes |
|---|---|---|---|
| **Director** | Interactively, by a human | Architecture, task specs, this system | `.ai/`, `wiki/`, via reviewed PR |
| **Manager** | Only when the machine cannot decide | Retry / re-scope / escalate | nothing |
| **Test Agent** | Once per task (or after a re-scope) | Turns criteria into failing tests | test paths |
| **Code Agent** | Up to `max_impl_attempts` | Makes the tests pass | production paths |
| **Distiller** | After a failed implementation run | Prose on a parsed failure | nothing |
| **Context Maintainer** | After a green run, if the spec asks | One module wiki file | `wiki/CodeContext/Modules/*.md` |

Full permission matrix: [permissions.md](permissions.md).

The Director is not in the loop for ordinary iterations. The Manager is not
invoked after every failure — only when the deterministic retry policy is
exhausted, or something structural happened. The expensive models are the ones
used least.

## Distiller: script first, model second

A failed CI run is parsed by `agentlib/ciresult.py` into failing test ids,
categories, relevant files and a likely origin — deterministically, with no
model and no cost. Only then is a cheap model asked to add one sentence of
`summary` per failure, and to propose an origin *if and only if* the
deterministic answer was `ambiguous`.

If that model call fails, the workflow continues on the parsed structure alone.
The retry never depends on it.

The distilled result is what reaches the code agent's retry prompt. Raw logs
never do: they are unbounded, expensive, and the most likely place for
adversarial text to enter a prompt.

## Context Maintainer: same branch, same PR

Three options were available: write directly to the wiki on `main`, open a
separate context PR, or commit onto the task branch. The third was chosen.

Direct writes to `main` would be unreviewed wiki edits. A separate PR splits a
code change from the documentation of that change across two reviews, and
doubles the merge surface for no benefit. Committing onto the task branch puts
the wiki edit in front of the person already reading the diff that motivated
it, and it lands or is rejected with that diff.

Its write permission is one file: `wiki/CodeContext/Modules/*.md`. Not
`Standards/`, not `GeneralContext/`, not code.

## Branches

```
main
└── agent/<TASK-ID>
```

One branch per task, cut from `main`. The test agent and the code agent both
work on it, at different stages. It reaches `main` through a human-approved PR.

**Never stacked.** Task branches are never cut from other task branches: a
stack merged top-down has already, in this repository, reported success while
none of its commits reached `main`.

Commits read:

```
DEMO-001 test: pin the version endpoint's response shape
DEMO-001 impl: add GET /health/version
DEMO-001 fix: read the version from package metadata
[agent-state] DEMO-001: dispatch_agent
```

## Zero-dependency deterministic core

`.ai/agentlib/` is standard-library Python 3.12 with no third-party imports.
It is the security and correctness boundary around every model invocation, so
it must run in any orchestrator step without an install, a lockfile, or a
parser someone else maintains.

This is also why task specs are JSON rather than YAML: `allowed_paths` is a
security control, and parsing it should not require a dependency. Prose lives
in `brief.md`, which nothing parses.

## Configuration hierarchy

Most specific wins:

1. `task.json` → `workflow_policy` — per task
2. `.ai/config.json` — per repository: models, providers, retry defaults, prices, feature flags
3. `.ai/agentlib/` constants — hard caps that 1 and 2 cannot raise (`HARD_MAX_ATTEMPTS`, `MAX_FAILURES`, `ALWAYS_FORBIDDEN`)

No secrets in any of them. `config.json` names the GitHub Actions secret that
holds a credential; it never holds the value.

## Provider independence

Two files are provider-specific, one per *kind* of call:

| Seam | Verb | Contract | Used by |
|---|---|---|---|
| `.ai/bin/invoke_agent.sh` | run an agent and let it work | `agentlib/agentresult.py` | roles that write code, tests or prose |
| `.ai/bin/ask_jev.py` | ask a bounded question | `agentlib/decision.py` | every typed decision |

Adding a text provider means a `case` branch in the first and an entry in
`config.json`. Adding a decision provider means the same in the second. Neither
touches `.github/workflows/` or the state machine.

They are separate because the calls are genuinely different shapes, not because
of vendor. An agent takes a prompt and returns prose that we have to parse and
then distrust. A System One model takes a state plus typed questions and returns
answers that cannot be outside the declared option set. Forcing the second
through the first would mean inventing a prompt file and a prose trailer for
something that has neither.

### What a System One model cannot do

It does not generate strings. That bounds where it is usable: it can make a
decision a role was being asked to make, but it cannot write the code, the
tests, the wiki page or the commit subject that role also produces. The split
is per *decision*, not per role — the Manager's choice between three options is
typed, while the sentence explaining an escalation is still an Opus call.

### Why the answers are re-checked anyway

`agentlib/decision.py` validates every answer against the caller's own option
set and a confidence gate, even though the provider guarantees schema
conformance. The wire is not the boundary; that module is. A guarantee made by
a remote service stops being true the day the endpoint is wrong, mocked or
replayed, and the failure would be a workflow event nobody declared.

Every gate falls back in the conservative direction: uncertainty costs a human
a minute, never the task's retry budget. `agentctl selfcheck` proves each
fallback is a value its own question can actually return — a check that matters
because a bad fallback is only reachable on the low-confidence path, which is
the path that is rarely exercised and always matters.
