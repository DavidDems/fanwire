"""What to do next, given a state file and a spec.

`next_action` is the whole dispatch decision, as a pure function. The GitHub
Actions workflow is a thin shell around it: read state -> ask -> do one thing ->
write state. Keeping the decision here (rather than in workflow `if:`
expressions) is what makes the workflow auditable and testable without GitHub.
"""

from __future__ import annotations

from typing import Any

from . import spec as spec_mod
from . import state as st

# state -> the one thing the orchestrator does next.
#   validate        deterministic: run `agentctl task validate`
#   dispatch_agent  invoke the named role through .github/workflows/agent-worker.yml.
#                   Carries the `event` the orchestrator must apply BEFORE
#                   dispatching, so the role -> transition mapping lives here
#                   and not in workflow YAML. Duplicating it in YAML is what
#                   let a worker report AGENT_COMMITTED from READY, and left
#                   the attempt counter never incrementing.
#   run_ci          trigger .github/workflows/test-agent.yml on the task branch
#   await_ci        nothing to do; a workflow_run event will wake the orchestrator
#   await_agent     nothing to do; the worker job reports back when it finishes
#   distill         deterministic parse, plus an optional cheap-model pass
#   halt            terminal or human-gated; the orchestrator stops
#   cancel          human cancelled; tear the task down
_ACTIONS: dict[str, dict[str, Any]] = {
    "DRAFT": {"kind": "validate"},
    "READY": {"kind": "dispatch_agent", "role": "test_agent", "event": "DISPATCH_TEST_AGENT"},
    "TEST_AGENT_RUNNING": {"kind": "await_agent", "role": "test_agent"},
    "TESTS_COMMITTED": {"kind": "run_ci", "phase": "baseline"},
    "BASELINE_CI": {"kind": "await_ci", "phase": "baseline"},
    "READY_FOR_IMPLEMENTATION": {
        "kind": "dispatch_agent",
        "role": "code_agent",
        "event": "DISPATCH_CODE_AGENT",
    },
    "RETRY_READY": {
        "kind": "dispatch_agent",
        "role": "code_agent",
        "event": "DISPATCH_CODE_AGENT",
    },
    "CODE_AGENT_RUNNING": {"kind": "await_agent", "role": "code_agent"},
    "IMPL_COMMITTED": {"kind": "run_ci", "phase": "implementation"},
    "IMPL_CI": {"kind": "await_ci", "phase": "implementation"},
    "DISTILLING": {"kind": "distill"},
    # No event: MANAGER_REVIEW holds until the manager itself returns a decision.
    "MANAGER_REVIEW": {"kind": "dispatch_agent", "role": "manager"},
    "CONTEXT_MAINTENANCE": {
        "kind": "dispatch_agent",
        "role": "context_maintainer",
        "event": "DISPATCH_MAINTAINER",
    },
}


def next_action(state: dict, spec: dict | None = None) -> dict[str, Any]:
    """Pure: identical input, identical decision. Never reads the filesystem,
    never needs a live agent session."""
    control = state.get("control", "RUN")
    if control == "CANCEL":
        return {"kind": "cancel", "reason": "cancelled by human"}
    if control == "PAUSE":
        return {"kind": "halt", "reason": "paused"}

    current = state["state"]
    if current in st.TERMINAL:
        return {"kind": "halt", "reason": current.lower()}
    if current == "ESCALATED":
        return {"kind": "halt", "reason": state.get("escalation_reason") or "escalated"}

    action = _ACTIONS.get(current)
    if action is None:  # pragma: no cover - every non-terminal state is mapped
        return {"kind": "halt", "reason": f"no action defined for {current}"}
    return dict(action)


def worker_context(state: dict, spec: dict) -> dict[str, Any]:
    """Everything a freshly-started worker needs, assembled from durable state.

    Note what is *not* here: no conversation transcript, no prior agent's prose,
    no raw CI log. A worker gets its task contract, the context files the
    Director named, and (on a retry) the distilled result — nothing else.
    """
    action = next_action(state, spec)
    role = action.get("role")
    policy = spec_mod.workflow_policy(spec)
    return {
        "role": role,
        "task_id": state["task_id"],
        "branch": state["branch"],
        "attempt": state["attempt"],
        "max_attempts": state["max_attempts"],
        "objective": spec.get("objective"),
        "acceptance_criteria": spec.get("acceptance_criteria", []),
        "allowed_paths": spec.get("allowed_paths", []),
        "forbidden_paths": spec.get("forbidden_paths", []),
        "required_context": spec.get("required_context", []),
        "required_skills": spec.get("required_skills", []),
        "allow_test_edits": bool(policy["allow_test_edits_during_impl"]),
        "distilled": state.get("distilled"),
        "escalation_reason": state.get("escalation_reason"),
        # Optional: resume a provider session if one is recorded and the
        # provider still has it. Absence must change nothing above.
        "resume_session_id": state.get("sessions", {}).get(role),
    }
