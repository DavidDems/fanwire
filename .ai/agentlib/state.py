"""The workflow state machine.

One authoritative transition table for the whole system. Workflows, prompts and
agents do not get to invent transitions — they emit an *event*, and this module
decides what the new state is. That is what keeps the workflow reconstructible
from `state.json` alone, with no live agent session.

Human control is modelled as a separate `control` field rather than as states,
so that pausing a task does not destroy the workflow state it must resume into.
See `.ai/docs/state-machine.md`.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

# Absolute ceiling on implementation attempts. A Manager may raise a task's own
# budget, never past this. The retry loop is bounded by construction.
HARD_MAX_ATTEMPTS = 8

# Ceiling on back-to-back invocation failures, reset by any real progress.
# This is a SEPARATE budget from HARD_MAX_ATTEMPTS, which only counts code-agent
# dispatches: a provider that fails before doing any work never increments
# `attempt`, so without this counter such failures were unbounded. They were.
MAX_CONSECUTIVE_FAILURES = 3

# Ceiling on manager invocations per task (handoff.md §10, D3, L1). The manager
# is dispatched from MANAGER_REVIEW and holds that state until it decides, so a
# manager whose worker applied nothing used to be dispatched again with nothing
# counting it. Every dispatch is now DISPATCH_MANAGER, which counts, and the
# one after this many escalates. Three: each invocation is the manager's
# answer to a task that has already run out of road (a spent budget, a green
# baseline, a failed worker), and a task that needs a fourth answer needs a
# human. Reset only by a human recovering the task from ESCALATED.
MAX_MANAGER_INVOCATIONS = 3

# How long each workflow the orchestrator dispatches can legitimately run, in
# minutes: the longest chain of its jobs' `timeout-minutes`, counting GitHub's
# default of 360 for a job that declares none. Copies of the YAML, pinned to it
# by tests/test_workflows.py::TestStalledMeansPastTheWorkflowsOwnTimeout. A
# dispatch older than this plus STALL_GRACE_MINUTES, with nothing recorded
# since, is STALLED: its result is lost (handoff.md §10, D3).
#   agent-worker  run-model 45 + land 15
#   test-agent    changes -> a suite -> gate, none of which declares a timeout
DISPATCH_TIMEOUT_MINUTES: dict[str, int] = {"agent-worker": 60, "test-agent": 1080}

# Queueing, runner start-up and the hand-back, which no timeout covers.
STALL_GRACE_MINUTES = 15

STATES: frozenset[str] = frozenset(
    {
        "DRAFT",  # spec written, not yet validated
        "READY",  # spec valid, branch exists, nothing dispatched
        "TEST_AGENT_RUNNING",
        "TESTS_COMMITTED",
        "BASELINE_CI",  # CI on tests-only; it is supposed to be RED
        "READY_FOR_IMPLEMENTATION",
        "CODE_AGENT_RUNNING",
        "IMPL_COMMITTED",
        "IMPL_CI",
        "DISTILLING",
        "RETRY_READY",
        "MANAGER_REVIEW",
        "CONTEXT_MAINTENANCE",
        "COMPLETE",
        "ESCALATED",  # needs Director/human; recoverable by human action
        "CANCELLED",
        "FAILED",  # unrecoverable infrastructure failure
    }
)

TERMINAL: frozenset[str] = frozenset({"COMPLETE", "CANCELLED", "FAILED"})

# Reaching one of these means the task is moving forward again, so whatever
# reason it previously stalled for no longer describes it.
_CLEARS_ESCALATION: frozenset[str] = frozenset(
    {"READY", "READY_FOR_IMPLEMENTATION", "RETRY_READY", "CONTEXT_MAINTENANCE", "COMPLETE"}
)

CONTROLS: frozenset[str] = frozenset({"RUN", "PAUSE", "CANCEL"})

EVENTS: frozenset[str] = frozenset(
    {
        "VALIDATED",
        "DISPATCH_TEST_AGENT",
        "DISPATCH_CODE_AGENT",
        "DISPATCH_MAINTAINER",
        "AGENT_COMMITTED",
        "MAINTAINER_DONE",
        "AGENT_FAILED",
        "GUARD_VIOLATION",
        "CI_STARTED",
        "CI_PASSED",
        "CI_FAILED",
        # A baseline run that failed, but not because of the new tests
        # (handoff.md §10, D4): agentctl applies it in place of CI_FAILED
        # when ciresult.baseline_verdict says so.
        "CI_FAILED_WRONG_REASON",
        "DISTILLED",
        "MANAGER_RETRY",
        "MANAGER_RESCOPE",
        "ESCALATE",
        "CANCEL",
        "INFRA_FAILED",
        "DISPATCH_MANAGER",
    }
)

# Every event that starts something outside the orchestrator's own run, and
# what it starts. Applying one records `last_dispatch`; `stalled` watches it.
DISPATCHES: dict[str, tuple[str, str | None]] = {
    "DISPATCH_TEST_AGENT": ("agent-worker", "test_agent"),
    "DISPATCH_CODE_AGENT": ("agent-worker", "code_agent"),
    "DISPATCH_MAINTAINER": ("agent-worker", "context_maintainer"),
    "DISPATCH_MANAGER": ("agent-worker", "manager"),
    "CI_STARTED": ("test-agent", None),
}

# Every conclusion GitHub documents for a completed workflow run, and the
# event it means for a task waiting on CI (handoff.md §10, D3, S1). Only a run
# that actually ran the suites is a verdict. Everything else escalates rather
# than going to the manager: the manager's levers are another code-agent
# attempt, new tests, or a human, and an infrastructure outcome is fixed by
# neither of the first two, so routing it there spends the code agent's
# attempts on the runner's problem. `cancelled` is usually a person, who is
# then told. Escalating spends nothing; a human resumes it (operations.md).
CI_CONCLUSIONS: dict[str, str] = {
    "success": "CI_PASSED",
    "failure": "CI_FAILED",
    "timed_out": "CI_FAILED",  # the suites ran, too slowly: as before D3
    "cancelled": "ESCALATE",
    "skipped": "ESCALATE",
    "stale": "ESCALATE",
    "neutral": "ESCALATE",
    "action_required": "ESCALATE",
    "startup_failure": "ESCALATE",
}


class StateError(Exception):
    """An illegal or unknown transition. Always raised, never guessed around."""


class Paused(Exception):
    """A workflow event arrived while a human had the task paused."""


def new_state(task_id: str, branch: str = "", max_attempts: int = 3) -> dict[str, Any]:
    return {
        "schema": SCHEMA_VERSION,
        "task_id": task_id,
        "branch": branch,
        "state": "DRAFT",
        "control": "RUN",
        "attempt": 0,
        "max_attempts": max_attempts,
        "require_red_baseline": True,
        "history": [],
        "sessions": {},  # role -> provider session id; an optimisation, never a dependency
        "consecutive_failures": 0,
        "manager_invocations": 0,
        # What was last started outside the orchestrator's own run, when, and
        # (for CI, once its result arrives) the run id. A result that never
        # comes back is then an overdue dispatch, not nothing at all.
        "last_dispatch": None,
        "last_ci_run": None,  # the last CI result seen, applied or not
        "last_ci": None,
        "distilled": None,
        "escalation_reason": None,
        "updated_at": None,
    }


def is_terminal(state: dict) -> bool:
    return state["state"] in TERMINAL


def set_control(state: dict, control: str) -> dict[str, Any]:
    if control not in CONTROLS:
        raise StateError(f"unknown control {control!r}")
    out = dict(state)
    out["control"] = control
    out["updated_at"] = _now()
    return out


def ci_event(conclusion: str) -> str:
    """The event a `workflow_run` conclusion means. Unknown means ESCALATE."""
    return CI_CONCLUSIONS.get(conclusion, "ESCALATE")


def note_ci_run(
    state: dict, run_id: str, conclusion: str, commit: str | None, applied: bool
) -> dict[str, Any]:
    """Record a CI result that arrived, whether or not it was applied.

    Not a transition: a result discarded because the task was paused must
    still say which run was lost (handoff.md §10, D3, S2).
    """
    out = dict(state)
    out["last_ci_run"] = {
        "run_id": run_id,
        "conclusion": conclusion,
        "commit": commit,
        "applied": applied,
        "at": _now(),
    }
    dispatch = state.get("last_dispatch")
    if dispatch and dispatch.get("workflow") == "test-agent":
        out["last_dispatch"] = {**dispatch, "run_id": run_id}
    return out


def stalled(state: dict, now: datetime) -> str | None:
    """Why this task's in-flight dispatch is overdue, or None if it is not.

    In flight means the last thing that happened to the task was a dispatch:
    nothing has come back since. Overdue means older than the dispatched
    workflow can run for. Read from `history`, so a state file written before
    `last_dispatch` existed is watched too.
    """
    if state.get("state") in TERMINAL or state.get("state") == "ESCALATED":
        return None
    history = state.get("history") or []
    if not history:
        return None
    last = history[-1]
    target = DISPATCHES.get(last.get("event", ""))
    if target is None:
        return None
    workflow, role = target
    try:
        at = datetime.strptime(last["at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except (KeyError, TypeError, ValueError):
        return f"{workflow} dispatch has no readable time"
    age = int((now - at).total_seconds() // 60)
    limit = DISPATCH_TIMEOUT_MINUTES[workflow] + STALL_GRACE_MINUTES
    if age <= limit:
        return None
    what = f"{workflow} ({role})" if role else workflow
    seen = state.get("last_ci_run") or {}
    lost = ""
    if workflow == "test-agent" and seen.get("run_id") and not seen.get("applied"):
        lost = f"; run {seen['run_id']} concluded {seen.get('conclusion')!r}, not applied"
    return f"{what} dispatched {last['at']}, {age} min ago (limit {limit}){lost}"


# A full commit id, as the worker records it (`git rev-parse HEAD`).
_COMMIT_SHA = re.compile(r"[0-9a-f]{40}")


def test_commits(state: dict) -> list[str]:
    """Every commit the test agent landed on this task, oldest first.

    The worker applies AGENT_COMMITTED from TEST_AGENT_RUNNING with
    `--commit-sha`, which becomes that history entry's note; a test agent
    that produced no diff leaves a note that is not a commit, and is skipped.
    Every one counts, not just the last: after a re-scope the earlier tests
    are still this task's, and still on the branch (handoff.md §10, D4).
    """
    return [
        h["note"]
        for h in state.get("history") or []
        if h.get("event") == "AGENT_COMMITTED"
        and h.get("from") == "TEST_AGENT_RUNNING"
        and isinstance(h.get("note"), str)
        and _COMMIT_SHA.fullmatch(h["note"])
    ]


def record_session(state: dict, role: str, session_id: str) -> dict[str, Any]:
    out = dict(state)
    out["sessions"] = {**state.get("sessions", {}), role: session_id}
    return out


def advance(state: dict, event: str, **ctx: Any) -> dict[str, Any]:
    """Apply `event` to `state` and return the new state. Pure; never writes."""
    if event not in EVENTS:
        raise StateError(f"unknown event {event!r}")

    current = state["state"]
    if current not in STATES:
        raise StateError(f"unknown state {current!r}")
    if current in TERMINAL:
        raise StateError(f"{current} is terminal; {event} rejected")

    control = state.get("control", "RUN")
    if control == "CANCEL" and event != "CANCEL":
        raise StateError("task is cancelled; only CANCEL is accepted")
    if control == "PAUSE" and event not in ("CANCEL", "ESCALATE"):
        raise Paused(f"task {state['task_id']} is paused in {current}")

    out = dict(state)
    out["history"] = list(state.get("history", []))
    out["sessions"] = dict(state.get("sessions", {}))

    nxt, note = _transition(out, current, event, ctx)

    if nxt not in STATES:  # pragma: no cover - guards against a typo in the table
        raise StateError(f"transition produced unknown state {nxt!r}")

    if event not in ("AGENT_FAILED", "INFRA_FAILED"):
        out["consecutive_failures"] = 0

    if nxt in _CLEARS_ESCALATION:
        # `escalation_reason` is the headline `agentctl status` shows for a
        # task. Once the task is making progress again it is stale, and a
        # completed task still advertising why it once stalled is misleading.
        out["escalation_reason"] = None

    out["state"] = nxt
    out["updated_at"] = _now()
    out["history"].append(
        {"at": out["updated_at"], "from": current, "to": nxt, "event": event, "note": note}
    )
    if event in DISPATCHES and nxt != "ESCALATED":
        workflow, role = DISPATCHES[event]
        out["last_dispatch"] = {
            "event": event,
            "workflow": workflow,
            "role": role,
            "at": out["updated_at"],
            "run_id": None,
        }
    return out


def _transition(out: dict, current: str, event: str, ctx: dict) -> tuple[str, str]:
    # --- human / failure events, legal from any live state -------------------
    if event == "CANCEL":
        return "CANCELLED", ctx.get("reason", "cancelled by human")
    if event == "ESCALATE":
        out["escalation_reason"] = ctx.get("reason", "escalated")
        return "ESCALATED", out["escalation_reason"]
    if event == "GUARD_VIOLATION":
        # A worker wrote outside its permitted paths. That is a boundary
        # failure, not a test failure: it never retries automatically.
        out["escalation_reason"] = f"guard violation: {ctx.get('reason', 'unknown')}"
        return "ESCALATED", out["escalation_reason"]
    if event == "INFRA_FAILED":
        out["escalation_reason"] = ctx.get("reason", "infrastructure failure")
        return "FAILED", out["escalation_reason"]
    if event == "AGENT_FAILED":
        reason = ctx.get("reason", "agent invocation failed")
        if current == "ESCALATED":
            # A worker landing after the task was escalated (handoff.md §10,
            # D3, S9). Recorded, but the task stays with the human: routing it
            # to MANAGER_REVIEW would let a late run take it back.
            return "ESCALATED", f"late agent failure while escalated: {reason}"
        out["consecutive_failures"] = int(out.get("consecutive_failures") or 0) + 1

        if current == "MANAGER_REVIEW":
            # The one state where routing to the manager is meaningless: the
            # manager is what just failed. Sending it back here is what made
            # the workflow ping-pong forever instead of stopping.
            out["escalation_reason"] = f"manager could not be invoked: {reason}"
            return "ESCALATED", out["escalation_reason"]

        if out["consecutive_failures"] >= MAX_CONSECUTIVE_FAILURES:
            out["escalation_reason"] = (
                f"{out['consecutive_failures']} consecutive invocation failures: {reason}"
            )
            return "ESCALATED", out["escalation_reason"]

        out["escalation_reason"] = reason
        return "MANAGER_REVIEW", reason

    # --- ordinary workflow ----------------------------------------------------
    if event == "VALIDATED" and current in ("DRAFT", "MANAGER_REVIEW"):
        return "READY", "spec validated"

    if event == "DISPATCH_TEST_AGENT" and current == "READY":
        return "TEST_AGENT_RUNNING", "test agent dispatched"

    if event == "DISPATCH_CODE_AGENT" and current in ("READY_FOR_IMPLEMENTATION", "RETRY_READY"):
        if out["attempt"] >= out["max_attempts"]:
            raise StateError("attempt budget exhausted; MANAGER_REVIEW required")
        out["attempt"] += 1
        return "CODE_AGENT_RUNNING", f"code agent dispatched (attempt {out['attempt']})"

    if event == "DISPATCH_MAINTAINER" and current == "CONTEXT_MAINTENANCE":
        return "CONTEXT_MAINTENANCE", "context maintainer dispatched"

    if event == "DISPATCH_MANAGER" and current == "MANAGER_REVIEW":
        invoked = int(out.get("manager_invocations") or 0)
        if invoked >= MAX_MANAGER_INVOCATIONS:
            out["escalation_reason"] = (
                f"manager invoked {invoked} times (limit {MAX_MANAGER_INVOCATIONS}) "
                "without resolving the task"
            )
            return "ESCALATED", out["escalation_reason"]
        out["manager_invocations"] = invoked + 1
        return "MANAGER_REVIEW", f"manager dispatched (invocation {invoked + 1})"

    if event == "AGENT_COMMITTED":
        if current == "TEST_AGENT_RUNNING":
            return "TESTS_COMMITTED", ctx.get("commit_sha", "tests committed")
        if current == "CODE_AGENT_RUNNING":
            return "IMPL_COMMITTED", ctx.get("commit_sha", "implementation committed")

    if event == "MAINTAINER_DONE" and current == "CONTEXT_MAINTENANCE":
        return "COMPLETE", ctx.get("note", "context updated")

    if event == "CI_STARTED":
        if current == "TESTS_COMMITTED":
            return "BASELINE_CI", "baseline CI started (expected RED)"
        if current == "IMPL_COMMITTED":
            return "IMPL_CI", "implementation CI started"

    if event == "CI_FAILED_WRONG_REASON" and current == "BASELINE_CI":
        # Red, but not because of the new tests (handoff.md §10, D4): a
        # non-test job failed, failures lie outside the test commit's files,
        # or the log could not be read. The code agent cannot edit tests, so
        # it would only spend its attempts; the manager decides, as for a
        # green baseline. Not ESCALATED: re-scoping is often the answer.
        out["last_ci"] = ctx.get("ci") or out.get("last_ci")
        detail = ctx.get("reason") or "no reason recorded"
        out["escalation_reason"] = f"red_baseline_wrong_reason: {detail}"
        return "MANAGER_REVIEW", "baseline CI red, but not for the right reason"

    if event in ("CI_PASSED", "CI_FAILED"):
        out["last_ci"] = ctx.get("ci") or out.get("last_ci")

        if current == "BASELINE_CI":
            # Inverted on purpose. A green baseline means the committed tests do
            # not actually pin the behaviour the task is about, so there is
            # nothing for the code agent to make pass. This is what makes
            # "test-first" an enforced property rather than an instruction.
            # CI_FAILED here means red for the right reason: agentctl applies
            # CI_FAILED_WRONG_REASON instead when it is not (D4).
            if event == "CI_FAILED":
                return "READY_FOR_IMPLEMENTATION", "baseline is red, as required"
            if out.get("require_red_baseline", True):
                out["escalation_reason"] = "red_baseline_not_red"
                return "MANAGER_REVIEW", "baseline CI passed; the new tests prove nothing"
            return "READY_FOR_IMPLEMENTATION", "baseline green, red-baseline check waived"

        if current == "IMPL_CI":
            if event == "CI_PASSED":
                spec = ctx.get("spec") or {}
                policy = spec.get("workflow_policy", {})
                if policy.get("run_context_maintainer", True):
                    return "CONTEXT_MAINTENANCE", "CI green"
                return "COMPLETE", "CI green, context maintenance not required"
            return "DISTILLING", "CI red; distilling the failure"

    if event == "DISTILLED" and current == "DISTILLING":
        out["distilled"] = ctx.get("distilled")
        if out["attempt"] < out["max_attempts"]:
            return "RETRY_READY", f"attempt {out['attempt']} of {out['max_attempts']}"
        out["escalation_reason"] = "max_attempts_exhausted"
        return "MANAGER_REVIEW", "attempt budget exhausted"

    # MANAGER_RETRY and MANAGER_RESCOPE are also a human's way out of
    # ESCALATED (handoff.md §10.3 item 3, D3 S9). Only a dispatch of the
    # orchestrator supplies an event there: a manager worker applies its
    # decision with `--from-state MANAGER_REVIEW`, so it cannot.
    if event in ("MANAGER_RETRY", "MANAGER_RESCOPE") and current == "ESCALATED":
        out["manager_invocations"] = 0

    if event == "MANAGER_RETRY" and current in ("MANAGER_REVIEW", "ESCALATED"):
        extra = int(ctx.get("extra_attempts", 1))
        new_max = out["max_attempts"] + extra
        if new_max > HARD_MAX_ATTEMPTS:
            raise StateError(
                f"manager cannot raise the budget past the hard cap of {HARD_MAX_ATTEMPTS}"
            )
        out["max_attempts"] = new_max
        out["escalation_reason"] = None
        return "RETRY_READY", f"manager granted {extra} more attempt(s)"

    if event == "MANAGER_RESCOPE" and current in ("MANAGER_REVIEW", "ESCALATED"):
        out["escalation_reason"] = None
        return "READY", "manager re-scoped the task; tests to be rewritten"

    raise StateError(f"illegal transition: {event} from {current}")


def load_state(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("state") not in STATES:
        raise StateError(f"state file has unknown state {data.get('state')!r}")
    if data.get("control", "RUN") not in CONTROLS:
        raise StateError(f"state file has unknown control {data.get('control')!r}")
    return data


def save_state(path: str | Path, state: dict) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return p


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
