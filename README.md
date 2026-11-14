# fanwire

**A social app for sports fans, built around real game results.**

🔗 **Live:** [fanwire.daviddems.com](https://fanwire.daviddems.com)

## What it is

fanwire is a place to talk about games with other fans. It works like a familiar social feed (posts, replies, likes, reposts, follows and notifications), with one difference: the games themselves are built in.

The app holds two decades of real NBA results and box scores. When you post about a game, you attach the actual result to it, so everyone in the thread is looking at the same score and stats instead of arguing from memory. You can also search for games, teams and other fans, and follow the people whose takes you like.

## How it's built

| Part | Technology |
|---|---|
| Website | React with TypeScript |
| Server | Python with FastAPI |
| Database | PostgreSQL |
| Hosting | Amazon Web Services (AWS), with the cloud setup written as code |
| Testing and releases | GitHub Actions runs every test on each change; a release only goes live after a person approves it |

## How AI builds it

This project is also an experiment in a question: **how do you let AI agents write real code without simply trusting them?**

fanwire's code is written by AI agents (Anthropic's Claude) and directed and reviewed by me. The rules they work under are not just instructions in a prompt. They are checked by automated tests and by GitHub itself, so an agent cannot get around them by misreading or ignoring them.

- **Tests first, proven by the machine.** For each piece of work, one agent writes tests that must fail first, then another writes the code that makes them pass. The pipeline confirms the tests really failed before any code was written.
- **Each agent can only touch its own files.** Every role has a list of folders it is allowed to change. A required check compares what an agent actually changed against that list and blocks anything outside it. No agent can change its own rules.
- **No agent can merge or release.** Every change is reviewed and merged by a person, and every release waits for a person's approval.
- **Small AI helpers on every pull request.** Cheap, narrow model calls summarize test failures, flag code paths without tests, and check that a change matches its task, to make human review faster.
- **Everything is tracked.** Each task moves through explicit, recorded states, and its cost and outcome are measured.

### Where the rules are enforced

| What | Where |
|---|---|
| Overview of the agent system | [`.ai/README.md`](.ai/README.md) |
| Why it is designed this way | [`.ai/docs/philosophy.md`](.ai/docs/philosophy.md) |
| What each agent may change | [`.ai/policy.json`](.ai/policy.json), explained in [`.ai/docs/permissions.md`](.ai/docs/permissions.md) |
| The check that blocks changes outside an agent's permissions | [`.github/workflows/agent-guard.yml`](.github/workflows/agent-guard.yml), using [`.ai/agentlib/guard.py`](.ai/agentlib/guard.py) |
| Running an agent with no access to GitHub credentials | [`.github/workflows/agent-worker.yml`](.github/workflows/agent-worker.yml) |
| Proving tests fail before code is written | [`wiki/GeneralContext/Decisions/0003-red-baseline.md`](wiki/GeneralContext/Decisions/0003-red-baseline.md) |
| The task lifecycle | [`.ai/docs/state-machine.md`](.ai/docs/state-machine.md) |
| What happens if an agent is manipulated | [`.ai/docs/threat-model.md`](.ai/docs/threat-model.md) |
| The instructions agents start from | [`AGENTS.md`](AGENTS.md) |

## Repository layout

| Folder | What's in it |
|---|---|
| [`frontend/`](frontend/) | The website |
| [`backend/`](backend/) | The server and its tests |
| [`infra/`](infra/) | The AWS setup, written as code |
| [`.ai/`](.ai/) | The agent system: rules, task specs, prompts and the scripts that enforce them |
| [`wiki/`](wiki/) | The design notes agents read before they work |
