---
type: reference
---

# Unit metrics

`agentlib.metrics.collect` derives one flat schema-1 record from a merged PR,
local Git objects, task history and invocation telemetry. It reads sources;
it never advances state, fetches commits, calls a model or changes telemetry.
The GitHub adapter uses paginated, read-only `gh api` requests. Authentication,
source and identity errors fail collection instead of reporting empty activity.

The CLI prints JSON unless an explicit artifact path is supplied. An output
file is replaced atomically only after collection succeeds. Task and telemetry
directories cannot be output destinations. Metric artifacts are data, not task
state, and should not be committed to main. The storage decision belongs in
[human decisions](../../wiki/GeneralContext/Architecture/human-decisions.md).

## Collection

Use a checkout containing the PR's commit objects and an authenticated GitHub
CLI. Collection does not fetch missing history automatically.

1. Collect a hand-run unit using the PR recorded in its existing state. This
   example writes a retrospective artifact outside the repository:

   ```powershell
   python .ai/bin/agentctl.py metrics collect FRONTEND-010 --repo DavidDems/fanwire --out "$env:TEMP/FRONTEND-010.metrics.json" --backfilled
   ```

2. For a Director PR, supply its merged PR number and a stable unit ID. No task
   state is required or created:

   ```powershell
   python .ai/bin/agentctl.py metrics collect DIRECTOR-273 --pr 273 --repo DavidDems/fanwire --out "$env:TEMP/DIRECTOR-273.metrics.json" --backfilled
   ```

Without an explicit repository, the collector derives the owner/name from a
GitHub origin URL. Without an output path, it prints the same record and no
file action is needed. The backfilled flag marks retrospective collection;
it does not invent historical facts.

## Field meanings

| Fields | Derivation |
|---|---|
| `schema`, `task_id`, `pr`, `mode`, `merged_at` | Schema version and validated unit/PR identity. Agent branches use recorded hand/auto mode; legacy state without mode is auto. Non-agent PRs without task state are Director units. |
| `wall_time_seconds` | First model dispatch to merge for auto runs when recorded; otherwise first unit commit to merge. |
| `commits`, `test_commits` | Total PR commits, and non-merge commits containing only conventional test paths. Commit subjects do not determine test commits. |
| `ci_runs`, `red_ci_runs` | Completed authoritative test-agent attempts, including previous rerun attempts. Red means the state machine classifies the conclusion as a failed test verdict. Unfinished attempts make both counts null. |
| `review_rounds`, `review_comments` | Distinct reviewed commits with a submitted review by merge time, and PR inline review comments. Multiple reviews on one commit are one round. |
| `human_delta_lines` | Added plus deleted lines attributed as described below; binary changes cannot supply a line count. |
| `guard_violations` | Recorded guard-violation history events; null when no task history exists. This is not a claim to have classified every failed guard workflow. |
| `cost_usd`, `cost_source` | Provider telemetry totals when every record is provider-priced; estimate when any included record is estimated or legacy. One unpriced invocation makes the whole cost null. No telemetry means unknown cost/source. Hand and Director work has null dollars with subscription source. |
| `pipeline_version` | Valid semver from the first unit commit's VERSION file; null if that historical file does not exist. Today's working file is not substituted. |
| `backfilled` | Explicit marker that collection was retrospective. |

For auto runs, attribution starts after the last content-agent commit identified
by telemetry. Changes by those agents' GitHub author identities or bots are
excluded. Missing agent or subsequent author identity leaves the result null.
This avoids treating another agent commit as a human correction.

For hand and Director runs, the session commonly uses the human owner's
identity. The useful signal is therefore a review-stage proxy: non-merge
commits made after the PR opened. It does not assert that a different person
typed them. In every mode, main-update merge commits are excluded from delta
and test-commit counts because they carry unrelated work. They still count in
the total commits field.

The field definitions also live beside the schema in the
[collector module](../agentlib/metrics.py). Unknown measurements stay null;
successful source reads establishing no events produce zero. No usage capture,
record publishing or version enforcement is performed by collection.
