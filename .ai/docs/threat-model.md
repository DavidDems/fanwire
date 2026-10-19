# Threat model

The assumption: **repository contents may contain malicious or misleading
instructions**, and a worker may be manipulated into trying something it was
not asked to do.

The design response is not "write better prompts". It is to keep the blast
radius small enough that a fully compromised worker cannot do lasting damage,
and to make every boundary a script rather than an instruction.

## Untrusted by default

These are data, never instruction:

- source files, comments, docstrings, Markdown
- files handed over from `wiki/CodeContext/`
- test output, CI logs, error messages, distilled failure reports
- PR and issue text, and anything fetched from outside the repository

Trusted instruction is exactly two things: `.ai/prompts/*.md` and the task
contract from `task.json`. Both live under `.ai/`, both are in
`ALWAYS_FORBIDDEN`, and both reach `main` only through a human-reviewed PR.

## How untrusted content is handled

`agentlib/promptbuild.py` assembles every worker prompt in a fixed order that
is also the trust order:

1. `_shared.md` and the role prompt — instructions.
2. The task contract — Director-authored, validated.
3. Everything else, behind `DATA_BANNER` and inside `FENCE` markers.

Specific measures:

- **Fence stripping.** The fence marker is removed from content before it is
  fenced, so a file containing the marker cannot close its own fence and
  present the remainder of itself as prompt.
  (`test_promptbuild.py::test_a_fence_in_the_content_cannot_close_the_fence`)
- **Size caps.** 40,000 characters per reference file; at most 12 failures in a
  distilled result, each summary capped at 200 characters. An unbounded log is
  both a cost problem and an injection surface.
- **Raw logs never reach a prompt.** A CI log is parsed by a script; only the
  structured result travels onward.
- **The Distiller has no repository access at all.** It handles the most
  attacker-influenced input in the system — arbitrary program output — so it
  is given no filesystem, no tools, and no ability to act on anything it reads.
- **Structured fields only.** The workflow reads exactly three fields of model
  output: `summary`, `decision`, `reason`. A manager's decision is never parsed
  out of prose, so a `reason` field (or a file quoted into one) cannot forge a
  transition. (`test_agentresult.py::test_a_decision_is_never_read_from_free_text`)

## Blast radius of a fully compromised worker

Assume a worker does whatever an attacker wants. It:

- **cannot** write `.ai/`, `.github/`, `wiki/GeneralContext/`, `AGENTS.md` or
  the git dotfiles — refused by the guard, work discarded, task escalated
- **cannot** write outside its role's allowlist ∩ the task's `allowed_paths`
- **cannot** add a dependency — manifests are denied
- **cannot** call the GitHub API — no token in its environment
- **cannot** merge anything — no workflow has that permission, and branch
  protection requires human approval
- **cannot** rewrite or delete telemetry — append-only, under `.ai/`
- **cannot** disable the check that catches it — `agent-guard.yml` runs on the
  PR, from a workflow it cannot modify
- **can** write plausible-looking code inside its allowed paths

That last one is real and is not solved by this system. It is why every agent
branch reaches `main` through a human-reviewed PR, and why the guard reports
the exact path list a reviewer should be looking at.

## Defence in depth

The permission check runs in three independent places:

1. `agent-worker.yml` — before the commit, per role.
2. `agent-guard.yml` — on the PR, against the whole branch, in a workflow the
   orchestrator does not control.
3. `agentctl selfcheck` — in the ordinary test suite, asserting the guard still
   refuses a worker reaching for the system's own boundaries.

(2) exists because a boundary checked only by the component being bounded is
not a boundary. If the orchestrator were misconfigured, or a branch were pushed
by hand, (2) still fails the PR.

## Residual risks, stated rather than hidden

- **Read access is not sandboxed.** A worker can read any file in its
  checkout. Minimal context is a cost and quality measure here, not a
  confidentiality control. Anything genuinely secret must not be in the repo.
- **Subtly wrong code.** Guard and CI catch scope and correctness-against-tests,
  not intent. Human review is the control.
- **A poisoned task spec.** `task.json` is trusted input. It is also
  human-reviewed before it lands, and cannot grant the always-forbidden set.
- **Provider compromise.** Out of scope. A malicious provider has the code
  agent's write permission for the duration of a task branch, which is why
  that permission is narrow and why nothing merges without a human.
- **Runner compromise.** Out of scope; standard GitHub-hosted runner trust.

## OpenSSF Scorecard: what this repository fails on purpose

`.github/workflows/scorecard.yml` runs OpenSSF Scorecard weekly and uploads
the result to the Security tab. It is advisory: it fails nothing, `gate` does
not depend on it, and it is not a required check. Its job token can read, and
write one thing, a code-scanning result; its results are not published.

The checks below are **expected** to score low, and each is accepted for the
reason given. This list is the expectation, to be confirmed against the first
run (it can only run from `main`, after merge); correct it then.

- **Code-Review.** Solo maintainer. The human authors Director PRs and merges
  them through the ruleset's admin bypass, because GitHub never lets an author
  approve their own PR (`wiki/GeneralContext/Architecture/github-automation-setup.md`
  §3). Agent PRs, authored by `github-actions[bot]`, do get a real approval.
  So Director changes show as merged unreviewed, which they are, by a second
  person; the human reads every one before it lands.
- **Branch-Protection.** The same bypass, and one more reason: reading a
  ruleset in full needs an admin token, and the job is deliberately given
  none. The score reflects what a read-only token can see, not the ruleset.
- **Dangerous-Workflow.** Likely flags `coverage-check.yml` (it checks out the
  PR's head under `pull_request_target`) and possibly `wiki-proposal.yml` (it
  checks out the merged commit; spec-drift.yml checks out only the base). This
  is the D2b pattern (`handoff.md` §10.1): `main`'s workflow file and `main`'s
  scripts run, from a `tools/` checkout with `python -I`; the PR is checked
  out beside them as data only, and nothing from it is executed; no checkout
  keeps a credential, and each key sits in one step with no GitHub token.
  `test_workflows.py` pins this (`TestTheCoverageCheckRunsMainsCopyAgainstAPrAsData`,
  `TestTheWikiProposalRunsMainsCopyAfterAMerge`). A pattern match cannot see
  that the checkout is never run; the tests can.
- **Pinned-Dependencies.** Partial. Actions are pinned by commit SHA, but the
  Dockerfiles name their base images by tag (`public.ecr.aws/lambda/python:3.12`
  in `docker/backend.Dockerfile`, `node:20-alpine` in `docker/frontend.Dockerfile`
  and `docker/cdk-deploy.Dockerfile`), `pip install` runs without `--require-hashes`
  (the backend Dockerfile, and `test-agent.yml`), and `agent-worker.yml`
  installs the Claude Code CLI with `npm install -g`. `npm ci` installs from
  the lockfile, which carries integrity hashes. Inside the Scorecard action
  itself, its docker image is named by tag. Closing the rest is deliverable 2
  (toolchain pins) and Renovate's job, not this workflow's.
- **Fuzzing.** No fuzz targets. The boundaries that matter here are permission
  checks, and those are pinned by tests that try the specific escapes.
- **CII-Best-Practices.** No OpenSSF Best Practices badge; not applied for.
- **Signed-Releases** and **Packaging.** This is an application deployed to
  AWS by `deploy.yml`, not a package anyone downloads; there are no releases
  to sign or packages to publish.
- **Contributors.** One maintainer, one organisation, by design.
- **Maintained**, **Security-Policy**, **License.** May score low or zero: a
  young repository with no `SECURITY.md` and no top-level licence. Not
  addressed by this workflow; noted so a low score there is not a surprise.
