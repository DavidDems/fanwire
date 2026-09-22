"""Structural invariants of the agent workflows.

Plain text checks, no YAML parser — `.ai/` stays stdlib-only. These pin
properties that unit tests cannot see because they live in workflow YAML, and
every one of them is here because it broke a live run.
"""

from pathlib import Path

import pytest

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
WORKER = WORKFLOWS / "agent-worker.yml"
ORCHESTRATOR = WORKFLOWS / "agent-orchestrator.yml"


@pytest.fixture
def worker() -> str:
    if not WORKER.exists():
        pytest.skip("agent-worker.yml not present")
    return WORKER.read_text(encoding="utf-8")


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


class TestTheTypedDecisionSeam:
    """The Manager's decision is a typed question, not parsed prose.

    Each of these pins a property that only exists in workflow YAML, and each
    one fails in a way a unit test cannot see: silently spending an Opus call
    that was not needed, or leaving a task in MANAGER_RUNNING forever.
    """

    def test_the_decision_is_asked_before_the_agent_is_invoked(self, worker):
        """Ordering is the whole design: the answer decides whether an agent
        runs at all. Reversed, the saving disappears and the call is pure cost."""
        decide = worker.index("id: decide")
        agent = worker.index("id: agent")
        assert decide < agent, "the typed decision must be asked before the agent step"

    def test_the_agent_step_is_skippable_for_the_manager(self, worker):
        assert "steps.decide.outputs.needs_prose == 'true'" in worker, (
            "the Manager's agent invocation must be conditional on needing prose"
        )

    def test_the_manager_event_comes_from_the_typed_decision(self, worker):
        assert "${{ steps.decide.outputs.decision }}" in worker
        assert "manager-decision --agent-result" not in worker, (
            "the Manager's event must not be parsed back out of model prose"
        )

    def test_a_skipped_agent_still_advances_the_workflow(self, worker):
        """Without this the common path — a Manager that needed no prose —
        never advances, and the task sits in MANAGER_RUNNING forever."""
        assert "steps.agent.outcome == 'skipped'" in worker

    def test_the_decision_call_gets_no_github_token(self, worker):
        """Same least-privilege rule as the agent step: a step holding a
        provider credential must not also be able to reach the GitHub API."""
        block = worker.split("id: decide", 1)[1].split("- name:", 1)[0]
        assert "TYPESAFE_API_KEY" in block, "the decision step needs its provider credential"
        assert 'GITHUB_TOKEN: ""' in block and 'GH_TOKEN: ""' in block, (
            "the decision step must blank both GitHub tokens"
        )

    def test_a_provider_outage_does_not_fail_the_job(self, worker):
        """ask_jev.py always leaves a parseable file and every gate falls back
        conservatively, so an outage must make the system careful, not stuck."""
        block = worker.split("id: decide", 1)[1].split("- name: Record", 1)[0]
        assert "|| true" in block, "an unreachable decision provider must not fail the job"
