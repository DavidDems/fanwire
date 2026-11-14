---
type: runbook
---

# Incident Runbook

**Human-facing.** What to do when GuardDuty or an alarm fires, how to roll back
a deploy, and how to restore the database. It names the real credentials,
entry points and data stores, and gives a concrete containment sequence for
each. Physical resource names are CloudFormation-generated and change if a
resource is replaced, so every step names the **stack and logical id** and
gives the lookup command.

Every command is a single line of PowerShell (`TODO/README.md`, "Commands in
this folder are PowerShell, one per line"), run with the `fanwire-workload`
SSO profile after signing in:

```powershell
aws sso login --profile fanwire-workload
```

## Parts

- [Response](incident-runbook-response.md): the trigger, the priority order of
  suspicion, the response steps and the containment sequences.
- [Roll back a deploy](incident-runbook-rollback.md): a red smoke check after a
  deploy, the migration to rule out first, and re-running the last good
  deploy.
- [Restore the database](incident-runbook-restore.md): the restore drill, step
  by step, and its log.
- [Inventory](incident-runbook-inventory.md): the deployed resources by stack,
  the alarms and the first look for each, and the known gaps.
