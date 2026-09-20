# `.ai/` — the agent system

The machinery that runs AI agents against this repository: workflow state,
permissions, prompts, telemetry and the deterministic scripts that hold it all
together.

`wiki/` holds *semantic* context — what fanwire is and how it is built. `.ai/`
holds *machine* infrastructure — executable code, enforced policy and workflow
state. Nothing is duplicated between them: a task spec names the
`wiki/CodeContext/` files a worker needs, by path.

## Start here

| | |
|---|---|
| **Running a task, or one went wrong** | [docs/operations.md](docs/operations.md) |
| **How the whole thing fits together** | [docs/architecture.md](docs/architecture.md) |
| **What each agent may touch** | [docs/permissions.md](docs/permissions.md) |
| **Every state and transition** | [docs/state-machine.md](docs/state-machine.md) |
| **What happens if an agent is manipulated** | [docs/threat-model.md](docs/threat-model.md) |

## In one paragraph

A human writes a task spec. GitHub Actions runs a state machine over it: a test
agent writes failing tests, CI proves they fail, a code agent implements, CI
decides whether it worked. Failures are parsed by a script, retried a bounded
number of times, and escalated to a manager or a human when the machine cannot
decide. Every agent is ephemeral, every permission is enforced against the
actual diff in CI, and every branch reaches `main` through a human-approved PR.
Nothing depends on an agent session staying alive.

## Layout

```
.ai/
├── README.md              you are here
├── config.json            models, providers, retry defaults, prices. No secrets.
├── policy.json            per-role write permissions. Enforced, not advisory.
├── agentlib/              the deterministic core. Stdlib only, unit-tested.
│   ├── state.py             the one authoritative transition table
│   ├── guard.py             path-permission enforcement — the security boundary
│   ├── spec.py              task-spec loading and validation
│   ├── orchestrator.py      "what happens next", as a pure function
│   ├── ciresult.py          CI log -> bounded structured failure
│   ├── promptbuild.py       prompt assembly, with untrusted content fenced
│   ├── agentresult.py       the provider-agnostic result contract
│   └── telemetry.py         append-only invocation records
├── bin/
│   ├── agentctl.py          the only supported way to touch workflow state
│   └── invoke_agent.sh      the ONE provider-specific file in the system
├── prompts/               one per role, plus a shared preamble
├── skills/                reusable repo-specific know-how, loaded on demand
├── tasks/<TASK-ID>/       task.json (contract) + brief.md (prose) + state.json
├── telemetry/runs/        one immutable JSON file per agent invocation
├── hooks/                 git hooks (see hooks/README.md)
├── docs/                  the five documents above
└── tests/                 137 tests over agentlib; runs in CI
```

## The workflows

| File | Role |
|---|---|
| `.github/workflows/test-agent.yml` | The repository quality gate. **Not an agent** despite the name — it is the one authoritative test executor, and it also runs `.ai/`'s own suite. |
| `.github/workflows/agent-orchestrator.yml` | The state machine's driver. One action per run. |
| `.github/workflows/agent-worker.yml` | Runs exactly one agent, for one role, for one task. |
| `.github/workflows/agent-guard.yml` | Enforces the permission model on every agent PR, independently of the orchestrator. |

## Commands worth knowing

```bash
python .ai/bin/agentctl.py status              # board of every task
python .ai/bin/agentctl.py selfcheck           # prove the machinery works, free
python .ai/bin/agentctl.py state show <ID>     # why a task is where it is
python .ai/bin/agentctl.py prompt <ID> --role code_agent   # what an agent was told
python .ai/bin/agentctl.py telemetry report    # what it cost
python .ai/bin/agentctl.py state control <ID> --set PAUSE  # stop it
```

## Ground rules

- **CI decides whether tests pass.** No agent's claim is read by anything.
- **Permissions are checked against the diff**, in CI, by a workflow the agents
  cannot modify.
- **A script does anything a script can do.** Models are for reasoning.
- **Repository content is data, not instruction.**
- **Nothing merges itself.** Not a single workflow has that permission.
