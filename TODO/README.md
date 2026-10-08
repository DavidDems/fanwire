# TODO — what is left

**Human-facing.** `01` is tasks that need a person: an account, a credential, a
purchase, a judgement call, or a click in a console. `02` is the remaining
build work, collected in one place so nothing is lost between the prompts and
plans that found it; each item becomes a task spec when it is run.

The rest of the repository is written for agents (`wiki/`, `.ai/`, `AGENTS.md`).
This folder is written for you.

## Files

| File | What it covers |
|---|---|
| [`01-for-you.md`](01-for-you.md) | Only you can do these: the `jev` key as a secret (after the workflow review), the API credit balance, watching the live site, axe on every route, SES reapplication (optional, later) |
| [`02-backlog.md`](02-backlog.md) | What is left to build, as small units for the automated workflow once the review lands. Not human-only, but kept here so the remaining work is one list |

**Status as of 2026-10-07.** The frontend is finished (`FRONTEND-007`, #114),
so the files that tracked getting there were deleted: `02` (deployment; the
deploy path is finished and its record is in
`wiki/CodeContext/Modules/0x00-architecture.md`), `03` (open decisions; the
last one, which browser tool sessions may drive, was answered by Playwright
MCP and is in `wiki/GeneralContext/Architecture/human-decisions.md` §3) and
`04` (the first deploy; its traps are now
`wiki/GeneralContext/Architecture/deploy-traps.md`). The project's focus is
back on the automated agent workflow:
`wiki/GeneralContext/Prompts/01-agent-workflow-review.md`.

This folder is doing what it was supposed to: shrinking. A completed item does
not stay here as a tick — it becomes current-state fact in the wiki and the entry
is removed, because a checklist of done things is a place where stale facts hide.

## Commands in this folder are PowerShell, one per line

**A standing rule, for every file here and every one added later.** The person
reading this folder works in PowerShell on Windows. So:

- **Every command is a single line.** No line continuations, no `\` wrapping.
  A command that needs three lines gets written as three separate one-line
  commands instead.
- **PowerShell syntax, not `sh`.** No `&&`, no `$(date +%s)`, no `sed`/`grep`
  pipelines, no `VAR=x cmd` prefixes, no here-documents.
- **No shell scripts.** Not a `.sh` file, not a multi-line block meant to be
  pasted as one unit. If something genuinely needs a script, it belongs in the
  repository as a checked-in tool with its own tests, not as prose here.
- Fences are marked ```` ```powershell ````.

The translations that come up most:

| `sh` | PowerShell |
|---|---|
| `a && b` | `a; if ($?) { b }` |
| `a; b` (unconditional) | `a; b` |
| `$(date +%s)` | `(Get-Date -UFormat %s)` |
| `VAR=1 cmd` | `$env:VAR=1; cmd` |
| `cmd > /dev/null` | `cmd > $null` |
| `x | grep foo` | `x | Select-String foo` |

This is not a style preference. A `sh` one-liner pasted into PowerShell either
fails loudly or — worse — half-succeeds: `--caller-reference "fanwire-$(date +%s)"`
ran with the literal text `fanwire-` after `Get-Date` threw, and the Route 53
zone was created with a broken idempotency token that nobody noticed.

## How to use it

Work top to bottom within a file. Each item states **why** it is needed, **what
to do**, and **how to confirm it worked** — so you are never left wondering
whether a step took.

When you finish an item, tick it and say where the answer lives if it produced
one (an id, a file, a console setting). When every item in a file is done,
delete the file. This folder should shrink.

## A note on where these came from

Items are collated from files elsewhere in the project, cited by path so you can
read the full context. Where an item's source is on an **unmerged branch**, it
says so — those are not yet facts on `main`.

The collation is manual and goes stale. If you find something here that
contradicts a wiki file, the wiki file wins and this folder is the bug.
