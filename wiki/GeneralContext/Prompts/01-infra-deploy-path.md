# 01 — The deploy path (`INFRA-002`, `INFRA-003`)

> **Completed.** `INFRA-002` merged as #72 and `INFRA-003` as #73, and both
> ran in the first deploy (2026-09-30): the SPA is uploaded by the
> `BucketDeployment`, and the migration function returned a head revision.
> Do not re-run this prompt. The agent board still shows both as `DRAFT`,
> because they were built in Director sessions, which do not move it.

**Objective:** land both. They are the only two things blocking a first deploy
that does anything — nothing uploads `dist/` to the frontend bucket, and nothing
applies the schema to RDS, so today a deploy serves an empty site over an empty
database.

**Read:** `00-session-protocol.md`, then `.ai/tasks/INFRA-002/` and
`.ai/tasks/INFRA-003/` with the contracts each names in `required_context`, and
`.ai/skills/infra-cdk/SKILL.md`.

They are independent — run them in parallel, one unit per worktree, each on its
own `agent/INFRA-00N` branch cut from `origin/main`.

Synth only. One PR per unit. Merge nothing.
