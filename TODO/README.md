---
type: reference
---

# TODO — what is left

**Human-facing.** `01` is tasks that need a person: an account, a credential, a
purchase, a judgement call, or a click in a console. `02` is the remaining
build work, collected in one place; each item becomes a task spec when it is
run.

The rest of the repository is written for agents (`wiki/`, `.ai/`, `AGENTS.md`).
This folder is written for you.

## Files

| File | What it covers |
|---|---|
| [`01-for-you.md`](01-for-you.md) | Only you can do these: the API-SPORTS resources to delete by hand, the Kaggle token for `EVENTS-008`, watching each deploy and running its migration, rolling out IAM policy changes, axe on every route, SES reapplication (optional, later) |
| [`02-backlog.md`](02-backlog.md) | What is left to build, each item with its mode (`hand`, `auto` or `director`). Not human-only, but kept here so the remaining work is one list |

## Commands in this folder are PowerShell, one per line

**A standing rule, for every file here and every one added later.** The person
reading this folder works in PowerShell on Windows. So:

- **Every command is a single line.** No line continuations, no `\` wrapping.
  A command that needs three lines is three one-line commands.
- **PowerShell syntax, not `sh`.** No `&&`, no `$(date +%s)`, no `sed`/`grep`
  pipelines, no `VAR=x cmd` prefixes, no here-documents.
- **No shell scripts.** If something genuinely needs a script, it belongs in
  the repository as a checked-in tool with its own tests, not as prose here.
- Fences are marked ```` ```powershell ````.

| `sh` | PowerShell |
|---|---|
| `a && b` | `a; if ($?) { b }` |
| `a; b` (unconditional) | `a; b` |
| `$(date +%s)` | `(Get-Date -UFormat %s)` |
| `VAR=1 cmd` | `$env:VAR=1; cmd` |
| `cmd > /dev/null` | `cmd > $null` |
| `x | grep foo` | `x | Select-String foo` |

This is not a style preference. A `sh` one-liner pasted into PowerShell either
fails loudly or half-succeeds: `--caller-reference "fanwire-$(date +%s)"` ran
with the literal text `fanwire-` after `Get-Date` threw, and the Route 53 zone
was created with a broken idempotency token that nobody noticed.

## How to use it

Work top to bottom within a file. Each item states **why** it is needed, **what
to do**, and **how to confirm it worked**.

**A finished item is deleted, not ticked.** If it produced an answer (an id, a
file, a console setting), that answer goes into the wiki as current-state
fact. When every item in a file is done, delete the file. This folder should
shrink.

Items cite their source by path; a source on an **unmerged branch** is named
as such, since it is not yet fact on `main`. The collation is manual and goes stale: if
something here contradicts a wiki file, the wiki file wins and this folder is
the bug.
