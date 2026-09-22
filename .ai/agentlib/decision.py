"""The contract for a *typed decision*, as distinct from an agent invocation.

`agentresult.py` normalises "an agent ran and produced prose". This module
normalises "a question was asked and a typed answer came back with calibrated
confidence". They are different verbs and deliberately different contracts:

    agent invocation   prompt  -> prose + a fenced trailer we have to trust
    typed decision     state   -> {"choice": "...", "confidence": 0.0-1.0}

A System One model (`.ai/bin/ask_jev.py`) cannot emit a value outside the
declared option set, which removes a whole class of problem that
`agentresult.manager_decision` has to defend against by hand. We still
re-check the answer against the caller's allowlist here anyway. The wire is
not the boundary; this module is. A guarantee made by a remote service is a
guarantee that stops being true the day the endpoint is wrong, mocked, or
replayed.

## Confidence gates

Every gate falls back in the *conservative* direction, never the convenient
one. A low-confidence manager escalates to a human; a low-confidence flake
verdict is treated as a real failure; a low-confidence spec is treated as
underspecified. Uncertainty must cost a human a minute, not cost the retry
budget three attempts.

Everything here degrades rather than raises, matching `agentresult`: a
provider that returns nothing useful must still leave a decidable workflow.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

# Jev's three primitive question types. Anything else in a questions file is a
# typo or a newer API than this checkout knows about, and selfcheck says so
# rather than letting it reach the wire and fail in a workflow step.
QUESTION_TYPES = frozenset({"noul", "choice", "score"})

# A gate with no explicit threshold. Chosen to be demanding: these decisions
# steer a retry budget and a human's attention, and the cost of an unnecessary
# escalation is far below the cost of three confident wrong attempts.
DEFAULT_MIN_CONFIDENCE = 0.70


class QuestionError(Exception):
    """A questions file is malformed. Raised only by `load_questions`."""


# --------------------------------------------------------------------------- reading


def parse(path: str | Path) -> dict[str, Any]:
    """Read a Jev response file. Never raises.

    Returns the `answers` mapping, or `{}` for anything unreadable. An empty
    mapping is a valid outcome, not an error: every accessor below has a
    fallback, so a missing file degrades to conservative defaults instead of
    taking the workflow step down with it.
    """
    try:
        loaded = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(loaded, dict):
        return {}
    answers = loaded.get("answers", loaded)
    return answers if isinstance(answers, dict) else {}


def choice(
    answers: dict[str, Any],
    key: str,
    allowed: frozenset[str] | set[str],
    *,
    fallback: str,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> tuple[str, float]:
    """Read one `choice` answer, gated on confidence and on an allowlist.

    `allowed` is supplied by the caller and re-checked here even though the
    model is schema-constrained: this function is what the workflow trusts, so
    it is where the option set has to be enforced.

    Returns `(value, confidence)`. `value` is `fallback` whenever the answer is
    absent, malformed, outside `allowed`, or below `min_confidence`.
    """
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return fallback, 0.0

    confidence = _confidence(answer)
    value = answer.get("choice")
    if not isinstance(value, str) or value not in allowed:
        return fallback, confidence
    if confidence < min_confidence:
        return fallback, confidence
    return value, confidence


def score(
    answers: dict[str, Any],
    key: str,
    scale: tuple[str, ...] | list[str],
    *,
    fallback: str,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> tuple[str, float]:
    """Read one `score` answer. Same gating as `choice`, different wire field."""
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return fallback, 0.0

    confidence = _confidence(answer)
    value = answer.get("score")
    if not isinstance(value, str) or value not in tuple(scale):
        return fallback, confidence
    if confidence < min_confidence:
        return fallback, confidence
    return value, confidence


def noul(
    answers: dict[str, Any],
    key: str,
    *,
    fallback: bool,
    threshold: float = 0.5,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> tuple[bool, float]:
    """Read one boolean-probability answer.

    Two separate numbers arrive and they are not interchangeable: `noul` is how
    likely the statement is true, `confidence` is how sure the model is of that
    estimate. A well-calibrated 0.5 with high confidence means "genuinely a
    coin flip", which is a different thing from "no idea" — so the probability
    is compared against `threshold` and the confidence against
    `min_confidence`, and both must clear for the answer to be used.
    """
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return fallback, 0.0

    confidence = _confidence(answer)
    probability = answer.get("noul")
    if not isinstance(probability, int | float) or isinstance(probability, bool):
        return fallback, confidence
    if confidence < min_confidence:
        return fallback, confidence
    return bool(probability >= threshold), confidence


def _confidence(answer: dict[str, Any]) -> float:
    """Confidence as a float in [0, 1]. Anything unparseable is zero.

    Zero rather than a default: an answer that cannot say how sure it is has
    not cleared any gate, and treating silence as confidence is how a broken
    endpoint quietly starts making decisions.
    """
    raw = answer.get("confidence")
    if not isinstance(raw, int | float) or isinstance(raw, bool):
        return 0.0
    return max(0.0, min(1.0, float(raw)))


# --------------------------------------------------------------------------- questions


def load_questions(path: str | Path) -> dict[str, Any]:
    """Load and validate one questions file.

    Raises `QuestionError` rather than degrading: a malformed questions file is
    a repository bug caught by `agentctl selfcheck` before anything is
    dispatched, not a runtime condition to absorb. This is the half of the
    contract that must fail loudly — the response half is the half that must
    not.
    """
    p = Path(path)
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise QuestionError(f"{p.name}: cannot read: {exc}") from exc
    if not isinstance(doc, dict):
        raise QuestionError(f"{p.name}: top level must be an object")

    problems = validate_questions(doc, p.name)
    if problems:
        raise QuestionError("; ".join(problems))
    return doc


def validate_questions(doc: dict[str, Any], name: str = "questions") -> list[str]:
    """Every structural problem in a questions document, as a list of strings.

    Returns rather than raises so `selfcheck` can report all of them in one
    pass instead of making a human fix them one run at a time.
    """
    problems: list[str] = []
    questions = doc.get("questions")
    if not isinstance(questions, dict) or not questions:
        return [f"{name}: 'questions' must be a non-empty object"]

    for key, q in questions.items():
        where = f"{name}.questions.{key}"
        if not isinstance(q, dict):
            problems.append(f"{where}: must be an object")
            continue

        qtype = q.get("type")
        if qtype not in QUESTION_TYPES:
            problems.append(f"{where}: type {qtype!r} is not one of {sorted(QUESTION_TYPES)}")
            continue
        if not isinstance(q.get("instructions"), str) or not q["instructions"].strip():
            problems.append(f"{where}: 'instructions' must be a non-empty string")

        if qtype == "choice":
            criteria = q.get("criteria")
            if not isinstance(criteria, dict) or len(criteria) < 2:
                problems.append(f"{where}: 'criteria' must be an object of at least 2 options")
        elif qtype == "score":
            scale = q.get("scale")
            if not isinstance(scale, list) or len(scale) < 2:
                problems.append(f"{where}: 'scale' must be a list of at least 2 levels")

    problems += _validate_gates(doc, questions, name)
    return problems


def _validate_gates(doc: dict[str, Any], questions: dict[str, Any], name: str) -> list[str]:
    """Check that every gate names a real question and a reachable fallback.

    A gate whose `fallback` is not one of the question's own options is the
    dangerous kind of typo: it only shows up on the low-confidence path, which
    is exactly the path that is rarely exercised and always matters.
    """
    problems: list[str] = []
    gates = doc.get("gates", {})
    if not isinstance(gates, dict):
        return [f"{name}: 'gates' must be an object"]

    for key, gate in gates.items():
        where = f"{name}.gates.{key}"
        if key not in questions:
            problems.append(f"{where}: no question named {key!r}")
            continue
        if not isinstance(gate, dict):
            problems.append(f"{where}: must be an object")
            continue

        threshold = gate.get("min_confidence", DEFAULT_MIN_CONFIDENCE)
        if not isinstance(threshold, int | float) or not 0.0 <= float(threshold) <= 1.0:
            problems.append(f"{where}: 'min_confidence' must be a number in [0, 1]")

        q = questions[key]
        fallback = gate.get("fallback")
        options = _options(q)
        if options is None:
            continue  # a `noul` gate's fallback is a boolean, checked below
        if not isinstance(fallback, str) or fallback not in options:
            problems.append(f"{where}: fallback {fallback!r} is not one of {sorted(options)}")

    for key, q in questions.items():
        if q.get("type") == "noul" and key in gates:
            fallback = gates[key].get("fallback")
            if not isinstance(fallback, bool):
                problems.append(f"{name}.gates.{key}: fallback for a 'noul' must be true or false")
    return problems


def _options(question: dict[str, Any]) -> set[str] | None:
    """The declared option set for a question, or None for a `noul`."""
    if question.get("type") == "choice":
        criteria = question.get("criteria")
        return set(criteria) if isinstance(criteria, dict) else set()
    if question.get("type") == "score":
        scale = question.get("scale")
        return set(scale) if isinstance(scale, list) else set()
    return None


def gate_for(doc: dict[str, Any], key: str) -> dict[str, Any]:
    """The gate configured for one question, with defaults filled in."""
    gates = doc.get("gates", {})
    gate = gates.get(key) if isinstance(gates, dict) else None
    gate = gate if isinstance(gate, dict) else {}
    return {
        "min_confidence": float(gate.get("min_confidence", DEFAULT_MIN_CONFIDENCE)),
        "fallback": gate.get("fallback"),
    }


# --------------------------------------------------------------------------- outcomes
#
# One function per decision point, turning typed answers into the thing the
# workflow actually needs. These live here, next to the contract, for the same
# reason `agentresult.manager_decision` lives next to its own: the mapping from
# a model's answer to a workflow event is exactly the step worth having in one
# tested place rather than spread across workflow YAML.


def manager_outcome(doc: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """The Manager's decision, its confidence, and whether prose is needed.

    Two gates compose here. The choice gate turns a low-confidence answer into
    ESCALATE, and then the `retry_would_differ` check turns a *confident but
    unsupported* MANAGER_RETRY into ESCALATE as well. The second is the one
    that matters: a model can be quite sure retrying is right and still not
    point at anything that would change, which is how a retry loop spends three
    attempts re-running the same failure. `.ai/prompts/manager.md` states the
    rule in prose for the language-model path; this enforces it.
    """
    from agentlib.agentresult import MANAGER_DECISIONS

    gate = gate_for(doc, "decision")
    verdict, confidence = choice(
        answers,
        "decision",
        MANAGER_DECISIONS,
        fallback=str(gate["fallback"] or "ESCALATE"),
        min_confidence=gate["min_confidence"],
    )

    differ_gate = gate_for(doc, "retry_would_differ")
    would_differ, differ_confidence = noul(
        answers,
        "retry_would_differ",
        fallback=bool(differ_gate["fallback"]),
        min_confidence=differ_gate["min_confidence"],
    )

    downgraded = False
    if verdict == "MANAGER_RETRY" and not would_differ:
        verdict, downgraded = "ESCALATE", True

    return {
        "decision": verdict,
        "confidence": round(confidence, 3),
        "retry_would_differ": would_differ,
        "retry_would_differ_confidence": round(differ_confidence, 3),
        "downgraded_to_escalate": downgraded,
        # ESCALATE is the only outcome a human reads before acting, so it is
        # the only one worth spending a language-model call to explain.
        "needs_prose": verdict == "ESCALATE",
        "reason": _manager_reason(verdict, confidence, downgraded),
    }


def _manager_reason(verdict: str, confidence: float, downgraded: bool) -> str:
    """A templated reason for the paths that do not get a prose call.

    Deliberately dull and deliberately honest. It records what was decided and
    how sure the model was, and nothing it cannot support. The ESCALATE text is
    a placeholder that the caller replaces with a real explanation when the
    prose call succeeds — and that survives unchanged when it does not, which
    is the case that has to stay readable.
    """
    if downgraded:
        return (
            f"escalated: a retry was selected (confidence {confidence:.2f}) but the state "
            "showed nothing that would make the next attempt differ from the last."
        )
    if verdict == "MANAGER_RETRY":
        return f"retrying: the approach holds and the state supports a different attempt (confidence {confidence:.2f})."
    if verdict == "MANAGER_RESCOPE":
        return (
            f"rescoping: the committed tests pin the wrong contract (confidence {confidence:.2f})."
        )
    if confidence == 0.0:
        return "escalated: no usable decision was returned, so the task is left for a human."
    return f"escalated for a human decision (confidence {confidence:.2f})."


def origin_outcome(doc: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """Where a CI failure most likely came from."""
    gate = gate_for(doc, "origin")
    verdict, confidence = choice(
        answers,
        "origin",
        {"implementation", "test", "infrastructure", "ambiguous"},
        fallback=str(gate["fallback"] or "ambiguous"),
        min_confidence=gate["min_confidence"],
    )
    return {"origin": verdict, "confidence": round(confidence, 3)}


def flake_outcome(doc: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """Whether a red run earns a free re-run.

    `free_rerun` is true only for a high-confidence `flake` that does *not*
    repeat the previous attempt's failure. Both conditions are required: a
    failure that reproduced last time is not a flake however it looks, and
    letting one signal alone unlock a re-run is how a genuinely broken commit
    loops forever without ever spending its budget.
    """
    gate = gate_for(doc, "reproducibility")
    verdict, confidence = choice(
        answers,
        "reproducibility",
        {"deterministic", "flake", "infrastructure"},
        fallback=str(gate["fallback"] or "deterministic"),
        min_confidence=gate["min_confidence"],
    )

    same_gate = gate_for(doc, "same_failure_as_last_attempt")
    repeated, _ = noul(
        answers,
        "same_failure_as_last_attempt",
        fallback=bool(same_gate["fallback"]),
        min_confidence=same_gate["min_confidence"],
    )

    return {
        "reproducibility": verdict,
        "confidence": round(confidence, 3),
        "repeated_previous_failure": repeated,
        "free_rerun": verdict in {"flake", "infrastructure"} and not repeated,
    }


def spec_outcome(doc: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """Whether a task spec is ready to be dispatched against.

    Only `untestable` blocks. `underspecified` warns and lets the task run:
    this gate is new, it has no track record in this repository yet, and a
    brand-new model gate that can silently stop every task is a worse failure
    than the one it prevents. Tighten it once the telemetry says it is right.
    """
    gate = gate_for(doc, "testability")
    grade, confidence = score(
        answers,
        "testability",
        ("testable", "underspecified", "untestable"),
        fallback=str(gate["fallback"] or "underspecified"),
        min_confidence=gate["min_confidence"],
    )

    paths_gate = gate_for(doc, "paths_sufficient")
    paths_ok, _ = noul(
        answers,
        "paths_sufficient",
        fallback=bool(paths_gate["fallback"]),
        min_confidence=paths_gate["min_confidence"],
    )

    return {
        "testability": grade,
        "confidence": round(confidence, 3),
        "paths_sufficient": paths_ok,
        "blocks_dispatch": grade == "untestable",
        "warns": grade == "underspecified" or not paths_ok,
    }
