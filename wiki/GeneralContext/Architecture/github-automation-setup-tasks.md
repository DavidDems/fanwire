---
type: runbook
---

# GitHub automation setup: running a task

Part of [GitHub automation setup](github-automation-setup.md). Full
operational detail is in `.ai/docs/operations.md`; this is the short form.
Starting a task is the human's call
([ADR 0023](../Decisions/0023-human-gates-on-agent-work.md)).

## Running and stopping a task

Branch from `origin/main` **explicitly** — `git switch -c <name>` alone branches
from whatever HEAD happens to be, which can put one task's mid-flight state on
`main`. Run these in order:

```powershell
git switch main; if ($?) { git pull }
```
```powershell
git switch -c agent/<TASK-ID> origin/main; if ($?) { git push -u origin agent/<TASK-ID> }
```
```powershell
gh workflow run agent-orchestrator.yml -f task_id=<TASK-ID>
```

Watch it without opening an agent session. State lives on the task branch, so
pull first or you are reading a stale file:

```powershell
git pull
```
```powershell
python .ai/bin/agentctl.py status
```
```powershell
python .ai/bin/agentctl.py state show <TASK-ID>
```
```powershell
python .ai/bin/agentctl.py telemetry report
```

Pause, resume, or cancel a task, one of:

```powershell
python .ai/bin/agentctl.py state control <TASK-ID> --set PAUSE
```
```powershell
python .ai/bin/agentctl.py state control <TASK-ID> --set RUN
```
```powershell
python .ai/bin/agentctl.py state control <TASK-ID> --set CANCEL
```

The emergency stop, if something runs away. The state file stays accurate while
they are off, and `gh workflow enable` resumes exactly where it stopped:

```powershell
gh workflow disable agent-orchestrator.yml
```
```powershell
gh workflow disable agent-worker.yml
```

## What a task costs, and the spend controls

A run's cost is the provider's own figure, which `.ai/telemetry/` records
([ADR 0005](../Decisions/0005-provider-cost-telemetry.md)); `agentctl telemetry
report` above prints it. A small backend task through the pipeline costs about
USD $2–3 ([work-modes.md](work-modes.md)).

The spend controls are
[ADR 0026](../Decisions/0026-agent-models-cli-pin-and-spend-controls.md): a
Claude Console monthly limit of $40, which is what stops a runaway loop, and
about $10 of TypeSafe credit with no limit.

Model cost is separate from Actions minutes, and is the only one that is
metered while the repository is public.
