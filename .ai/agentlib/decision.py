"""The contract for a *typed decision*, as distinct from an agent invocation.

`agentresult.py` normalises "an agent ran and produced prose". This module
normalises "a question was asked and a typed answer came back":

    agent invocation   prompt -> prose + a fenced trailer we have to trust
    typed decision     state  -> {"choice": "...", "confidence": 0.0-1.0}

The transport is `.ai/bin/ask_jev.py`; this is the half that reads what it
wrote. The answer shapes are the ones TypeSafe documents for its System One
endpoint (docs.typesafe.ai, checked 2026-10-13), not guesses:

    choice  {"type": "choice", "choice": "<option>", "confidence": c,
             "probabilities": {"<option>": p, ...}}
    score   {"type": "score", "score": 1.43, "confidence": c,
             "legend": {"0": "...", ...}, "probabilities": {"0": p, ...}}
    noul    {"type": "noul", "noul": 0.99}            <- no confidence

`jev` runs in shadow (`wiki/GeneralContext/Architecture/work-modes.md`
"Cheap automation"): nothing acts on an answer yet, so there are no
confidence gates here. An accessor returns what came back, or None, and the
caller records it. Gates belong to the day an answer is allowed to steer
something, and should be set from what the shadow record shows, not guessed
in advance.

The wire is still not the boundary. A choice is re-checked against the
caller's own option set, because a guarantee made by a remote service stops
being true the day the endpoint is wrong, mocked or replayed.

Everything that reads an answer degrades rather than raises: a provider that
returns nothing useful must still leave a decidable workflow. Only
`load_questions` raises, because a malformed questions file is a repository
bug, not a runtime condition.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

# The three documented question types. Anything else is a typo or a newer API
# than this checkout knows, and is reported before it reaches the wire.
QUESTION_TYPES = frozenset({"choice", "score", "noul"})

# A score's scale, as documented: 2 to 10 levels.
MIN_SCORE_LEVELS, MAX_SCORE_LEVELS = 2, 10

# jev's context window is 32K tokens, and it holds the questions as well as
# the state. Characters, not tokens: a stdlib script cannot tokenise, so this
# is a conservative bound. 80K characters is ~20K tokens of English at 4
# characters a token, and still under 27K for dense code at 3, which leaves
# the questions their room.
MAX_STATE_CHARS = 80_000
TRUNCATION_NOTE = "\n\n[state truncated to fit the model's context window]"


class QuestionError(Exception):
    """A questions file is malformed. Raised only by `load_questions`."""


# --------------------------------------------------------------------------- answers


def choice(answers: dict[str, Any], key: str, allowed: Iterable[str]) -> tuple[str | None, float]:
    """One `choice` answer as `(option, confidence)`.

    `option` is None when the answer is absent, malformed, or names an option
    outside `allowed`. The confidence is returned either way: an answer
    outside the option set that came back confident is worth recording.
    """
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return None, 0.0
    value = answer.get("choice")
    if not isinstance(value, str) or value not in set(allowed):
        return None, _confidence(answer)
    return value, _confidence(answer)


def score(answers: dict[str, Any], key: str, levels: Sequence[str]) -> tuple[str | None, float]:
    """One `score` answer as `(level name, confidence)`.

    The wire's `score` is a float, the probability-weighted mean of the level
    indices, not a level. A mean of 1.43 can sit beside a distribution whose
    heaviest level is 2, and "the level the model put most weight on" is the
    reading that answers the question, so the probabilities decide when they
    are readable. Without them the rounded mean is the best remaining reading.
    A tie goes to the lower level, so the reading is deterministic.
    """
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return None, 0.0
    confidence = _confidence(answer)

    index = _most_probable_index(answer.get("probabilities"))
    if index is None:
        mean = answer.get("score")
        if not _is_number(mean):
            return None, confidence
        index = round(float(mean))
    if not 0 <= index < len(levels):
        return None, confidence
    return levels[index], confidence


def noul(answers: dict[str, Any], key: str) -> float | None:
    """One `noul` answer: the probability that the statement is true.

    Documented without a confidence, so none is invented here. Anything that
    is not a number in [0, 1] is None rather than clamped: an out-of-range
    probability is a wrong answer, not an overconfident one.
    """
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return None
    value = answer.get("noul")
    if not _is_number(value) or not 0.0 <= float(value) <= 1.0:
        return None
    return float(value)


def missing_fields(doc: dict[str, Any], answers: dict[str, Any]) -> list[str]:
    """Every question, in file order, whose answer lacks what its type promises.

    The merge gate for the seam (Prompts/04-cheap-automations.md Deliverable 0,
    step 4) is one real 200 with a `confidence` field. A choice or a score
    must carry its value and a numeric confidence; a noul is documented
    without a confidence, so it is held to its probability instead.
    """
    missing = []
    for key, question in doc.get("questions", {}).items():
        answer = answers.get(key)
        if not isinstance(answer, dict):
            missing.append(key)
            continue
        qtype = question.get("type") if isinstance(question, dict) else None
        if qtype == "noul":
            complete = noul(answers, key) is not None
        elif qtype == "choice":
            complete = isinstance(answer.get("choice"), str) and _is_number(
                answer.get("confidence")
            )
        else:
            complete = _is_number(answer.get("score")) and _is_number(answer.get("confidence"))
        if not complete:
            missing.append(key)
    return missing


def cost_usd(usage: dict[str, Any], price: dict[str, Any] | None) -> float | None:
    """The call's cost from the provider's own token counts, or None.

    None, never a guess, when there is no price row or no usage to price: a
    cost that is visibly unknown is honest, and a zero that looks measured is
    not. A missing count beside a present one is priced as zero, since the
    provider reported the call.
    """
    if not isinstance(price, dict) or not isinstance(usage, dict):
        return None
    tokens_in, tokens_out = usage.get("input_tokens"), usage.get("output_tokens")
    if not _is_number(tokens_in) and not _is_number(tokens_out):
        return None
    rate_in, rate_out = price.get("input_per_mtok"), price.get("output_per_mtok")
    total = 0.0
    for tokens, rate in ((tokens_in, rate_in), (tokens_out, rate_out)):
        if _is_number(tokens) and _is_number(rate):
            total += float(tokens) * float(rate) / 1_000_000
    return total


# --------------------------------------------------------------------------- the request


def cap_state(state: str, limit: int = MAX_STATE_CHARS) -> str:
    """`state` cut to at most `limit` characters, ending in `TRUNCATION_NOTE`.

    The state is assembled from repository files, which can be large; cutting
    it here costs nothing, where an oversized request is refused at the far
    end after the step has already spent its call. The note tells the model
    that what it is reading is not the whole picture.
    """
    if len(state) <= limit:
        return state
    keep = max(0, limit - len(TRUNCATION_NOTE))
    return (state[:keep] + TRUNCATION_NOTE)[:limit]


def wire_questions(doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The questions as they go on the wire, without local annotations.

    `_why`, `_comment` and the like are this repository's notes to itself,
    not input to the decision.
    """
    return {
        key: {k: v for k, v in question.items() if not k.startswith("_")}
        for key, question in doc.get("questions", {}).items()
    }


# --------------------------------------------------------------------------- questions files


def load_questions(path: str | Path) -> dict[str, Any]:
    """Load and validate one questions file. Raises `QuestionError`.

    This is the half of the contract that must fail loudly: a questions file
    is committed, so a fault in it is caught by the tests before anything is
    asked, not absorbed at runtime.
    """
    p = Path(path)
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise QuestionError(f"{p.name}: cannot read: {exc}") from exc
    if not isinstance(doc, dict):
        raise QuestionError(f"{p.name}: top level must be an object")
    problems = validate_questions(doc, p.name)
    if problems:
        raise QuestionError("; ".join(problems))
    return doc


def validate_questions(doc: dict[str, Any], name: str = "questions") -> list[str]:
    """Every structural problem in a questions document, as a list.

    Returned rather than raised so one pass reports all of them. The rules
    are the documented request shape: a choice's `criteria` is an object of
    at least two options, a score's is a list of 2 to 10 levels, and a noul's
    is optional.
    """
    questions = doc.get("questions")
    if not isinstance(questions, dict) or not questions:
        return [f"{name}: 'questions' must be a non-empty object"]

    problems: list[str] = []
    for key, q in questions.items():
        where = f"{name}.questions.{key}"
        if not isinstance(q, dict):
            problems.append(f"{where}: must be an object")
            continue
        qtype = q.get("type")
        if qtype not in QUESTION_TYPES:
            problems.append(f"{where}: type {qtype!r} is not one of {sorted(QUESTION_TYPES)}")
            continue
        instructions = q.get("instructions")
        if not isinstance(instructions, str) or not instructions.strip():
            problems.append(f"{where}: 'instructions' must be a non-empty string")

        criteria = q.get("criteria")
        if qtype == "choice" and (not isinstance(criteria, dict) or len(criteria) < 2):
            problems.append(f"{where}: 'criteria' must be an object of at least 2 options")
        elif qtype == "score" and not (
            isinstance(criteria, list)
            and MIN_SCORE_LEVELS <= len(criteria) <= MAX_SCORE_LEVELS
            and all(isinstance(level, str) and level.strip() for level in criteria)
        ):
            problems.append(
                f"{where}: 'criteria' must be a list of {MIN_SCORE_LEVELS} to "
                f"{MAX_SCORE_LEVELS} non-empty level names"
            )
    return problems


# --------------------------------------------------------------------------- helpers


def _is_number(value: object) -> bool:
    """A JSON number. `bool` is excluded: `True` is an int to Python, not to JSON."""
    return isinstance(value, int | float) and not isinstance(value, bool)


def _confidence(answer: dict[str, Any]) -> float:
    """Confidence as a float in [0, 1]; anything unreadable is zero.

    Zero rather than a default: silence about how sure an answer is must
    never read as certainty.
    """
    raw = answer.get("confidence")
    if not _is_number(raw):
        return 0.0
    return max(0.0, min(1.0, float(raw)))


def _most_probable_index(probabilities: object) -> int | None:
    """The level index with the most probability, or None if none is readable."""
    if not isinstance(probabilities, dict):
        return None
    best: tuple[float, int] | None = None
    for raw_index, p in probabilities.items():
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if not _is_number(p):
            continue
        # Highest probability first; on a tie, the lower index.
        if best is None or (float(p), -index) > (best[0], -best[1]):
            best = (float(p), index)
    return None if best is None else best[1]
