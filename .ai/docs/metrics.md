---
type: reference
---

# Unit metrics

`agentlib.metrics.collect` derives one flat schema-2 record from a merged PR,
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
CLI. The standalone collector does not fetch missing history automatically.
The publication wrapper fetches validated numeric PR head refs as Git objects
before invoking the trusted collector, covering squash and rebase merges.

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
| `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `num_turns`, `usage_source` | Validated hand-session counters recorded at finish, with `claude_transcript` provenance. Missing legacy hand evidence produces null fields. These fields are also null for auto and Director units; this schema does not aggregate auto token telemetry. |
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
successful source reads establishing no events produce zero. Collection consumes
stored hand usage but does not read transcripts or enforce versions. Publication
is a separate boundary described below.

## Hand-session usage

The optional capture reads explicitly selected local Claude Code JSONL files.
It records only four token counters, completed assistant turns and the source
label in `hand_usage`; transcript text, paths and identifiers are not stored or
printed. Subscription dollars remain null. No model or price estimate is used.

`input_tokens` is uncached input; cache creation and cache reads are separate
input counters. `num_turns` counts unique completed assistant request/message
pairs, including tool-use turns, rather than user prompts. Repeated content
chunks and overlapping parent/subagent files count once. Streaming output
snapshots are cumulative: the greatest output count must have a completed
snapshot, while input and cache counters must agree for that identity.

1. Select only transcripts dedicated to the unit, after its model work has
   stopped. Include every contributing parent and subagent file explicitly;
   there is no automatic session selection or subagent discovery. Finish on
   the task's own agent branch. Replace TASK-001, 123 and the example paths
   below with the unit ID, its real PR number and the selected local paths:

   ```powershell
   python .ai/bin/agentctl.py hand finish TASK-001 --pr 123 --usage-transcript "C:/sessions/unit-parent.jsonl" --usage-transcript "C:/sessions/unit-subagent.jsonl"
   ```

2. If evidence is unavailable, unsupported, incomplete, or shared between
   several tasks, omit capture and record unknown usage. A transcript cannot
   establish how to allocate a multi-task session, and this tool never guesses:

   ```powershell
   python .ai/bin/agentctl.py hand finish TASK-001 --pr 123
   ```

Omitting capture stores `hand_usage: null`; older absent fields also mean
unknown. An explicitly selected unreadable or malformed file, absent counters
or identities, incompatible duplicate input, or an unfinished maximum fails
the command without modifying state. Errors expose no transcript data. Report
why usage is unavailable rather than substituting zero or an estimate. No
production task record is changed merely by installing this capture support.

## Data-branch publication

`metrics-publish.yml` collects on closed, merged same-repository `agent/*` PRs
targeting main. A daily run and optional manual dispatch perform bounded
catchup. Director PRs are outside this trigger; their explicit collector
interface remains available. No model, paid call or model key is used.

The collector verifies the current PR detail against its number, repository,
head task ID, main base and recorded task identity before collection. A
recorded PR must agree. Legacy auto state can lack a PR: the merge event can
supply it, while catchup discovers exactly one closed, merged same-repository
PR for that exact task head, then independently verifies its detail. No match
or an unmerged match is skipped; multiple merged matches fail. State is never
repaired or advanced by publication.

Catchup validates existing records before skipping their IDs and checks for
task/PR conflicts. Ordinary files such as the task-directory README are skipped;
symlink task paths are rejected. Remaining candidates are sorted by task ID,
then a bounded window rotates by the nonnegative `--scan-offset` modulo the
remaining candidate count. The workflow derives that offset from its trusted
run counter in steps of 50, so abandoned or unmerged prefix tasks cannot
permanently hide later candidates behind a fixed prefix. Each run attempts at
most 50 candidates; collected records are marked `backfilled: true`. The CLI
defaults to offset zero, while merge events collect their explicit unit without
rotation. No cursor or other nonrecord state is stored. A failed source
read or invalid collected record fails the whole batch before any artifact is
exposed. Unknown measurements retain the collector's nulls. Source content,
transcripts and raw errors never become publication error messages.

The `metrics` branch holds only `records/<TASK-ID>.json`, each the exact flat
schema-2 record above. No extra private fields, nested trees, unsafe filenames
or symlinks are accepted. The first publication creates an empty orphan
metrics branch when it is absent, without copying main's files. A clean
checkout on the exact metrics branch is mandatory. New records append;
semantic-identical repeats do nothing. Different data for an existing ID
fails without overwriting that file. Concurrent stale writers fail their
ordinary push; there is one push, no force and no automatic conflict retry.

Collection has read-only contents, pull-request and Actions permissions.
Publication runs in a fresh job with only `contents: write`. Its tools checkout
is pinned to the SHA collected from trusted main, separately from the metrics
data checkout. Both disable persisted credentials; PR code and data-branch
code are never executed. The current-run `metrics-records` artifact contains
only validated JSON; default
[artifact download authentication](https://github.com/actions/download-artifact)
needs no additional Actions permission or explicit token override.

The wrapper uses isolated Python and the executing tools checkout's collector;
the source root is passed as data. Git hooks are disabled, inherited `GIT_*`
routing is removed, and write credentials reach only the one push through
transient child configuration, never command arguments or on-disk config.
Main, task state and telemetry are never publication destinations.

No ruleset setting change is needed: the repository's main-only ruleset
excludes metrics. The first live proof of artifact transfer, bootstrap and
GitHub push permissions must wait until the workflow lands on main; local
bare-repository tests do not prove those remote permissions. No manual action
is needed before merge. After merge, a scheduled run or eligible task merge
can establish that proof; manual dispatch is optional.
