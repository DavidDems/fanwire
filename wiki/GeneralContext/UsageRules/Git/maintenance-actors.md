# Maintenance actors (git-triggered automation)

Reference for what each git-event workflow does and must not do. Full category rules: `wiki/GeneralContext/UsageRules/AgentType/3-scripted-execution.md` (workflows below) and `4-scheduled-maintenance.md` (cron).

| Actor | Trigger | Category | Output |
|---|---|---|---|
| Pre-commit hook | every commit | — | blocks the commit, doesn't run as an agent |
| `.github/workflows/test-agent.yml` | push to `/tests` | 3 | `wiki/GeneralContext/Reports/test-runs/` |
| `.github/workflows/pr-review-agent.yml` | PR opened | 3 | `wiki/GeneralContext/Reports/`, PR comment |
| Merge-to-main workflow | merge to `main` | 3 | reconciles wiki hex refs with the merged diff |
| `.github/workflows/context-audit.yml` | cron, weekly | 4 | `wiki/GeneralContext/Reports/maintenance/`, PR/report for review |

## MUST NOT
- Any of these actors merging their own output — see `wiki/GeneralContext/UsageRules/Git/branch-protection.md`.
- Any of these actors running with a context wider than their row above.
