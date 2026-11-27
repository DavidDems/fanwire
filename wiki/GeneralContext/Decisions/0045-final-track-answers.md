---
type: decision
---

# 0045 - The final track's answers, and the docs graph as its own track

Decision: 2026-11-27, the human, after Outstanding-work track 8 finished and a
search of the docs for documented but unbuilt features.

## Context

The eight Outstanding-work tracks are done. The search found five leftovers
(a deferred database-credential change, accessibility rows left NOT DONE, an
auth message gap, a dialog focus gap, and an untimed image pipeline) and no
graph of links between docs, specs and code: `agentctl docs inventory` lists
inbound links per file, and `Prompts/15` (parked: it was built around
API-spend evals) describes a larger code graph.

## Choice

- **A final track runs before the results scraper**
  ([Prompts/48](../Prompts/48-outstanding-work-final.md)): the five leftovers
  and a second revision of the docs for anything stale about the
  Outstanding-work tracks.
- **Database credentials: a cold-start read, cached.** The Lambdas read the
  RDS secret from Secrets Manager once per cold start and build the URL in
  memory, instead of `DATABASE_URL` assembled from a dynamic reference. One
  narrow `secretsmanager:GetSecretValue` per function, no rotation yet.
- **Accessibility rows: `axe-core` as a dev dependency**, injected from
  `node_modules` by a host Playwright script on localhost (a Director PR adds
  the dependency). The Windows contrast-theme check stays the human's.
- **Unmapped Cognito codes: one generic fixed message**, never the provider's
  text, so account existence cannot leak. A test pins it for every unmapped
  code.
- **The docs graph is a separate track**, after the final track
  ([Prompts/49](../Prompts/49-docs-graph.md)): a generated, deterministic,
  API-free graph of docs, specs and code paths with a query command, an orphan
  report for `wiki-review` and a CI staleness check. The code-to-code part of
  `Prompts/15` stays parked.

## Consequences

The database change is deploy-affecting and follows the usual approval and
migration check. `frontend/package.json` and `infra/` edits are Director PRs
(dependency manifests are not unit-writable). `Prompts/15` stays parked and
is not the graph track's brief.
