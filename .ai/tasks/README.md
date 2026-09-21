# Tasks

One directory per unit of work:

```
.ai/tasks/<TASK-ID>/
├── task.json    the contract. Machine-read, validated, security-relevant.
├── brief.md     prose for the Manager. Nothing parses it.
└── state.json   workflow state. Written by the orchestrator, never by hand.
```

`<TASK-ID>` is `^[A-Z][A-Z0-9]{0,15}-[0-9]{3,5}$` — it is used verbatim as a
directory name and as the branch segment in `agent/<TASK-ID>`, so it is
validated rather than trusted.

## task.json is a security document

`allowed_paths` and `forbidden_paths` are enforced by `agentctl guard check` in
CI. Writing them is the Director's job and reviewing them is the human's. A
spec cannot grant `.ai/`, `.github/`, `wiki/GeneralContext/` or `**` — the
validator rejects it, and the guard would reject it again.

Keep `allowed_paths` as narrow as the task genuinely needs. It is the blast
radius of every agent this task dispatches.

## Creating one

```
python .ai/bin/agentctl.py task new AUTH-017
# edit task.json and brief.md
python .ai/bin/agentctl.py task validate AUTH-017
```

Then commit it through an ordinary human-reviewed PR. Specs live on `main`
before a task starts; the orchestrator creates the branch and `state.json` when
it runs.

## Writing acceptance criteria

They become tests, so write them the way you would write an assertion:
observable, specific, one behaviour each. "Authentication works" is not a
criterion. "A refresh token that has already been used returns 401" is.

Include the criteria that protect what already works, not only the new
behaviour — a code agent optimising for green tests will happily break
something no test pins.

## state.json

Written only by `agentctl`, only by the orchestrator, on the task branch. Read
it with `agentctl state show <ID>` and the whole board with `agentctl status`.
To intervene, use `agentctl state control <ID> --set PAUSE|RUN|CANCEL` rather
than editing the file — the CLI is the only path that validates the result.
