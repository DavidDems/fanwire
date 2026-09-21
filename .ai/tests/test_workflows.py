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

    def test_the_worker_declares_a_scratch_directory(self, worker):
        assert "WORK:" in worker, "the worker must define WORK for its own scratch files"
        assert "runner.temp" in worker, "scratch must live in the runner temp dir, not the repo"

    @pytest.mark.parametrize("name", SCRATCH)
    def test_no_scratch_file_is_referenced_at_the_repo_root(self, worker, name):
        for line in worker.splitlines():
            stripped = line.strip()
            if name not in stripped or stripped.startswith("#"):
                continue
            # Every mention must be qualified by the scratch directory.
            assert "$WORK/" in stripped or "WORK:" in stripped, (
                f"{name} is referenced without $WORK/ — it would land in the checkout "
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
