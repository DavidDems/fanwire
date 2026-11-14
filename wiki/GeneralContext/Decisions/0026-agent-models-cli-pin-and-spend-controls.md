---
type: decision
---

# 0026 - Agent models, CLI pin and spend controls

Decision: 2026-10-08, the human.

## Context

The 2026-10-08 workflow review queued three things beside its defect fixes:
newer models were available at the same price, the provider CLI was installed
unpinned (`.ai/docs/handoff.md` §5.6), and nothing capped what the API key
could spend if a loop ran away.

## Choice

- **Models.** The Sonnet roles move to `claude-sonnet-5-5`, at the same price as
  Sonnet 5, and the Manager to `claude-opus-5-5`.
- **The provider CLI is pinned** to one exact version, at
  `providers.anthropic.cli_version` in `.ai/config.json`. Renovate's
  `claude CLI` pull request bumps it, labelled `recheck-d2b-flags`: before
  approving, confirm the new CLI still accepts the flags worker isolation
  starts it with ([ADR 0002](0002-worker-credential-isolation.md)).
- **Spend controls, set by the human:**

  | Account | Control |
  |---|---|
  | Claude Console (`ANTHROPIC_API_KEY`) | Monthly spend limit $40; auto-recharge to $15 when the balance is below $5. The limit, not the balance, is what stops a runaway loop. |
  | TypeSafe (`TYPESAFE_API_KEY`) | About $10 of credit; no limit configured. |

- **Cost is read from the provider's own figure**, recorded in
  `.ai/telemetry/` ([ADR 0005](0005-provider-cost-telemetry.md)), not from
  differences between account balances.

## Consequences

- The model move is decided and not applied: the roles in `.ai/config.json`
  are `claude-sonnet-5` and `claude-opus-5`, and `TODO/02-backlog.md` item 11
  holds the change.
- `agent-worker.yml` installs the pinned version and refuses to run if the CLI
  reports another. What Renovate opens is
  [github-automation-setup-renovate.md](../Architecture/github-automation-setup-renovate.md).
- `agentctl telemetry report` gives a run's cost. Model cost is the only
  metered cost while the repository is public; Actions minutes are not.
