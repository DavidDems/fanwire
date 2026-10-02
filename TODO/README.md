# TODO — things only you can do

**Human-facing.** Everything in this folder is a task that needs a person: an
account, a credential, a purchase, a judgement call, or a click in a console.
Nothing here can be done by an agent, which is exactly why it is collected in
one place instead of scattered through files agents write.

The rest of the repository is written for agents (`wiki/`, `.ai/`, `AGENTS.md`).
This folder is written for you.

## Files

| File | What it covers | Blocking? |
|---|---|---|
| [`02-deployment-requirements.md`](02-deployment-requirements.md) | What is left after the post-deploy checklist: SES production access, requested 2026-10-01 and waiting on AWS | No — waiting on AWS's review |
| [`03-open-decisions.md`](03-open-decisions.md) | Questions agents have asked and are waiting on. Today that's one: which browser tool sessions may drive | No. Without an answer, browser verification is reported as not done. Answered decisions are in `wiki/GeneralContext/Architecture/human-decisions.md` |
| [`04-first-deploy.md`](04-first-deploy.md) | The first deploy, done 2026-09-30: what happened, and the traps that will catch the next person | No — a record. Read §4 "Traps" before running any AWS command |

**Status as of 2026-10-02.** `01` is **deleted** — every item in it was
completed, and its durable content now lives at
`wiki/GeneralContext/Architecture/github-automation-setup.md`. The site is
live, `cfn-exec-role` is scoped and the NAT AMI is pinned (both 2026-10-02), and `02` now holds only SES
production access; what
each check proved moved into `wiki/CodeContext/Modules/0x00-architecture.md`
("Post-deploy checks, 2026-09-30"). `03` holds one open question, which
browser tool sessions may drive; its answered decisions moved to
`wiki/GeneralContext/Architecture/human-decisions.md` on 2026-10-02. `04` is the record of the first deploy — finished, kept for its
"Traps" list, which every later AWS session reads before handing over a
command.

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
