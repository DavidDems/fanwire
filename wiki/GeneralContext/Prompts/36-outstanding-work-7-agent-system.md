---
type: prompt
---

# 36 — Outstanding work, track 7: key-free agent-system checks and metrics

**Brief for a Director session.** Shared rules: [29](29-outstanding-work.md).

**Objective:** finish the pipeline items that cost no API spend, and mark the
rest parked ([ADR 0035](../Decisions/0035-outstanding-work-answers.md)). Every
edit is in a restricted tree: name each in the PR body.

## Read first, in this order

1. `TODO/02-backlog.md` "Agent system" items 18, 19, 20 and the roadmap table.
2. `Prompts/11-metrics-every-mode.md` and `.ai/docs/metrics.md`.
3. `.ai/docs/handoff.md` §10 and `handoff-live-proof.md`.

## Where things stand (2026-11-17), verify, don't trust

- The metrics publisher's first scheduled run in this repository passed on
  2026-11-14; check the latest runs
  (`gh run list --workflow metrics-publish.yml`).
- `Prompts/04`, `12`, `13`, `14` and `15` carry no note that they are parked.

## Deliverables (one Director PR each, test first)

1. **Mark the parked briefs.** A dated Update line at the top of
   `Prompts/04`, `12`, `13`, `14` and `15`: parked for API cost, with a link
   to the ADR. Do not delete them.
2. **Metrics deliverable 4:** `VERSION` and a changelog with a deterministic
   check, as `Prompts/11` describes.
3. **Metrics deliverable 5:** reporting, as `Prompts/11` describes, key-free.
4. **Spec validation (item 18):** reject an acceptance criterion with no
   observable predicate.
5. **A CI check that a PR's base is `main` (item 19).** Add a structural
   assertion in `.ai/tests/test_workflows.py`; run the whole `.ai` suite.
6. **Local guards (item 20):** `agentctl selfcheck` asserts each workspace's
   `node_modules` is installed; refuse `git stash` in agent sessions; a port
   pre-flight before `docker compose run`.
7. **Close-out.** Delete `Prompts/11` and the roadmap rows that are done;
   update `handoff.md` §10 and the index.

## Mechanics learned the hard way

- `.ai/tests` pins workflow content: run the suite after any `.github` edit.
- Strip every `GIT_*` variable in tests that shell out to git.
- A new dispatch-only workflow cannot run before merge: gate its first use.
