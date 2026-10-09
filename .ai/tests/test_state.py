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

    def test_progress_clears_a_stale_escalation_reason(self):
        # The board shows `escalation_reason` as the headline for a task. A
        # task that recovered and completed must not still be advertising why
        # it once stalled.
        s = fresh(state="IMPL_CI", attempt=2, escalation_reason="max_attempts_exhausted")
        s = st.advance(s, "CI_PASSED")
        assert s["escalation_reason"] is None

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


class TestInvocationFailuresAreBounded:
    """The runaway loop from run 35553951441..35554168040.

    A worker whose provider call fails emits AGENT_FAILED, which routed to
    MANAGER_REVIEW — from *any* state, including MANAGER_REVIEW itself. The
    orchestrator then dispatched the manager, whose provider call failed the
    same way, forever. `attempt` never moved, because only DISPATCH_CODE_AGENT
    increments it, so HARD_MAX_ATTEMPTS never applied. Nothing bounded it.
    """

    def test_a_manager_that_cannot_be_invoked_escalates_instead_of_looping(self):
        # This is the exact transition that looped: the ONE state where
        # AGENT_FAILED must not route back to the manager, because the manager
        # is the thing that just failed.
        s = fresh(state="MANAGER_REVIEW")
        s = st.advance(s, "AGENT_FAILED", reason="provider invocation failed")
        assert s["state"] == "ESCALATED"

    def test_a_worker_failure_still_reaches_the_manager_once(self):
        s = fresh(state="TEST_AGENT_RUNNING")
        s = st.advance(s, "AGENT_FAILED", reason="provider 500")
        assert s["state"] == "MANAGER_REVIEW"
        assert s["consecutive_failures"] == 1

    def test_repeated_failures_escalate_even_without_passing_through_review(self):
        s = fresh(state="CODE_AGENT_RUNNING", attempt=1)
        for _ in range(st.MAX_CONSECUTIVE_FAILURES):
            s = st.advance(dict(s, state="CODE_AGENT_RUNNING"), "AGENT_FAILED", reason="flaky")
        assert s["state"] == "ESCALATED"
        assert "consecutive" in (s["escalation_reason"] or "")

    def test_progress_resets_the_failure_counter(self):
        s = fresh(state="TEST_AGENT_RUNNING")
        s = st.advance(s, "AGENT_FAILED", reason="transient")
        assert s["consecutive_failures"] == 1
        s = st.advance(dict(s, state="TEST_AGENT_RUNNING"), "AGENT_COMMITTED")
        assert s["consecutive_failures"] == 0

    def test_a_brand_new_state_starts_with_no_failures(self):
        assert st.new_state("DEMO-001")["consecutive_failures"] == 0


# --------------------------------------------------------------------------- D3


class TestEveryManagerInvocationIsCountedAndBounded:
    """handoff.md §10, D3 (L1). The orchestrator dispatched the manager from
    MANAGER_REVIEW with no event at all, so a manager whose worker applied
    nothing was re-dispatched with no history entry and no budget counting
    it. Every dispatch, the manager's included, is now an event, and the
    manager has a ceiling of its own."""

    def test_dispatching_the_manager_is_recorded(self):
        s = fresh(state="MANAGER_REVIEW")
        s = st.advance(s, "DISPATCH_MANAGER")
        assert s["state"] == "MANAGER_REVIEW"
        assert s["history"][-1]["event"] == "DISPATCH_MANAGER"
        assert s["manager_invocations"] == 1

    def test_the_manager_may_only_be_dispatched_from_review(self):
        with pytest.raises(st.StateError):
            st.advance(fresh(state="READY"), "DISPATCH_MANAGER")

    def test_exceeding_the_manager_bound_escalates(self):
        s = fresh(state="MANAGER_REVIEW")
        for _ in range(st.MAX_MANAGER_INVOCATIONS):
            s = st.advance(s, "DISPATCH_MANAGER")
            assert s["state"] == "MANAGER_REVIEW"
        s = st.advance(s, "DISPATCH_MANAGER")
        assert s["state"] == "ESCALATED"
        assert "manager" in s["escalation_reason"]
        assert str(st.MAX_MANAGER_INVOCATIONS) in s["escalation_reason"]

    def test_the_bound_is_small(self):
        assert 1 <= st.MAX_MANAGER_INVOCATIONS <= 5

    def test_a_manager_that_applies_nothing_cannot_loop(self):
        # The L1 shape: the manager is dispatched, its worker records nothing,
        # and the orchestrator dispatches it again. It must stop on its own.
        s = fresh(state="MANAGER_REVIEW")
        for _ in range(50):
            if s["state"] != "MANAGER_REVIEW":
                break
            s = st.advance(s, "DISPATCH_MANAGER")
        assert s["state"] == "ESCALATED"
        assert len(s["history"]) == st.MAX_MANAGER_INVOCATIONS + 1

    def test_a_brand_new_state_has_invoked_no_manager(self):
        assert st.new_state("DEMO-001")["manager_invocations"] == 0


class TestEveryDispatchIsRecorded:
    """handoff.md §10, D3 (detection). The time and target of every worker
    and CI dispatch is kept in state.json, so a result that never arrives is
    visible as an overdue dispatch rather than as nothing at all."""

    @pytest.mark.parametrize(
        "state,event,workflow,role",
        [
            ("READY", "DISPATCH_TEST_AGENT", "agent-worker", "test_agent"),
            ("READY_FOR_IMPLEMENTATION", "DISPATCH_CODE_AGENT", "agent-worker", "code_agent"),
            ("CONTEXT_MAINTENANCE", "DISPATCH_MAINTAINER", "agent-worker", "context_maintainer"),
            ("MANAGER_REVIEW", "DISPATCH_MANAGER", "agent-worker", "manager"),
            ("TESTS_COMMITTED", "CI_STARTED", "test-agent", None),
            ("IMPL_COMMITTED", "CI_STARTED", "test-agent", None),
        ],
    )
    def test_the_dispatch_is_recorded(self, state, event, workflow, role):
        s = st.advance(fresh(state=state), event)
        d = s["last_dispatch"]
        assert d["workflow"] == workflow
        assert d["role"] == role
        assert d["event"] == event
        assert d["at"] == s["updated_at"]
        assert d["run_id"] is None

    def test_a_brand_new_state_has_dispatched_nothing(self):
        s = st.new_state("DEMO-001")
        assert s["last_dispatch"] is None
        assert s["last_ci_run"] is None

    def test_the_ci_run_id_is_recorded_once_known(self):
        s = st.advance(fresh(state="IMPL_COMMITTED"), "CI_STARTED")
        s = st.note_ci_run(s, run_id="123", conclusion="success", commit="abc", applied=True)
        assert s["last_dispatch"]["run_id"] == "123"
        assert s["last_ci_run"]["run_id"] == "123"
        assert s["last_ci_run"]["conclusion"] == "success"
        assert s["last_ci_run"]["commit"] == "abc"
        assert s["last_ci_run"]["applied"] is True

    def test_a_ci_run_does_not_claim_a_worker_dispatch(self):
        s = st.advance(fresh(state="READY"), "DISPATCH_TEST_AGENT")
        s = st.note_ci_run(s, run_id="9", conclusion="success", commit="abc", applied=False)
        assert s["last_dispatch"]["run_id"] is None
        assert s["last_ci_run"]["run_id"] == "9"

    def test_noting_a_run_is_not_a_transition(self):
        s = st.advance(fresh(state="IMPL_COMMITTED"), "CI_STARTED")
        before = len(s["history"])
        s = st.note_ci_run(s, run_id="1", conclusion="cancelled", commit="abc", applied=False)
        assert len(s["history"]) == before
        assert s["state"] == "IMPL_CI"


def _minutes_after(at: str, minutes: int):
    from datetime import UTC, datetime, timedelta

    return datetime.strptime(at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) + timedelta(
        minutes=minutes
    )


class TestALostResultIsDetected:
    """handoff.md §10, D3 (detection). `stalled` says a task is waiting on a
    dispatch older than that workflow can possibly run for."""

    def test_a_worker_overdue_is_stalled(self):
        s = st.advance(fresh(state="READY_FOR_IMPLEMENTATION"), "DISPATCH_CODE_AGENT")
        limit = st.DISPATCH_TIMEOUT_MINUTES["agent-worker"] + st.STALL_GRACE_MINUTES
        assert st.stalled(s, _minutes_after(s["updated_at"], limit - 1)) is None
        reason = st.stalled(s, _minutes_after(s["updated_at"], limit + 1))
        assert reason and "agent-worker" in reason and "code_agent" in reason

    def test_ci_overdue_is_stalled(self):
        s = st.advance(fresh(state="IMPL_COMMITTED"), "CI_STARTED")
        limit = st.DISPATCH_TIMEOUT_MINUTES["test-agent"] + st.STALL_GRACE_MINUTES
        assert st.stalled(s, _minutes_after(s["updated_at"], limit - 1)) is None
        assert "test-agent" in st.stalled(s, _minutes_after(s["updated_at"], limit + 1))

    def test_a_manager_in_flight_is_watched_too(self):
        s = st.advance(fresh(state="MANAGER_REVIEW"), "DISPATCH_MANAGER")
        assert st.stalled(s, _minutes_after(s["updated_at"], 10_000))

    def test_nothing_in_flight_is_never_stalled(self):
        s = st.advance(fresh(state="DRAFT"), "VALIDATED")
        assert st.stalled(s, _minutes_after(s["updated_at"], 10_000)) is None

    def test_a_result_that_arrived_clears_it(self):
        s = st.advance(fresh(state="READY"), "DISPATCH_TEST_AGENT")
        s = st.advance(s, "AGENT_COMMITTED")
        assert st.stalled(s, _minutes_after(s["updated_at"], 10_000)) is None

    def test_a_finished_task_is_never_stalled(self):
        s = st.advance(fresh(state="READY"), "DISPATCH_TEST_AGENT")
        s = dict(s, state="CANCELLED")
        assert st.stalled(s, _minutes_after(s["updated_at"], 10_000)) is None

    def test_a_state_written_before_d3_does_not_crash(self):
        # USERS-002 and DEMO-001 have state files with none of D3's fields.
        s = fresh(state="CODE_AGENT_RUNNING")
        for key in ("last_dispatch", "last_ci_run", "manager_invocations"):
            s.pop(key, None)
        s["history"] = [
            {"at": "2026-09-23T05:10:08Z", "from": "x", "to": "y", "event": "DISPATCH_CODE_AGENT"}
        ]
        assert st.stalled(s, _minutes_after("2026-09-23T05:10:08Z", 10_000))


class TestEveryCiConclusionHasACase:
    """handoff.md §10, D3 (S1). Any conclusion but success, failure and
    timed_out fell through as "nothing to apply", leaving the task waiting on
    CI forever. Every documented conclusion now has an explicit case, and
    anything that is not a real test verdict escalates to a human instead of
    spending the code agent's attempts."""

    DOCUMENTED = (
        "success",
        "failure",
        "timed_out",
        "cancelled",
        "skipped",
        "stale",
        "neutral",
        "action_required",
        "startup_failure",
    )

    def test_every_documented_conclusion_is_listed(self):
        assert set(self.DOCUMENTED) == set(st.CI_CONCLUSIONS)

    def test_a_pass_is_a_pass(self):
        assert st.ci_event("success") == "CI_PASSED"

    @pytest.mark.parametrize("conclusion", ["failure", "timed_out"])
    def test_a_failure_is_a_failure(self, conclusion):
        assert st.ci_event(conclusion) == "CI_FAILED"

    @pytest.mark.parametrize(
        "conclusion",
        ["cancelled", "skipped", "stale", "neutral", "action_required", "startup_failure"],
    )
    def test_anything_else_escalates(self, conclusion):
        assert st.ci_event(conclusion) == "ESCALATE"

    @pytest.mark.parametrize("conclusion", ["", "bogus", "SUCCESS"])
    def test_an_unknown_conclusion_escalates(self, conclusion):
        assert st.ci_event(conclusion) == "ESCALATE"

    def test_a_cancelled_baseline_is_not_red_as_required(self):
        # The case that matters most: a cancelled baseline run counted as
        # "red" would open implementation on tests nobody ran.
        s = fresh(state="BASELINE_CI")
        s = st.advance(s, st.ci_event("cancelled"), reason="CI run 7 concluded 'cancelled'")
        assert s["state"] == "ESCALATED"
        assert s["attempt"] == 0


class TestAHumanCanRecoverAnEscalatedTask:
    """handoff.md §10, D3 (S9) and §10.3 item 3. operations.md told a human to
    recover an ESCALATED task with MANAGER_RETRY or MANAGER_RESCOPE; both were
    illegal from ESCALATED."""

    def test_retry_from_escalated(self):
        s = fresh(state="ESCALATED", attempt=3, max_attempts=3, escalation_reason="x")
        s = st.advance(s, "MANAGER_RETRY", extra_attempts=1)
        assert s["state"] == "RETRY_READY"
        assert s["max_attempts"] == 4
        assert s["escalation_reason"] is None

    def test_rescope_from_escalated(self):
        s = fresh(state="ESCALATED", escalation_reason="x")
        s = st.advance(s, "MANAGER_RESCOPE")
        assert s["state"] == "READY"

    def test_retry_from_escalated_still_respects_the_hard_cap(self):
        s = fresh(state="ESCALATED", attempt=8, max_attempts=st.HARD_MAX_ATTEMPTS)
        with pytest.raises(st.StateError, match="hard cap"):
            st.advance(s, "MANAGER_RETRY", extra_attempts=1)

    def test_a_human_recovery_resets_the_manager_bound(self):
        s = fresh(state="ESCALATED", manager_invocations=st.MAX_MANAGER_INVOCATIONS + 1)
        s = st.advance(s, "MANAGER_RESCOPE")
        assert s["manager_invocations"] == 0

    def test_a_late_worker_failure_does_not_un_escalate(self):
        # The fallback that records a worker result it could not apply is
        # AGENT_FAILED. From ESCALATED it must stay ESCALATED: routing it to
        # MANAGER_REVIEW would let a worker's run take a task back from a
        # human.
        s = fresh(state="ESCALATED", escalation_reason="guard violation: x")
        s = st.advance(s, "AGENT_FAILED", reason="late")
        assert s["state"] == "ESCALATED"
        assert s["escalation_reason"] == "guard violation: x"
