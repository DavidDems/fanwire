"""The workflow state machine — the single authoritative transition table.

Every transition an orchestrator performs goes through `state.advance`. No
workflow YAML, prompt, or agent is allowed to invent a transition.
"""

import pytest

from agentlib import state as st


def fresh(**over):
    s = st.new_state("DEMO-001", branch="agent/DEMO-001", max_attempts=3)
    s.update(over)
    return s


class TestNewState:
    def test_starts_in_draft_under_run_control(self):
        s = st.new_state("DEMO-001", branch="agent/DEMO-001")
        assert s["state"] == "DRAFT"
        assert s["control"] == "RUN"
        assert s["attempt"] == 0
        assert s["history"] == []

    def test_carries_identity_needed_to_reconstruct_without_a_session(self):
        s = st.new_state("DEMO-001", branch="agent/DEMO-001")
        assert s["task_id"] == "DEMO-001"
        assert s["branch"] == "agent/DEMO-001"
        assert s["sessions"] == {}


class TestHappyPath:
    def test_full_green_run(self):
        s = fresh()
        s = st.advance(s, "VALIDATED")
        assert s["state"] == "READY"
        s = st.advance(s, "DISPATCH_TEST_AGENT")
        assert s["state"] == "TEST_AGENT_RUNNING"
        s = st.advance(s, "AGENT_COMMITTED")
        assert s["state"] == "TESTS_COMMITTED"
        s = st.advance(s, "CI_STARTED")
        assert s["state"] == "BASELINE_CI"
        # Red baseline: the new tests MUST fail before any implementation runs.
        s = st.advance(s, "CI_FAILED")
        assert s["state"] == "READY_FOR_IMPLEMENTATION"
        s = st.advance(s, "DISPATCH_CODE_AGENT")
        assert s["state"] == "CODE_AGENT_RUNNING"
        assert s["attempt"] == 1
        s = st.advance(s, "AGENT_COMMITTED")
        s = st.advance(s, "CI_STARTED")
        assert s["state"] == "IMPL_CI"
        s = st.advance(s, "CI_PASSED")
        assert s["state"] == "CONTEXT_MAINTENANCE"
        s = st.advance(s, "MAINTAINER_DONE")
        assert s["state"] == "COMPLETE"

    def test_history_is_append_only_and_records_every_hop(self):
        s = fresh()
        s = st.advance(s, "VALIDATED")
        s = st.advance(s, "DISPATCH_TEST_AGENT")
        assert [h["to"] for h in s["history"]] == ["READY", "TEST_AGENT_RUNNING"]
        assert s["history"][0]["from"] == "DRAFT"
        assert s["history"][0]["event"] == "VALIDATED"
        assert s["history"][0]["at"]


class TestRedBaseline:
    def test_green_baseline_goes_to_manager_review_not_implementation(self):
        s = fresh(state="BASELINE_CI")
        s = st.advance(s, "CI_PASSED")
        assert s["state"] == "MANAGER_REVIEW"
        assert s["escalation_reason"] == "red_baseline_not_red"

    def test_red_baseline_can_be_waived_by_workflow_policy(self):
        s = fresh(state="BASELINE_CI", require_red_baseline=False)
        s = st.advance(s, "CI_PASSED")
        assert s["state"] == "READY_FOR_IMPLEMENTATION"


class TestRetryPolicy:
    def test_failed_ci_distils_then_retries_while_budget_remains(self):
        s = fresh(state="IMPL_CI", attempt=1, max_attempts=3)
        s = st.advance(s, "CI_FAILED")
        assert s["state"] == "DISTILLING"
        s = st.advance(s, "DISTILLED")
        assert s["state"] == "RETRY_READY"
        s = st.advance(s, "DISPATCH_CODE_AGENT")
        assert s["state"] == "CODE_AGENT_RUNNING"
        assert s["attempt"] == 2

    def test_exhausted_budget_goes_to_manager_review(self):
        s = fresh(state="DISTILLING", attempt=3, max_attempts=3)
        s = st.advance(s, "DISTILLED")
        assert s["state"] == "MANAGER_REVIEW"
        assert s["escalation_reason"] == "max_attempts_exhausted"

    def test_manager_may_grant_more_budget_within_the_hard_cap(self):
        s = fresh(state="MANAGER_REVIEW", attempt=3, max_attempts=3)
        s = st.advance(s, "MANAGER_RETRY", extra_attempts=2)
        assert s["state"] == "RETRY_READY"
        assert s["max_attempts"] == 5

    def test_manager_cannot_exceed_the_hard_cap(self):
        s = fresh(state="MANAGER_REVIEW", attempt=8, max_attempts=st.HARD_MAX_ATTEMPTS)
        with pytest.raises(st.StateError, match="hard cap"):
            st.advance(s, "MANAGER_RETRY", extra_attempts=1)

    def test_manager_may_escalate_instead(self):
        s = fresh(state="MANAGER_REVIEW")
        s = st.advance(s, "ESCALATE", reason="needs architectural decision")
        assert s["state"] == "ESCALATED"
        assert s["escalation_reason"] == "needs architectural decision"

    def test_manager_may_send_the_task_back_for_re_specification(self):
        s = fresh(state="MANAGER_REVIEW")
        s = st.advance(s, "MANAGER_RESCOPE")
        assert s["state"] == "READY"


class TestFailureHandling:
    def test_agent_crash_never_vanishes(self):
        s = fresh(state="CODE_AGENT_RUNNING", attempt=1)
        s = st.advance(s, "AGENT_FAILED", reason="provider 500")
        assert s["state"] == "MANAGER_REVIEW"
        assert s["escalation_reason"] == "provider 500"

    def test_guard_violation_is_terminal_for_the_attempt(self):
        s = fresh(state="CODE_AGENT_RUNNING", attempt=1)
        s = st.advance(s, "GUARD_VIOLATION", reason="wrote .github/workflows/x.yml")
        assert s["state"] == "ESCALATED"

    def test_illegal_transition_raises_rather_than_guessing(self):
        s = fresh(state="COMPLETE")
        with pytest.raises(st.StateError):
            st.advance(s, "CI_FAILED")

    def test_unknown_event_raises(self):
        s = fresh(state="READY")
        with pytest.raises(st.StateError, match="unknown event"):
            st.advance(s, "MAKE_COFFEE")


class TestHumanControl:
    def test_pause_blocks_every_workflow_event(self):
        s = fresh(state="READY_FOR_IMPLEMENTATION", control="PAUSE")
        with pytest.raises(st.Paused):
            st.advance(s, "DISPATCH_CODE_AGENT")

    def test_resume_restores_the_exact_state_it_paused_in(self):
        s = fresh(state="READY_FOR_IMPLEMENTATION")
        s = st.set_control(s, "PAUSE")
        assert s["state"] == "READY_FOR_IMPLEMENTATION"
        s = st.set_control(s, "RUN")
        s = st.advance(s, "DISPATCH_CODE_AGENT")
        assert s["state"] == "CODE_AGENT_RUNNING"

    def test_cancel_is_honoured_from_any_live_state(self):
        s = fresh(state="IMPL_CI")
        s = st.set_control(s, "CANCEL")
        s = st.advance(s, "CANCEL")
        assert s["state"] == "CANCELLED"
        assert st.is_terminal(s)

    def test_cancelled_state_accepts_nothing_further(self):
        s = fresh(state="CANCELLED")
        with pytest.raises(st.StateError):
            st.advance(s, "CI_PASSED")


class TestSessionResumption:
    def test_session_ids_are_recorded_but_never_required(self):
        s = fresh(state="MANAGER_REVIEW")
        s = st.record_session(s, "manager", "sess-abc123")
        assert s["sessions"]["manager"] == "sess-abc123"
        # Dropping every session id must not change what the machine does next.
        s_without = dict(s, sessions={})
        assert (
            st.advance(dict(s), "MANAGER_RESCOPE")["state"]
            == st.advance(s_without, "MANAGER_RESCOPE")["state"]
        )


class TestRoundTrip:
    def test_state_survives_json_round_trip(self, tmp_path):
        s = fresh(state="IMPL_CI", attempt=2)
        p = tmp_path / "state.json"
        st.save_state(p, s)
        assert st.load_state(p) == s

    def test_loading_a_state_with_an_unknown_name_fails_closed(self, tmp_path):
        p = tmp_path / "state.json"
        p.write_text('{"task_id": "X-001", "state": "TOTALLY_MADE_UP"}', encoding="utf-8")
        with pytest.raises(st.StateError):
            st.load_state(p)
