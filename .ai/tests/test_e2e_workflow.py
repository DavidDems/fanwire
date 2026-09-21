"""End-to-end drive of the workflow with stubbed agents.

Every agent here is a stub that returns a canned diff — the point is to prove
the *deterministic* half of the system (state, dispatch decisions, guard,
distillation, telemetry) carries a task from spec to COMPLETE, to ESCALATED,
and back, with no live model and no live CI. See `.ai/docs/operations.md`,
"Validating the machinery without spending tokens".
"""

import pytest

from agentlib import ciresult, guard, orchestrator
from agentlib import spec as sp
from agentlib import state as st
from agentlib import telemetry as tm

SPEC = {
    "task_id": "DEMO-001",
    "objective": "demo",
    "acceptance_criteria": ["it works"],
    "allowed_paths": ["backend/app/users/**", "backend/tests/users/**"],
    "forbidden_paths": [],
    "required_context": ["wiki/CodeContext/Modules/0x01-users.md"],
    "required_skills": [],
    "workflow_policy": {
        "max_impl_attempts": 2,
        "require_red_baseline": True,
        "allow_test_edits_during_impl": False,
        "run_context_maintainer": True,
    },
}

POLICY = {
    "roles": {
        "test_agent": {"write": ["backend/tests/**"], "deny": ["backend/app/**"]},
        "code_agent": {"write": ["backend/app/**"], "deny": ["backend/tests/**"]},
        "context_maintainer": {"write": ["wiki/CodeContext/Modules/*.md"], "deny": ["**"]},
        "manager": {"write": [], "deny": ["**"]},
        "distiller": {"write": [], "deny": ["**"]},
    }
}

FAILING_LOG = """
=========================== short test summary info ============================
FAILED backend/tests/users/test_tokens.py::test_rotation - assert None is not None
========================= 1 failed, 400 passed in 12.0s ========================
"""


class Harness:
    """Stands in for `.github/workflows/agent-orchestrator.yml`."""

    def __init__(self, tmp_path, max_attempts=2):
        self.telemetry_dir = tmp_path / "telemetry"
        self.state = st.new_state(
            SPEC["task_id"], branch=sp.branch_name(SPEC["task_id"]), max_attempts=max_attempts
        )
        self.dispatched = []

    def step(self, action_result=None):
        action = orchestrator.next_action(self.state, SPEC)
        self.dispatched.append(action["kind"] + ":" + action.get("role", ""))
        return action

    def agent_commits(self, role, paths, ok=True):
        result = guard.check_diff(paths, role, SPEC, POLICY)
        tm.record(
            self.telemetry_dir,
            {
                "task_id": SPEC["task_id"],
                "workflow_run_id": str(len(self.dispatched)),
                "role": role,
                "provider": "stub",
                "model": "stub-1",
                "session_id": None,
                "attempt": self.state["attempt"],
                "started_at": "2026-09-20T10:00:00Z",
                "ended_at": "2026-09-20T10:01:00Z",
                "input_tokens": 100,
                "output_tokens": 10,
                "result": "committed" if result.ok else "guard_violation",
                "commit_sha": "cafe" + str(len(self.dispatched)),
                "ci_run_id": None,
            },
        )
        if not result.ok:
            self.state = st.advance(
                self.state, "GUARD_VIOLATION", reason=result.violations[0].reason
            )
            return False
        self.state = st.advance(self.state, "AGENT_COMMITTED")
        return True


@pytest.fixture
def h(tmp_path):
    return Harness(tmp_path)


class TestGreenPath:
    def test_spec_to_complete(self, h):
        assert orchestrator.next_action(h.state, SPEC)["kind"] == "validate"
        h.state = st.advance(h.state, "VALIDATED")

        assert h.step() == {
            "kind": "dispatch_agent",
            "role": "test_agent",
            "event": "DISPATCH_TEST_AGENT",
        }
        h.state = st.advance(h.state, "DISPATCH_TEST_AGENT")
        assert h.agent_commits("test_agent", ["backend/tests/users/test_tokens.py"])

        assert h.step()["kind"] == "run_ci"
        h.state = st.advance(h.state, "CI_STARTED")
        # Red baseline: CI must be red here, and the machine treats red as progress.
        h.state = st.advance(h.state, "CI_FAILED")
        assert h.state["state"] == "READY_FOR_IMPLEMENTATION"

        assert h.step()["role"] == "code_agent"
        h.state = st.advance(h.state, "DISPATCH_CODE_AGENT")
        assert h.agent_commits("code_agent", ["backend/app/users/tokens.py"])

        h.state = st.advance(h.state, "CI_STARTED")
        h.state = st.advance(h.state, "CI_PASSED")

        assert h.step()["role"] == "context_maintainer"
        h.state = st.advance(h.state, "DISPATCH_MAINTAINER")
        h.state = st.advance(h.state, "MAINTAINER_DONE")

        assert h.state["state"] == "COMPLETE"
        assert st.is_terminal(h.state)

    def test_context_maintenance_is_skipped_when_the_spec_opts_out(self, h):
        spec = dict(
            SPEC, workflow_policy=dict(SPEC["workflow_policy"], run_context_maintainer=False)
        )
        h.state = st.advance(dict(h.state, state="IMPL_CI", attempt=1), "CI_PASSED", spec=spec)
        assert h.state["state"] == "COMPLETE"


class TestFailureRetryPath:
    def test_fail_distil_retry_then_pass(self, h, tmp_path):
        h.state = dict(h.state, state="IMPL_CI", attempt=1)
        h.state = st.advance(h.state, "CI_FAILED")
        assert h.step()["kind"] == "distill"

        distilled = ciresult.distill(
            FAILING_LOG, ci_status="failure", task_id="DEMO-001", attempt=1
        )
        assert distilled["origin"] == "implementation"
        h.state = st.advance(h.state, "DISTILLED", distilled=distilled)
        assert h.state["state"] == "RETRY_READY"
        # The retry prompt carries the distilled result, never the raw log.
        assert h.state["distilled"]["failures"][0]["test"].endswith("::test_rotation")

        assert h.step()["role"] == "code_agent"
        h.state = st.advance(h.state, "DISPATCH_CODE_AGENT")
        assert h.state["attempt"] == 2
        assert h.agent_commits("code_agent", ["backend/app/users/tokens.py"])
        h.state = st.advance(h.state, "CI_STARTED")
        h.state = st.advance(h.state, "CI_PASSED")
        assert h.state["state"] == "CONTEXT_MAINTENANCE"

    def test_budget_exhaustion_reaches_the_manager_not_an_infinite_loop(self, h):
        h.state = dict(h.state, state="IMPL_CI", attempt=2, max_attempts=2)
        h.state = st.advance(h.state, "CI_FAILED")
        h.state = st.advance(h.state, "DISTILLED", distilled={})
        assert h.state["state"] == "MANAGER_REVIEW"
        assert h.step()["role"] == "manager"

    def test_the_loop_cannot_run_forever(self, h):
        """Drive the retry cycle greedily; it must terminate."""
        h.state = dict(h.state, state="READY_FOR_IMPLEMENTATION")
        for _ in range(50):
            if st.is_terminal(h.state) or h.state["state"] in ("MANAGER_REVIEW", "ESCALATED"):
                break
            action = orchestrator.next_action(h.state, SPEC)
            if action["kind"] == "dispatch_agent" and action["role"] == "code_agent":
                h.state = st.advance(h.state, "DISPATCH_CODE_AGENT")
                h.state = st.advance(h.state, "AGENT_COMMITTED")
                h.state = st.advance(h.state, "CI_STARTED")
                h.state = st.advance(h.state, "CI_FAILED")
            elif action["kind"] == "distill":
                h.state = st.advance(h.state, "DISTILLED", distilled={})
            else:
                break
        assert h.state["state"] == "MANAGER_REVIEW"
        assert h.state["attempt"] <= SPEC["workflow_policy"]["max_impl_attempts"]


class TestGuardBlocksAMisbehavingWorker:
    def test_a_code_agent_touching_the_workflow_is_stopped_and_escalated(self, h):
        h.state = dict(h.state, state="CODE_AGENT_RUNNING", attempt=1)
        ok = h.agent_commits(
            "code_agent", ["backend/app/users/tokens.py", ".github/workflows/agent-worker.yml"]
        )
        assert ok is False
        assert h.state["state"] == "ESCALATED"
        assert orchestrator.next_action(h.state, SPEC)["kind"] == "halt"

    def test_a_test_agent_writing_production_code_is_stopped(self, h):
        h.state = dict(h.state, state="TEST_AGENT_RUNNING")
        assert h.agent_commits("test_agent", ["backend/app/users/tokens.py"]) is False
        assert h.state["state"] == "ESCALATED"


class TestHumanControl:
    def test_a_paused_task_dispatches_nothing(self, h):
        h.state = st.set_control(dict(h.state, state="READY_FOR_IMPLEMENTATION"), "PAUSE")
        assert orchestrator.next_action(h.state, SPEC) == {"kind": "halt", "reason": "paused"}

    def test_a_cancelled_task_dispatches_nothing(self, h):
        h.state = st.set_control(dict(h.state, state="IMPL_CI"), "CANCEL")
        assert orchestrator.next_action(h.state, SPEC)["kind"] == "cancel"


class TestStatelessReconstruction:
    def test_a_fresh_orchestrator_needs_only_the_state_file(self, h, tmp_path):
        h.state = dict(h.state, state="RETRY_READY", attempt=1, sessions={"manager": "sess-x"})
        p = tmp_path / "state.json"
        st.save_state(p, h.state)

        reloaded = st.load_state(p)
        no_sessions = dict(reloaded, sessions={})
        assert orchestrator.next_action(reloaded, SPEC) == orchestrator.next_action(
            no_sessions, SPEC
        )

    def test_telemetry_accumulates_across_the_run(self, h):
        h.state = dict(h.state, state="TEST_AGENT_RUNNING")
        h.agent_commits("test_agent", ["backend/tests/users/test_tokens.py"])
        h.state = dict(h.state, state="CODE_AGENT_RUNNING", attempt=1)
        h.agent_commits("code_agent", ["backend/app/users/tokens.py"])
        summary = tm.aggregate(h.telemetry_dir)
        assert summary["by_task"]["DEMO-001"]["invocations"] == 2
        assert summary["totals"]["total_tokens"] == 220


class TestDispatchContract:
    """The orchestrator/worker contract that the first live run broke.

    A worker finishes by emitting AGENT_COMMITTED, which is only legal from a
    *_RUNNING state. So every `dispatch_agent` action must carry the transition
    that gets the machine there, and the orchestrator must apply it before it
    dispatches. When that mapping lived only in workflow YAML it was simply
    missing, and nothing here could see it.
    """

    DISPATCHING_STATES = [
        "READY",
        "READY_FOR_IMPLEMENTATION",
        "RETRY_READY",
        "CONTEXT_MAINTENANCE",
        "MANAGER_REVIEW",
    ]

    @pytest.mark.parametrize("state", DISPATCHING_STATES)
    def test_every_dispatch_names_a_legal_transition(self, state):
        s = dict(st.new_state("DEMO-001", branch="agent/DEMO-001", max_attempts=3), state=state)
        action = orchestrator.next_action(s, SPEC)
        assert action["kind"] == "dispatch_agent"

        event = action.get("event")
        if event is None:
            # Only the manager may hold its state: it decides its own next move.
            assert action["role"] == "manager"
            return
        st.advance(s, event)  # must not raise

    def test_a_dispatched_worker_can_then_report_a_commit(self):
        """Dispatch -> AGENT_COMMITTED must work for every committing role."""
        for state in ("READY", "READY_FOR_IMPLEMENTATION"):
            s = dict(st.new_state("DEMO-001", branch="agent/DEMO-001", max_attempts=3), state=state)
            s = st.advance(s, orchestrator.next_action(s, SPEC)["event"])
            assert s["state"].endswith("_RUNNING")
            s = st.advance(s, "AGENT_COMMITTED")
            assert s["state"] in ("TESTS_COMMITTED", "IMPL_COMMITTED")

    def test_dispatching_the_code_agent_is_what_spends_the_budget(self):
        # If the orchestrator skips this event, `attempt` never rises and the
        # retry loop has no ceiling at all.
        s = dict(st.new_state("DEMO-001", max_attempts=3), state="READY_FOR_IMPLEMENTATION")
        assert s["attempt"] == 0
        s = st.advance(s, orchestrator.next_action(s, SPEC)["event"])
        assert s["attempt"] == 1
