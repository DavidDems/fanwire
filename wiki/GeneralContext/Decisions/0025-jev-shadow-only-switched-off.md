---
type: decision
---

# 0025 - jev: direct route, shadow only, switched off

Decision: 2026-10-07 and 2026-10-08; switched off 2026-10-16, the human.

## Context

`jev` is TypeSafe's "System One" typed-decision model: it answers a narrow,
typed question with a confidence. The human wanted it incorporated into the
agent workflow as a decision layer. There were two routes to it: a direct
TypeSafe key, or the Vercel AI Gateway that the parked `jev-decision-layer`
branch pointed at, which never returned a 200. A model's answer cannot be
trusted with a task's state before its agreement with the existing decision
is on record. The Manager had never been invoked, so shadowing it needed a
deliberately failing task (`.ai/docs/handoff.md` §6, item 3) to have anything
to compare.

## Choice

- **The direct route.** `api.typesafe.ai`, model `jev-latest`, with the key in
  the repository secret `TYPESAFE_API_KEY` (stored 2026-10-08). Not the gateway
  route.
- **Shadow mode only.** `jev` is asked beside the model that decides, its
  answer is recorded and never applied, and it is promoted only after enough
  recorded agreement. Unreachable or low confidence means `ESCALATE`.
- **Flake forgiveness by model confidence is declined.** A deterministic single
  CI re-run on an `infrastructure`-origin failure does that job without
  loosening a budget on a model's confidence.
- **Spec readiness:** a deterministic validator first, `jev` advisory at most.
- **Switched off on 2026-10-16.** It answered `no` to all 9 questions it was
  asked in shadow, and the human turned it off. It is not re-enabled unless
  the human asks.

## Consequences

- The seam stays wired: `.ai/bin/ask_jev.py` on the direct route, and the
  dispatch-only `.github/workflows/jev-smoke.yml`. The cheap automations that
  asked it in shadow carry `automations.<name>.ask_jev: false` in
  `.ai/config.json` (`coverage`, `spec_drift`).
- `TYPESAFE_API_KEY` is read only by `ask_jev.py`
  ([github-automation-setup-secrets.md](../Architecture/github-automation-setup-secrets.md)).
  Its credit and limit are [ADR 0026](0026-agent-models-cli-pin-and-spend-controls.md).
- How the cheap automations use a model is
  [work-modes.md](../Architecture/work-modes.md) "Cheap automation".
