"""Structural invariants of the agent workflows.

Plain text checks, no YAML parser — `.ai/` stays stdlib-only. These pin
properties that unit tests cannot see because they live in workflow YAML, and
every one of them is here because it broke a live run.
"""

import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from agentlib.guard import TASK_ID_SAFE

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
WORKER = WORKFLOWS / "agent-worker.yml"
ORCHESTRATOR = WORKFLOWS / "agent-orchestrator.yml"
GUARD_WF = WORKFLOWS / "agent-guard.yml"

# handoff.md §10, D2b. The one way a workflow step may run agentctl: from the
# trusted copy of `main` checked out beside the task, never the task branch's.
AGENTCTL = 'python -I "$TOOLS/.ai/bin/agentctl.py"'
GATE = "Refuse .ai changes beyond this task's bookkeeping"
CLI_GATE = "Refuse CLI project config that differs from main"
UNPRIVILEGED = "Hand the checkout to an unprivileged user"
KILL = "Stop every process the model left behind"
RECLAIM = "Take the checkout back"
MODEL_USER = "agentrun"


@pytest.fixture
def worker() -> str:
    if not WORKER.exists():
        pytest.skip("agent-worker.yml not present")
    return WORKER.read_text(encoding="utf-8")


@pytest.fixture
def orchestrator() -> str:
    if not ORCHESTRATOR.exists():
        pytest.skip("agent-orchestrator.yml not present")
    return ORCHESTRATOR.read_text(encoding="utf-8")


def step(text: str, name: str) -> str:
    """One step's YAML, from its `- name:` line to the next step."""
    marker = f"- name: {name}\n"
    assert marker in text, f"no step named {name!r}"
    return text.split(marker, 1)[1].split("\n      - ", 1)[0]


_RUN_KEY = re.compile(r"^(?P<lead>\s*(?:-\s+)?)run:\s*(?P<rest>.*)$")


def run_bodies(text: str) -> list[str]:
    """Every `run:` script in a workflow, as the text the runner will execute.

    Handles both `run: one-liner` and block scalars (`run: |`, `run: >-`): a
    block is every following line indented deeper than the `run` key, which is
    how YAML ends it. Shell comments are deliberately kept — GitHub expands
    `${{ }}` inside them too, before bash ever sees the `#`.
    """
    lines = text.splitlines()
    bodies: list[str] = []
    i = 0
    while i < len(lines):
        m = _RUN_KEY.match(lines[i])
        i += 1
        if not m:
            continue
        rest = m.group("rest").strip()
        if rest and rest[0] not in "|>":
            bodies.append(rest)
            continue
        key_col = len(m.group("lead"))
        block: list[str] = []
        while i < len(lines):
            line = lines[i]
            if line.strip() and len(line) - len(line.lstrip()) <= key_col:
                break
            block.append(line)
            i += 1
        bodies.append(textwrap.dedent("\n".join(block)).strip("\n"))
    return bodies


def _posix_bash() -> str | None:
    """A bash that can run a step body against this filesystem, or None.

    On Windows `shutil.which` can resolve to WSL's `bash.exe` launcher, which
    runs in a different filesystem; Git Bash is fine.
    """
    path = shutil.which("bash")
    if path is None:
        return None
    lowered = path.lower()
    if sys.platform == "win32" and ("system32" in lowered or "windowsapps" in lowered):
        return None
    return path


def run_step_body(body: str, env: dict[str, str], tmp_path: Path) -> tuple[int, str]:
    """Execute one step's script the way the runner would, minus the runner.

    Returns the exit code and what the script wrote to `$GITHUB_OUTPUT`.
    """
    bash = _posix_bash()
    if bash is None:
        pytest.skip("no POSIX bash on this machine")
    output = tmp_path / "github_output"
    output.write_text("", encoding="utf-8")
    github_env = tmp_path / "github_env"
    github_env.write_text("", encoding="utf-8")
    scrubbed = ("TASK_ID", "INPUT_TASK_ID", "HEAD_BRANCH", "GITHUB_OUTPUT", "GITHUB_ENV")
    # GIT_* too: under a git hook they would aim any `git` in the step at the
    # repository being committed to (see conftest.py).
    full_env = {
        k: v for k, v in os.environ.items() if k not in scrubbed and not k.startswith("GIT_")
    }
    full_env.update(GITHUB_OUTPUT=output.as_posix(), GITHUB_ENV=github_env.as_posix(), **env)
    proc = subprocess.run(
        [bash, "-c", body],
        env=full_env,
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,  # a refused id is a non-zero exit, which is the point
    )
    return proc.returncode, output.read_text(encoding="utf-8")


class TestScratchFilesStayOutOfTheCheckout:
    """Run 35556225202: the test agent wrote exactly the right file and was
    still failed, because the workflow's own prompt.md, context.json and
    agent-result.json sat in the checkout, got staged by `git add -A`, and the
    guard correctly refused a diff containing paths no role may write."""

    SCRATCH = ("prompt.md", "context.json", "agent-result.json", "changed.txt")

    def test_the_worker_uses_the_runner_temp_directory(self, worker):
        assert "$RUNNER_TEMP/" in worker, "scratch must live in the runner temp dir, not the repo"

    def test_the_runner_context_is_not_used_in_job_level_env(self, worker):
        # `runner` is unavailable in `jobs.<id>.env`, and GitHub rejects the
        # entire workflow file if it appears there — no job runs at all. A YAML
        # parser cannot see this; run 35556516395 is what it looks like.
        head = worker.split("steps:", 1)[0]
        live = [ln for ln in head.splitlines() if not ln.strip().startswith("#")]
        offenders = [ln for ln in live if "runner." in ln]
        assert not offenders, "the runner context is not available above `steps:`: " + "; ".join(
            offenders
        )

    @pytest.mark.parametrize("name", SCRATCH)
    def test_no_scratch_file_is_referenced_at_the_repo_root(self, worker, name):
        for line in worker.splitlines():
            stripped = line.strip()
            if name not in stripped or stripped.startswith("#"):
                continue
            # Every mention must be qualified by the scratch directory.
            assert "$RUNNER_TEMP/" in stripped, (
                f"{name} is referenced without $RUNNER_TEMP/ — it would land in the checkout "
                f"and be staged by `git add -A`:\n    {stripped}"
            )


class TestAFailedGuardMustEscalate:
    """A boundary violation that fails the job kills every later step, so the
    state is never advanced and the task sits in *_RUNNING forever. Failures
    must be recorded and routed, never silently dropped."""

    def test_the_guard_step_does_not_abort_the_job(self, worker):
        guard_block = worker.split("- name: Check the diff against the permission model", 1)[1]
        guard_block = guard_block.split("- name:", 1)[0]
        assert "continue-on-error: true" in guard_block, (
            "the guard step must not fail the job outright, or the escalate step "
            "below it can never run"
        )

    def test_there_is_an_escalation_step_keyed_on_the_guard(self, worker):
        assert "Escalate a boundary violation" in worker
        assert "steps.guard.outcome == 'failure'" in worker
        assert "GUARD_VIOLATION" in worker

    def test_state_is_pushed_even_when_the_job_fails(self, worker):
        push = worker.split("- name: Push state and work", 1)[1].split("- name:", 1)[0]
        assert "if: always()" in push, "an escalated state that is never pushed is lost"


class TestTheAgentGetsNoGitHubToken:
    """The model process must not be able to reach the GitHub API, whatever it
    is persuaded to do by content it reads."""

    def test_the_invoke_step_blanks_both_token_variables(self, worker):
        # Anchor on the step header, not a prose mention of it in the file's
        # own comments — which is what this test matched on its first draft.
        invoke = worker.split("- name: Invoke the agent", 1)[1].split("- name:", 1)[0]
        assert 'GITHUB_TOKEN: ""' in invoke
        assert 'GH_TOKEN: ""' in invoke

    # handoff.md §10, D2. Blanking the variables was never enough on its own:
    # `actions/checkout` persists the job token into `.git/config` by default,
    # where the model can read it with nothing but its file tools — and that
    # token carries `contents: write` and `actions: write`.

    def test_the_checkout_does_not_persist_the_token(self, worker):
        checkouts = worker.split("uses: actions/checkout@")[1:]
        assert checkouts, "expected the worker to check out the task branch"
        for chunk in checkouts:
            with_block = chunk.split("\n      - ", 1)[0]
            assert "persist-credentials: false" in with_block, (
                "actions/checkout writes the job token into .git/config unless told not to, "
                "and the model can read .git/config"
            )

    def test_nothing_writes_a_credential_into_the_repository(self, worker):
        for body in run_bodies(worker):
            for line in body.splitlines():
                live = line.strip()
                if live.startswith("#"):
                    continue
                assert not (live.startswith("git config") and "extraheader" in live), (
                    f"writes an auth header into .git/config, where the model reads it: {live}"
                )
                assert "x-access-token@" not in live and "remote set-url" not in live, (
                    f"puts a credential into a remote URL, which lands in .git/config: {live}"
                )

    def test_only_the_push_and_the_hand_off_hold_the_repo_token(self, worker):
        holders = set()
        for chunk in worker.split("      - name: ")[1:]:
            if "github.token" in chunk:
                holders.add(chunk.split("\n", 1)[0].strip())
        assert holders == {"Push state and work", "Hand control back to the orchestrator"}, (
            f"the job token must reach exactly the two steps that need it, found {holders}"
        )

    def test_the_push_step_does_nothing_but_push(self, worker):
        # `git add` and `git commit` run fsmonitor, filters and hooks from a
        # .git directory the model has just had write access to. They belong in
        # a step that holds no token.
        push = step(worker, "Push state and work")
        assert "github.token" in push, "the push must authenticate explicitly, in this step"
        body = "\n".join(run_bodies(push))
        assert "git push" in body
        assert "git commit" not in body and "git add" not in body

    def test_the_push_credential_is_masked(self, worker):
        # GitHub masks the raw token, not the base64 header derived from it.
        body = "\n".join(run_bodies(step(worker, "Push state and work")))
        assert "::add-mask::" in body


class TestAWorkerCannotEscapeItsOwnBranch:
    """The single property the two-tier permission model rests on.

    A dispatched worker is restricted by `agent-guard.yml`, which runs only on
    branches named `agent/*`. A Director is unrestricted and is bounded by
    code-owner review on an ordinary branch instead. That split is only worth
    anything if a worker cannot put its diff somewhere the guard does not look
    — one push to `main`, or to `feature/x`, and the guard never runs and the
    tiers have silently become one.

    Two things make it hold, and neither is obvious from reading the job top to
    bottom: the push target is built by the workflow from its own dispatch
    input, and the model step has no credential to push with. Pinned here so
    that a later edit moving the branch name somewhere an agent can influence
    fails a test instead of quietly widening every worker's blast radius."""

    def test_the_push_target_is_built_by_the_workflow(self, worker):
        assert "BRANCH: agent/${{ github.event.inputs.task_id }}" in worker, (
            "the branch a worker pushes to must be constructed by the workflow from its "
            "dispatch input, never taken from anything the agent can write"
        )

    def test_the_worker_pushes_nowhere_else(self, worker):
        pushes = [
            line.strip()
            for line in worker.splitlines()
            if "git push" in line and not line.strip().startswith("#")
        ]
        assert pushes, "expected the worker to push its work somewhere"
        for push in pushes:
            assert 'HEAD:"$BRANCH"' in push, (
                f"{push!r} sends a worker's diff somewhere other than its own task branch, "
                f"where agent-guard would never see it"
            )

    def test_the_checkout_is_the_same_task_branch(self, worker):
        assert "ref: agent/${{ github.event.inputs.task_id }}" in worker

    def test_the_task_id_is_validated_before_anything_uses_it(self, worker):
        # handoff.md §10, D2. The branch name is only as safe as the id it is
        # built from; a crafted id must fail the job before the first step
        # that consumes it.
        steps = worker.split("    steps:\n", 1)[1].splitlines()
        first_step = next(line for line in steps if line.startswith("      - "))
        assert first_step == "      - name: Refuse a malformed task id", (
            "the task id must be validated in the worker's very first step"
        )

    def test_the_guard_covers_exactly_that_namespace(self):
        path = WORKFLOWS / "agent-guard.yml"
        if not path.exists():
            pytest.skip("agent-guard.yml not present")
        assert "startsWith(github.head_ref, 'agent/')" in path.read_text(encoding="utf-8"), (
            "the guard must key off the same prefix the worker is pinned to, or a worker "
            "branch exists that nothing checks"
        )


class TestNoWorkflowCanMerge:
    """Nothing in the system may merge its own work."""

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR])
    def test_no_workflow_calls_pr_merge(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        text = path.read_text(encoding="utf-8")
        assert "gh pr merge" not in text
        assert "--auto" not in text


class TestNoWorkflowCanApprove:
    """`gh pr create` needs "Allow GitHub Actions to create and approve pull
    requests", which also grants approval. Nothing here may use it: a workflow
    that can approve could satisfy the 1-approval rule on an agent's own PR."""

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR])
    def test_no_workflow_approves_a_pull_request(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        text = path.read_text(encoding="utf-8")
        assert "gh pr review" not in text
        assert "--approve" not in text


class TestAFinishedTaskDoesNotFailTheOrchestrator:
    """Run 35670385955. CI ran on `agent/DEMO-001` for PR #30 *after* the task
    had reached COMPLETE. `workflow_run` woke the orchestrator, which tried to
    apply `CI_PASSED` to a terminal state; the state machine refused —
    `COMPLETE is terminal; CI_PASSED rejected` — and the step's non-zero exit
    failed the whole job.

    The refusal is correct and must stay. Failing the run over it is not: every
    later CI run on a finished task's branch, including the "Update branch" the
    strict up-to-date policy forces before its review PR can merge, paints a
    red X that reads as a broken pipeline at exactly the moment someone is
    deciding whether to merge."""

    def test_the_ci_result_step_tolerates_a_terminal_task(self):
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        text = ORCHESTRATOR.read_text(encoding="utf-8")
        step = text.split("- name: Apply the CI result", 1)[1].split("- name:", 1)[0]
        assert "--ignore-terminal" in step, (
            "an unsolicited CI result on an already-finished task must be a no-op, "
            "not a failed orchestrator run"
        )

    def test_the_human_event_step_still_refuses_a_terminal_task(self):
        # The opposite guarantee: a person explicitly supplying an event is
        # telling the machine something, and being told "that is impossible" is
        # the useful answer. Only the unsolicited path may shrug.
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        text = ORCHESTRATOR.read_text(encoding="utf-8")
        step = text.split("- name: Apply a human-supplied event", 1)[1].split("- name:", 1)[0]
        assert "--ignore-terminal" not in step


class TestAHandAuthoredBranchDoesNotDriveTheOrchestrator:
    """Runs 36205815256 and 36366090454. `agent/FRONTEND-002` was cut by hand,
    as `wiki/GeneralContext/Prompts/frontend-build-handoff.md` instructs: the
    `agent/` prefix is what makes `agent-guard.yml` check the diff against the
    spec's `allowed_paths`, which is free verification worth having. But
    `workflow_run` keys off that same prefix, so CI finishing on the branch
    woke the orchestrator, which tried to apply `CI_PASSED` to a task with no
    state file and exited 2.

    Failing is the mild half. `agentctl next` answers `validate` for a
    stateless task, so simply letting the run continue would have created a
    state file, committed it onto an open review PR, and gone on to dispatch a
    paid worker for work a human had already finished — which is the one thing
    the current pass exists to avoid.

    `agent-guard.yml` had this right already ("no state file; treating as a
    hand-authored branch"). This pins the same rule in the other workflow that
    reads the branch name."""

    def _steps(self, text: str) -> dict[str, str]:
        out: dict[str, str] = {}
        for chunk in text.split("      - name: ")[1:]:
            out[chunk.split("\n", 1)[0].strip()] = chunk
        return out

    def test_the_orchestrator_asks_whether_it_owns_the_task(self):
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        step = self._steps(ORCHESTRATOR.read_text(encoding="utf-8")).get(
            "Is this a task this orchestrator drives?"
        )
        assert step is not None, "the orchestrator must decide whether the task is its own"
        assert "state.json" in step, (
            "presence of the task's state file is what distinguishes a dispatched task "
            "from a hand-authored branch"
        )
        assert 'echo "drive=' in step

    def test_a_dispatch_can_still_bootstrap_a_brand_new_task(self):
        # The opposite guarantee, and the reason this cannot be a blanket
        # "skip when there is no state file": a person naming a task id is how
        # a task is started, and a new task has no state file either.
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        step = self._steps(ORCHESTRATOR.read_text(encoding="utf-8"))[
            "Is this a task this orchestrator drives?"
        ]
        assert "workflow_dispatch" in step, (
            "a human-dispatched run must proceed even with no state file, or no task "
            "could ever be bootstrapped"
        )

    @pytest.mark.parametrize(
        "name",
        [
            "Apply the CI result",
            "Decide the next action",
            "Commit the state change",
        ],
    )
    def test_every_state_touching_step_is_gated(self, name: str):
        # These three are the whole gate. Every other action step is already
        # conditioned on `decide.outputs.kind`, which stays empty when
        # "Decide the next action" is skipped, so they fall out on their own.
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        step = self._steps(ORCHESTRATOR.read_text(encoding="utf-8"))[name]
        head = step.split("run: |", 1)[0]
        assert "steps.drive.outputs.drive == 'true'" in head, (
            f"{name!r} reads or writes task state, so it must not run on a branch "
            f"this orchestrator never dispatched"
        )


class TestOnlyTheOrchestratorsOwnCiRunIsTrusted:
    """handoff.md §10, D1. `workflow_run` fires for every completed
    `test-agent` run, and `head_branch` is just a name: a fork PR from a branch
    called `agent/<ID>`, or a path-filtered `pull_request` run on the real
    branch, used to be applied as the task's authoritative verdict. The
    repository is public, so the first was open to anyone whose fork run got
    approved.

    Only the run the orchestrator dispatched itself is the verdict: a
    `workflow_dispatch` run, in this repository, on a commit the branch still
    carries with nothing but bookkeeping since."""

    @pytest.fixture
    def orch(self) -> str:
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        return ORCHESTRATOR.read_text(encoding="utf-8")

    def _job_if(self, orch: str) -> str:
        return orch.split("  orchestrate:", 1)[1].split("runs-on:", 1)[0]

    def test_only_a_dispatched_ci_run_wakes_the_orchestrator(self, orch):
        assert "github.event.workflow_run.event == 'workflow_dispatch'" in self._job_if(orch)

    def test_only_a_run_from_this_repository_wakes_it(self, orch):
        assert (
            "github.event.workflow_run.head_repository.full_name == github.repository"
            in self._job_if(orch)
        )

    def test_the_verdict_must_be_for_code_the_branch_still_carries(self, orch):
        step = orch.split("- name: Apply the CI result", 1)[1].split("- name:", 1)[0]
        # The tools copy since handoff.md §10, D2b.
        assert f"{AGENTCTL} guard tested" in step, "the tested SHA must be checked"
        assert step.index("guard tested") < step.index("state advance"), (
            "the SHA check must run before the verdict is applied"
        )


class TestEveryJobIsBounded:
    """A run with no `timeout-minutes` inherits GitHub's 6-hour default. The
    orchestrator holds its task's concurrency group for as long as it runs, and
    GitHub keeps only one pending run per group — so one hung orchestrator
    drops transitions and stalls the task for the rest of the day."""

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR])
    def test_the_job_declares_a_timeout(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("timeout-minutes:") and not stripped.startswith("#"):
                return
        raise AssertionError(
            f"{path.name} declares no timeout-minutes, so it inherits the 6-hour default"
        )


class TestPrCreationFailuresAreNotMasked:
    """The real error — "GitHub Actions is not permitted to create or approve
    pull requests" — was swallowed by `|| echo "a PR for this branch already
    exists"`, which reported the wrong cause for a setting that was switched
    off."""

    def test_the_pr_step_does_not_claim_a_duplicate_on_any_failure(self):
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        text = ORCHESTRATOR.read_text(encoding="utf-8")
        assert '|| echo "a PR for this branch already exists"' not in text, (
            "a blanket || masks every gh pr create failure as a duplicate"
        )


class TestTheGateStaysAuthoritative:
    """`test-agent.yml` skips suites a change cannot affect. These pin the
    properties that make that safe, each of which fails silently if broken:
    a green run that proved nothing, or a cache that quietly stops being used.
    """

    @pytest.fixture
    def gate(self) -> str:
        path = WORKFLOWS / "test-agent.yml"
        if not path.exists():
            pytest.skip("test-agent.yml not present")
        return path.read_text(encoding="utf-8")

    def test_a_dispatched_run_never_skips_a_suite(self, gate):
        """The orchestrator gets its verdict from workflow_dispatch. If the
        path filter applied there, a red baseline could report success and the
        state machine would believe tests pin something that pins nothing."""
        assert '"$EVENT" != "pull_request"' in gate, (
            "non-PR events must bypass the path filter entirely"
        )

    def test_changing_the_gate_itself_runs_everything(self, gate):
        """Trusting the filter to decide whether to test the filter is how a
        broken gate ships green."""
        for escape in (".github/workflows/", "docker-compose.yml", "docker/"):
            assert escape in gate, f"{escape} must force a full run"

    def test_the_aggregate_check_reports_even_when_jobs_skip(self, gate):
        """A required check that names a skipped job never reports at all, and
        a protected branch reads that as 'waiting' forever."""
        assert "  gate:" in gate
        assert "if: always()" in gate
        # Comments discuss success(); what matters is that no `if:` uses it.
        conditions = [
            line
            for line in gate.splitlines()
            if line.strip().startswith("if:") and "success()" in line
        ]
        assert not conditions, (
            "success() treats a skipped dependency as failure; a skip must pass here: "
            + "; ".join(conditions)
        )

    def test_the_built_image_tags_match_what_compose_runs(self, gate):
        """The one coupling with no error path. CI builds the image under a
        tag; compose runs the service by its own `image:`. If the two drift,
        compose silently rebuilds from scratch and the layer cache stops
        working, with nothing failing to say so."""
        compose = (WORKFLOWS / ".." / ".." / "docker-compose.yml").resolve()
        if not compose.exists():
            pytest.skip("docker-compose.yml not present")
        text = compose.read_text(encoding="utf-8")
        for tag in ("fanwire-backend-test:latest", "fanwire-frontend-test:latest"):
            assert f"image: {tag}" in text, f"docker-compose.yml must tag {tag}"
            assert f"tags: {tag}" in gate, f"test-agent.yml must build {tag}"


class TestTheGuardCanBeARequiredCheck:
    """`agent-guard` is the enforcement backstop, but it runs only on `agent/`
    branches — so on a human PR it is skipped and never reports. A required
    check naming a skipped job reads as "waiting" on a protected branch, which
    would stop any human PR merging; not requiring it at all makes the
    backstop advisory, because a non-required failing check does not block a
    merge. `guard-gate` is what resolves that, and it is the job to require.
    """

    @pytest.fixture
    def guard_wf(self) -> str:
        path = WORKFLOWS / "agent-guard.yml"
        if not path.exists():
            pytest.skip("agent-guard.yml not present")
        return path.read_text(encoding="utf-8")

    def test_there_is_an_always_reporting_aggregate(self, guard_wf):
        assert "  guard-gate:" in guard_wf
        block = guard_wf.split("  guard-gate:", 1)[1]
        assert "if: always()" in block
        assert "needs: guard" in block

    def test_a_skipped_guard_on_an_agent_branch_is_an_error(self, guard_wf):
        """The one case a skip is NOT benign: if the guard's own condition
        ever breaks, every agent PR would sail through reporting success."""
        block = guard_wf.split("  guard-gate:", 1)[1]
        assert "HEAD_REF#agent/" in block, (
            "guard-gate must fail when an agent/ branch skipped the guard"
        )

    def test_a_failed_guard_fails_the_aggregate(self, guard_wf):
        block = guard_wf.split("  guard-gate:", 1)[1]
        assert "exit 1" in block

    def test_the_aggregate_does_not_use_success(self, guard_wf):
        offenders = [
            line
            for line in guard_wf.splitlines()
            if line.strip().startswith("if:") and "success()" in line
        ]
        assert not offenders, (
            "success() treats the skipped-guard case as failure, which is the "
            "case this job exists to distinguish: " + "; ".join(offenders)
        )

    def test_the_guard_itself_still_only_runs_on_agent_branches(self, guard_wf):
        """The aggregate must not be an excuse to widen the guard onto human
        PRs, which are governed by review and CODEOWNERS instead."""
        assert "startsWith(github.head_ref, 'agent/')" in guard_wf


class TestTheOpenApiContractCannotDrift:
    """`backend/openapi.json` is what the frontend's TypeScript types
    (`frontend/src/api/schema.d.ts`) are generated from. If either is stale,
    the client compiles cleanly and fails at runtime, so a CI job regenerates
    both and fails on any difference. Each check below is a way that job could
    exist and still pass everything."""

    @pytest.fixture
    def gate(self) -> str:
        path = WORKFLOWS / "test-agent.yml"
        if not path.exists():
            pytest.skip("test-agent.yml not present")
        return path.read_text(encoding="utf-8")

    @staticmethod
    def job(gate: str, name: str) -> str:
        assert f"\n  {name}:\n" in gate, f"test-agent.yml has no `{name}` job"
        body = gate.split(f"\n  {name}:\n", 1)[1]
        # A job ends where the next two-space-indented key begins.
        lines = []
        for line in body.splitlines():
            if line.startswith("  ") and not line.startswith("   ") and line.strip():
                break
            lines.append(line)
        return "\n".join(lines)

    def test_the_job_regenerates_the_committed_schema(self, gate):
        job = self.job(gate, "openapi-drift")
        assert "python scripts/export_openapi.py" in job

    def test_the_types_are_generated_from_the_fresh_schema(self, gate):
        """Generated from the committed schema instead, the types would match
        a stale contract and pass."""
        job = self.job(gate, "openapi-drift")
        assert "npm run gen:api-types" in job
        assert job.index("python scripts/export_openapi.py") < job.index("npm run gen:api-types"), (
            "the types must be regenerated after the schema, from the fresh export"
        )

    def test_the_job_fails_on_untracked_as_well_as_modified(self, gate):
        """`git diff --exit-code` sees tracked files only: a file that was
        never committed would be regenerated and pass."""
        job = self.job(gate, "openapi-drift")
        assert "git status --porcelain -- backend/openapi.json frontend/src/api/schema.d.ts" in job
        assert "exit 1" in job

    def test_the_job_runs_on_backend_or_frontend_changes(self, gate):
        """A route change moves both files; a hand-edit of the generated types
        moves only the second. Keyed on the filter outputs, it also inherits
        the non-PR bypass that makes a dispatched run authoritative."""
        job = self.job(gate, "openapi-drift")
        assert (
            "if: needs.changes.outputs.backend == 'true'"
            " || needs.changes.outputs.frontend == 'true'" in job
        )

    def test_the_aggregate_gate_depends_on_it(self, gate):
        """Only `gate` is required on `main`. A job outside its `needs:` can
        fail on every PR and block nothing."""
        needs = self.job(gate, "gate").split("needs:", 1)[1].split("runs-on:", 1)[0]
        assert "- openapi-drift" in needs


class TestActionsRunOnNode24:
    """GitHub deprecated Node 20 for actions in 2025 and forces Node-20 actions
    onto Node 24 with a warning on every run. Each entry is the first major of
    that action whose `action.yml` declares `using: node24` (checked
    2026-10-05). The first majors were chosen over the latest ones so the bump
    changes the runtime and as little else as possible."""

    MIN_MAJOR = {
        "actions/checkout": 5,
        "actions/setup-python": 6,
        "actions/setup-node": 5,
        "aws-actions/configure-aws-credentials": 6,
        "docker/setup-buildx-action": 4,
        "docker/build-push-action": 7,
        # Checked 2026-10-08 for the D2b worker split: upload-artifact@v5 and
        # download-artifact@v6 still declare node20.
        "actions/upload-artifact": 6,
        "actions/download-artifact": 7,
    }

    @pytest.mark.parametrize("path", sorted(WORKFLOWS.glob("*.yml")), ids=lambda p: p.name)
    def test_no_action_is_pinned_to_a_node20_major(self, path):
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.search(r"uses:\s*([\w.-]+/[\w.-]+)@v(\d+)", line)
            if not m or line.lstrip().startswith("#"):
                continue
            action, major = m.group(1), int(m.group(2))
            assert action in self.MIN_MAJOR, f"{path.name}: {action} has no Node 24 floor here"
            assert major >= self.MIN_MAJOR[action], (
                f"{path.name}: {action}@v{major} is a Node 20 major"
            )


class TestNoDispatchInputReachesTheShellAsCode:
    """handoff.md §10, D2. `${{ }}` is expanded into the script text before bash
    runs, so a dispatch input of `$(curl …)` is executed, not printed. Anyone
    with `actions: write` can dispatch these workflows, a fork can name its
    branch `agent/$(…)`, and later steps of the orchestrator hold
    `AGENT_DISPATCH_TOKEN` — a person's PAT. Such values must reach the shell
    through `env:`, where they are data."""

    TAINTED = re.compile(
        r"\$\{\{\s*(github\.event\.inputs|inputs\.|steps\.|github\.event\.workflow_run"
        r"|github\.head_ref)"
    )

    def test_the_extractor_sees_block_and_inline_scripts(self):
        sample = textwrap.dedent(
            """\
            steps:
              - name: a
                run: echo ${{ steps.x.outputs.y }}
              - run: |
                  # ${{ inputs.z }}
                  echo ok
              - name: c
                env:
                  V: ${{ steps.safe.outputs.v }}
                run: echo "$V"
            """
        )
        assert run_bodies(sample) == [
            "echo ${{ steps.x.outputs.y }}",
            "# ${{ inputs.z }}\necho ok",
            'echo "$V"',
        ]

    # agent-guard.yml joined in D2b: it pasted the PR's branch name, which a
    # fork chooses, into three scripts.
    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR, GUARD_WF], ids=lambda p: p.name)
    def test_no_run_script_interpolates_attacker_influenced_context(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        offenders = [
            line.strip()
            for body in run_bodies(path.read_text(encoding="utf-8"))
            for line in body.splitlines()
            if self.TAINTED.search(line)
        ]
        assert not offenders, (
            f"{path.name} pastes attacker-influenced context into a script; pass it via "
            "`env:` and quote it:\n    " + "\n    ".join(offenders)
        )


class TestACraftedTaskIdFailsEarly:
    """handoff.md §10, D2. The task id names a branch, a directory under
    `.ai/tasks/`, and a value written to `$GITHUB_OUTPUT` — where a newline in
    it would forge a second output. `TASK_ID_SAFE` already exists for the
    guard; these pin that both workflows apply the same rule, and that it runs
    before the id is used for anything."""

    CRAFTED = [
        "$(touch pwned)",
        "DEMO-001; touch pwned",
        "DEMO-001\nbranch=main",
        "DEMO-001\n",
        "../../main",
        "demo-001",
        "",
    ]

    @staticmethod
    def pattern_in(body: str) -> str:
        m = re.search(r"TASK_ID_SAFE='([^']*)'", body)
        assert m, "the step must state the TASK_ID_SAFE pattern it checks against"
        return m.group(1)

    def test_the_worker_checks_the_guards_own_pattern(self, worker):
        body = run_bodies(step(worker, "Refuse a malformed task id"))[0]
        assert self.pattern_in(body) == TASK_ID_SAFE.pattern, (
            "the worker's copy of TASK_ID_SAFE has drifted from agentlib/guard.py"
        )

    def test_the_orchestrator_checks_the_guards_own_pattern(self, orchestrator):
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        assert self.pattern_in(body) == TASK_ID_SAFE.pattern, (
            "the orchestrator's copy of TASK_ID_SAFE has drifted from agentlib/guard.py"
        )

    def test_the_orchestrator_validates_before_it_writes_an_output(self, orchestrator):
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        assert body.index("TASK_ID_SAFE") < body.index("GITHUB_OUTPUT")

    @pytest.mark.parametrize("crafted", CRAFTED)
    def test_the_worker_refuses_a_crafted_id(self, worker, crafted, tmp_path):
        body = run_bodies(step(worker, "Refuse a malformed task id"))[0]
        code, _ = run_step_body(body, {"TASK_ID": crafted}, tmp_path)
        assert code != 0, f"the worker accepted {crafted!r}"
        assert not (tmp_path / "pwned").exists()

    @pytest.mark.parametrize("crafted", CRAFTED)
    def test_the_orchestrator_refuses_a_crafted_dispatch_input(
        self, orchestrator, crafted, tmp_path
    ):
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        code, outputs = run_step_body(body, {"INPUT_TASK_ID": crafted, "HEAD_BRANCH": ""}, tmp_path)
        assert code != 0, f"the orchestrator accepted {crafted!r}"
        assert outputs == "", "nothing may be written to $GITHUB_OUTPUT for a refused id"
        assert not (tmp_path / "pwned").exists()

    def test_the_orchestrator_refuses_a_crafted_branch_name(self, orchestrator, tmp_path):
        # The workflow_run path: a fork can name its PR branch anything.
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        code, outputs = run_step_body(
            body, {"INPUT_TASK_ID": "", "HEAD_BRANCH": "agent/$(touch pwned)"}, tmp_path
        )
        assert code != 0
        assert outputs == ""
        assert not (tmp_path / "pwned").exists()

    def test_a_well_formed_id_still_resolves(self, orchestrator, worker, tmp_path):
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        code, outputs = run_step_body(
            body, {"INPUT_TASK_ID": "", "HEAD_BRANCH": "agent/DEMO-001"}, tmp_path
        )
        assert code == 0
        assert "id=DEMO-001\n" in outputs
        assert "branch=agent/DEMO-001\n" in outputs
        body = run_bodies(step(worker, "Refuse a malformed task id"))[0]
        code, _ = run_step_body(body, {"TASK_ID": "DEMO-001"}, tmp_path)
        assert code == 0


# --------------------------------------------------------------------------- D2b


def job_block(text: str, name: str) -> str:
    """One job's YAML, from its `  <name>:` key to the next job's."""
    marker = f"\n  {name}:\n"
    assert marker in text, f"no job named {name!r}"
    lines = []
    for line in text.split(marker, 1)[1].splitlines():
        if line.strip() and not line.startswith("   "):
            break  # the next two-space key, or a top-level one
        lines.append(line)
    return "\n".join(lines)


def job_names(text: str) -> list[str]:
    body = text.split("\njobs:\n", 1)[1]
    return re.findall(r"^  ([A-Za-z0-9_-]+):\s*$", body, flags=re.MULTILINE)


def steps_in(block: str) -> list[str]:
    """Every step of a job, in order, each chunk starting at its `- ` line."""
    chunks: list[list[str]] = []
    for line in block.split("    steps:\n", 1)[1].splitlines():
        if line.startswith("      - "):
            chunks.append([line])
        elif chunks:
            chunks[-1].append(line)
    return ["\n".join(c) for c in chunks]


def step_title(chunk: str) -> str:
    first = chunk.strip().removeprefix("- ").splitlines()[0]
    return first.removeprefix("name: ").strip()


def live_lines(text: str) -> list[str]:
    """Every non-comment line of every `run:` script in `text`."""
    out = []
    for body in run_bodies(text):
        for line in body.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                out.append(stripped)
    return out


def makes_patch(text: str) -> bool:
    """Does a live script line diff the index into a binary patch? Global
    options such as `--git-dir=` may sit between `git` and `diff`."""
    return any(re.search(r"^git\b.*\sdiff --cached --binary\b", line) for line in live_lines(text))


def step_runs_python(chunk: str) -> bool:
    return any(re.search(r"\bpython\b", line) for line in live_lines(chunk))


def _git(repo: Path, *args: str) -> str:
    # Never inherit GIT_*: under a hook they point at the real repository.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return subprocess.run(
        ["git", *args], cwd=repo, env=env, capture_output=True, text=True, check=True
    ).stdout


class TestModelWrittenCodeNeverRunsWithAToken:
    """handoff.md §10, D2b. D2 took the token out of the model's own process,
    but code the model *writes* still ran with one in reach. The worker's
    guard skipped everything under `.ai/` (`grep -v '^\\.ai/'`), so a model's
    edit to `.ai/bin/agentctl.py` was committed and then executed by the next
    step of the same job, beside `AGENT_DISPATCH_TOKEN`; the push ran from a
    `.git/` the model could write; the orchestrator ran the task branch's
    `agentctl` with the PAT in env; `agent-guard` imported the PR's own
    `agentlib`.

    The invariant pinned here: no code the model can write ever runs in a step
    that can reach a token. The worker is split in two. The job that runs the
    model can only read, and hands its work on as a patch; the job that holds
    the token starts from a fresh checkout, applies that patch and guards every
    path in it, with no exception for `.ai/`. Every workflow runs `agentctl`
    from a checkout of `main` beside the task, never the task branch's own,
    and refuses a branch whose `.ai/` differs from `main` by anything but this
    task's bookkeeping."""

    # --- the split -------------------------------------------------------

    def test_the_worker_has_two_jobs(self, worker):
        assert job_names(worker) == ["run-model", "land"]

    def test_the_model_job_can_only_read(self, worker):
        block = job_block(worker, "run-model")
        assert "\n    permissions:\n" in block, "the model job must declare its own permissions"
        granted = []
        for line in block.split("\n    permissions:\n", 1)[1].splitlines():
            if not line.startswith("      "):
                break
            if line.split("#", 1)[0].strip():
                granted.append(line.split("#", 1)[0].strip())
        assert granted == ["contents: read"], f"the model job is granted {granted}"

    def test_the_model_job_holds_no_secret_but_the_provider_key(self, worker):
        block = job_block(worker, "run-model")
        assert set(re.findall(r"secrets\.(\w+)", block)) == {"ANTHROPIC_API_KEY"}
        holders = [step_title(c) for c in steps_in(block) if "secrets." in c]
        assert holders == ["Invoke the agent"], holders
        assert "AGENT_DISPATCH_TOKEN" not in block
        assert "github.token" not in block

    def test_the_landing_job_waits_for_the_model_and_always_runs(self, worker):
        head = job_block(worker, "land").split("    steps:\n", 1)[0]
        assert "needs: run-model" in head
        assert "if: always()" in head, (
            "a model job that failed must still be recorded, pushed and handed back"
        )
        assert "contents: write" in head and "actions: write" in head

    def test_the_model_hands_its_work_on_as_a_patch(self, worker):
        model = job_block(worker, "run-model")
        land = job_block(worker, "land")
        assert makes_patch(model)
        assert "actions/upload-artifact@" in model
        assert "actions/download-artifact@" in land
        assert "git apply --index" in step(land, "Check the diff against the permission model")

    def test_the_model_job_commits_and_records_nothing(self, worker):
        # Anything written into the checkout after the model is staged with
        # the model's work and would land as if the model had written it.
        block = job_block(worker, "run-model")
        assert "telemetry-from-run" not in block
        assert "git commit" not in block and "git push" not in block

    def test_nothing_runs_from_the_tools_copy_after_the_model(self, worker):
        # In the model job the model can write anywhere the runner can,
        # including the tools copy beside the checkout. Once it has run,
        # nothing in that job may execute repository code.
        chunks = steps_in(job_block(worker, "run-model"))
        titles = [step_title(c) for c in chunks]
        after = chunks[titles.index("Invoke the agent") + 1 :]
        assert after, "the model job must package the work after the model"
        for chunk in after:
            for line in live_lines(chunk):
                assert "python" not in line and "$TOOLS" not in line, (
                    f"{step_title(chunk)!r} runs code after the model: {line}"
                )

    def test_the_landing_job_validates_the_task_id_first(self, worker):
        land = job_block(worker, "land")
        assert step_title(steps_in(land)[0]) == "Refuse a malformed task id"

    def test_both_jobs_check_out_without_persisting_a_token(self, worker):
        for name in ("run-model", "land"):
            block = job_block(worker, name)
            assert "ref: agent/${{ github.event.inputs.task_id }}" in block, name
            checkouts = block.split("uses: actions/checkout@")[1:]
            assert len(checkouts) == 2, name
            for chunk in checkouts:
                assert "persist-credentials: false" in chunk.split("\n      - ", 1)[0], name

    # --- the landing guard -------------------------------------------------

    def test_the_guard_has_no_exception_for_the_agent_system(self, worker):
        assert "grep -v '^\\.ai/'" not in worker
        guard = step(job_block(worker, "land"), "Check the diff against the permission model")
        assert f"{AGENTCTL} guard check" in guard

    def test_the_patch_may_not_carry_links_or_reach_into_git(self, worker):
        guard = "\n".join(
            run_bodies(
                step(job_block(worker, "land"), "Check the diff against the permission model")
            )
        )
        assert "120000" in guard, "a symlink in the patch must be refused"
        assert "160000" in guard, "a gitlink in the patch must be refused"
        assert ".git" in guard, "a patch path inside .git must be refused"
        assert guard.index("120000") < guard.index("git apply --index")

    def test_telemetry_is_written_only_after_the_guard(self, worker):
        land = job_block(worker, "land")
        assert land.index("- name: Check the diff against the permission model") < land.index(
            "telemetry-from-run"
        )

    # --- the tools copy ------------------------------------------------------

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR, GUARD_WF], ids=lambda p: p.name)
    def test_no_workflow_runs_the_checkouts_own_agentctl(self, path):
        lines = live_lines(path.read_text(encoding="utf-8"))
        offenders = [ln for ln in lines if "agentctl.py" in ln and AGENTCTL not in ln]
        assert not offenders, "agentctl must come from the tools copy:\n    " + "\n    ".join(
            offenders
        )
        assert any(AGENTCTL in ln for ln in lines)
        imports_from_checkout = [
            ln for ln in lines if re.search(r"""path\.insert\(0,\s*['"]\.ai""", ln)
        ]
        assert not imports_from_checkout, imports_from_checkout

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR, GUARD_WF], ids=lambda p: p.name)
    def test_every_python_is_isolated_from_the_checkout(self, path):
        # `python -c` and `python -` put the working directory on sys.path, so
        # a `json.py` in the task checkout would be imported. `-I` does not.
        bare = [
            ln
            for ln in live_lines(path.read_text(encoding="utf-8"))
            if re.search(r"(^|[\s(|])python(?!\s+-I\b)(\s|$)", ln)
        ]
        assert not bare, "python must run with -I:\n    " + "\n    ".join(bare)

    @pytest.mark.parametrize(
        "path,jobs",
        [(WORKER, ["run-model", "land"]), (ORCHESTRATOR, ["orchestrate"])],
        ids=["worker", "orchestrator"],
    )
    def test_the_tools_are_main_beside_the_task_checkout(self, path, jobs):
        text = path.read_text(encoding="utf-8")
        assert "TOOLS: ${{ github.workspace }}/tools" in text
        assert "AGENTCTL_DATA_ROOT: ${{ github.workspace }}/task" in text
        for name in jobs:
            block = job_block(text, name)
            checkouts = block.split("uses: actions/checkout@")[1:]
            tools = [c for c in checkouts if "path: tools" in c.split("\n      - ", 1)[0]]
            task = [c for c in checkouts if "path: task" in c.split("\n      - ", 1)[0]]
            assert len(tools) == 1 and len(task) == 1, name
            assert "ref: ${{ github.sha }}" in tools[0], name

    def test_the_model_is_invoked_from_the_tools_copy(self, worker):
        body = "\n".join(run_bodies(step(job_block(worker, "run-model"), "Invoke the agent")))
        assert 'bash "$TOOLS/.ai/bin/invoke_agent.sh"' in body

    def test_agent_guard_runs_the_base_branchs_code(self):
        text = GUARD_WF.read_text(encoding="utf-8")
        tools = [c for c in text.split("uses: actions/checkout@")[1:] if "path: tools" in c]
        assert len(tools) == 1
        assert "ref: ${{ github.event.pull_request.base.sha }}" in tools[0]
        assert "AGENTCTL_DATA_ROOT: ${{ github.workspace }}/pr" in text

    def test_agent_guard_validates_the_task_id_before_using_it(self):
        text = GUARD_WF.read_text(encoding="utf-8")
        body = run_bodies(step(text, "Derive the task id from the branch"))[0]
        assert TestACraftedTaskIdFailsEarly.pattern_in(body) == TASK_ID_SAFE.pattern

    # --- the .ai gate ----------------------------------------------------------

    @pytest.mark.parametrize(
        "path,name",
        [(WORKER, "run-model"), (WORKER, "land"), (ORCHESTRATOR, "orchestrate")],
        ids=["run-model", "land", "orchestrate"],
    )
    def test_the_gate_precedes_every_python_step(self, path, name):
        chunks = steps_in(job_block(path.read_text(encoding="utf-8"), name))
        titles = [step_title(c) for c in chunks]
        assert GATE in titles, f"{name} has no {GATE!r} step"
        first_python = next(i for i, c in enumerate(chunks) if step_runs_python(c))
        assert titles.index(GATE) < first_python, (
            f"{name} runs python ({titles[first_python]!r}) before the .ai gate"
        )

    def test_the_gate_is_one_script(self, worker, orchestrator):
        bodies = {
            run_bodies(step(job_block(text, name), GATE))[0]
            for text, name in (
                (worker, "run-model"),
                (worker, "land"),
                (orchestrator, "orchestrate"),
            )
        }
        assert len(bodies) == 1, "the .ai gate has drifted between its copies"

    @pytest.fixture
    def gate_body(self, worker) -> str:
        return run_bodies(step(job_block(worker, "run-model"), GATE))[0]

    @pytest.fixture
    def branch(self, tmp_path):
        """A repository whose `origin/main` carries the agent system, and a
        task branch cut from it. Returns a function that commits to the
        branch and returns the repository."""
        if shutil.which("git") is None:
            pytest.skip("git not available")
        repo = tmp_path
        _git(repo, "init", "-q", "-b", "main")
        _git(repo, "config", "user.email", "t@example.com")
        _git(repo, "config", "user.name", "t")
        for rel in (".ai/agentlib/guard.py", ".ai/tasks/ABC-001/task.json", "backend/app/x.py"):
            (repo / rel).parent.mkdir(parents=True, exist_ok=True)
            (repo / rel).write_text(f"base {rel}\n", encoding="utf-8")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "-m", "base")
        _git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
        _git(repo, "checkout", "-q", "-b", "agent/ABC-001")

        def commit(*paths: str) -> Path:
            for rel in paths:
                (repo / rel).parent.mkdir(parents=True, exist_ok=True)
                (repo / rel).write_text("changed\n", encoding="utf-8")
                _git(repo, "add", "--", rel)
            _git(repo, "commit", "-q", "-m", "work")
            return repo

        return commit

    def test_the_gate_passes_bookkeeping_and_ordinary_work(self, gate_body, branch):
        repo = branch(
            ".ai/tasks/ABC-001/state.json",
            ".ai/telemetry/runs/ABC-001/1-code_agent-a1.json",
            "backend/app/x.py",
        )
        code, _ = run_step_body(gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code == 0

    @pytest.mark.parametrize(
        "path",
        [
            ".ai/agentlib/x.py",
            ".ai/agentlib/guard.py",
            ".ai/tasks/OTHER-001/state.json",
            ".ai/tasks/ABC-001/task.json",
            ".ai/tasks/ABC-001/brief.md",
            ".ai/telemetry/runs/ABC-001/sub/1.json",
            ".ai/telemetry/runs/OTHER-001/1.json",
            ".ai/policy.json",
        ],
    )
    def test_the_gate_refuses_anything_else_under_ai(self, gate_body, branch, path):
        repo = branch(".ai/tasks/ABC-001/state.json", path)
        code, _ = run_step_body(gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0, f"the gate accepted a branch changing {path}"

    def test_a_rename_into_bookkeeping_is_still_seen(self, gate_body, branch):
        # With rename detection, `--name-only` prints only the destination, so
        # moving agentlib code onto a bookkeeping path would look like
        # bookkeeping alone.
        repo = branch(".ai/tasks/ABC-001/state.json")
        _git(repo, "mv", ".ai/agentlib/guard.py", ".ai/telemetry/runs/ABC-001/x.json")
        _git(repo, "commit", "-q", "-m", "rename")
        code, _ = run_step_body(gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0

    def test_the_gate_fails_closed_without_main(self, gate_body, branch):
        repo = branch("backend/app/x.py")
        _git(repo, "update-ref", "-d", "refs/remotes/origin/main")
        code, _ = run_step_body(gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0, "a gate that cannot see main must refuse, not pass"

    # --- the provider CLI's own project config -------------------------------
    #
    # The CLI loads `.claude/settings*.json` (hooks run commands) and
    # `.mcp.json` (servers are processes) from the directory it is started in,
    # with the provider key in its environment. That directory is the task
    # checkout, so a branch that changed them would run code nobody reviewed.

    def test_the_model_job_refuses_changed_cli_config_before_the_model(self, worker):
        block = job_block(worker, "run-model")
        titles = [step_title(c) for c in steps_in(block)]
        assert CLI_GATE in titles
        assert titles.index(CLI_GATE) < titles.index("Invoke the agent")
        gate = step(block, CLI_GATE)
        assert "id: cliconfig" in gate and "continue-on-error: true" in gate
        invoke_head = step(block, "Invoke the agent").split("run: ", 1)[0]
        assert "steps.cliconfig.outcome == 'success'" in invoke_head
        assert "cli_config: ${{ steps.cliconfig.outcome }}" in block

    def test_a_refused_cli_config_escalates_like_a_guard_violation(self, worker):
        land = job_block(worker, "land")
        escalate = step(land, "Escalate a boundary violation")
        assert "verdict == 'refused'" in escalate.split("run: ", 1)[0]
        assert "GUARD_VIOLATION" in escalate
        assert "exit 1" in escalate

    @pytest.fixture
    def cli_gate_body(self, worker) -> str:
        return run_bodies(step(job_block(worker, "run-model"), CLI_GATE))[0]

    def test_the_cli_gate_passes_ordinary_work(self, cli_gate_body, branch):
        repo = branch("backend/app/x.py", ".ai/tasks/ABC-001/state.json")
        code, _ = run_step_body(cli_gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code == 0

    @pytest.mark.parametrize(
        "path",
        [".claude/settings.json", ".claude/settings.local.json", ".claude/x/y.md", ".mcp.json"],
    )
    def test_the_cli_gate_refuses_changed_cli_config(self, cli_gate_body, branch, path):
        repo = branch(path)
        code, _ = run_step_body(cli_gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0, f"the CLI gate accepted a branch changing {path}"

    def test_the_cli_gate_fails_closed_without_main(self, cli_gate_body, branch):
        repo = branch("backend/app/x.py")
        _git(repo, "update-ref", "-d", "refs/remotes/origin/main")
        code, _ = run_step_body(cli_gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0

    # --- the model as an unprivileged user -----------------------------------
    #
    # As the runner's own user, a process the model leaves running can rewrite
    # the actions the job runs next (`_work/_actions`, e.g. upload-artifact,
    # which holds ACTIONS_RUNTIME_TOKEN and so can write the Actions cache that
    # main's other workflows read), and read the runner's environment. As a
    # separate user it can write only the checkout, and it is killed before
    # anything else in the job runs.

    def _model_steps(self, worker) -> tuple[list[str], list[str]]:
        chunks = steps_in(job_block(worker, "run-model"))
        return chunks, [step_title(c) for c in chunks]

    def test_the_model_runs_as_another_user(self, worker):
        body = "\n".join(run_bodies(step(job_block(worker, "run-model"), "Invoke the agent")))
        assert "sudo" in body and f"-u {MODEL_USER}" in body
        assert "--preserve-env=ANTHROPIC_API_KEY" in body, (
            "the key must not be put on a command line, where sudo logs it"
        )
        assert "ANTHROPIC_API_KEY=" not in body

    def test_the_user_is_made_and_the_git_dir_moved_out_before_the_model(self, worker):
        chunks, titles = self._model_steps(worker)
        setup = chunks[titles.index(UNPRIVILEGED)]
        assert "useradd" in setup and MODEL_USER in setup
        assert "mv .git" in setup, (
            "the git dir must leave the checkout the model owns, or later git commands "
            "run its hooks and config"
        )
        assert titles.index(UNPRIVILEGED) < titles.index("Invoke the agent")

    def test_the_users_processes_are_killed_before_anything_else_runs(self, worker):
        chunks, titles = self._model_steps(worker)
        invoke = titles.index("Invoke the agent")
        kill = titles.index(KILL)
        reclaim = titles.index(RECLAIM)
        package = next(i for i, c in enumerate(chunks) if makes_patch(c))
        upload = next(i for i, c in enumerate(chunks) if "actions/upload-artifact@" in c)
        assert invoke + 1 == kill, "nothing may run between the model and the kill"
        assert kill < reclaim < package < upload
        body = "\n".join(run_bodies(chunks[kill]))
        assert f"pkill -KILL -u {MODEL_USER}" in body
        assert f"pgrep -u {MODEL_USER}" in body, "the kill must be verified, not assumed"
        assert "if: always()" in chunks[kill]

    def test_the_patch_is_made_from_the_git_dir_outside_the_checkout(self, worker):
        chunks, _ = self._model_steps(worker)
        package = next(c for c in chunks if makes_patch(c))
        for line in live_lines(package):
            if line.startswith("git "):
                assert "--git-dir=" in line, f"uses whatever .git the model left: {line}"
