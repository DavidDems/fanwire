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
| [`01-ai-workflow-setup.md`](01-ai-workflow-setup.md) | Making the agent system actually run: **Actions minutes**, secrets, branch protection, the first live task | **Partly.** The pipeline runs and a task has completed. What is left (§7, §7b) costs two manual nudges per task and leaves an unaccounted-for admin token live |
| [`02-deployment-requirements.md`](02-deployment-requirements.md) | AWS, domain, IAM review, third-party keys — collated from across the wiki | Not yet. Blocks `cdk deploy`, not development |
| [`03-open-decisions.md`](03-open-decisions.md) | Questions agents have asked and are waiting on | Varies; each item says what it blocks. **The answers in it are staged, not landed** — see the warning at the top of that file |

**Status as of 2026-09-21.** `01` steps 0–6 and 10–11 done, 7/7b/8/9 open.
`02` §1, §4 and §5 answered; §2 needs a hosted zone and four DNS records; §3 is
now three concrete sub-steps instead of an unactionable instruction. `03` has
four of five Phase 5a answers, which still have to be copied into
`phase-4-manager-agent.md` by a human because that path is agent-unwritable.

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
