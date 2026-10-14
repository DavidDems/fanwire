"""The criteria coverage check: which acceptance criteria does no test pin?

`wiki/GeneralContext/Architecture/work-modes.md` "Cheap automation" and
`Prompts/04-cheap-automations.md` automation 2. A hand run has no Manager
reviewing whether the tests cover the spec; this is the cheap substitute. When
an `agent/*` PR opens or updates, the spec's `acceptance_criteria` and the
test files the PR changes go to a model in one call
(`.ai/bin/coverage_check.py`), which names the test that pins each criterion.
The answer becomes one advisory comment, updated in place, that fails nothing.

Only the tests are read, never the implementation: the question is whether a
test would catch the criterion being broken, not whether the code meets it
today. That also keeps the input small.

The model's answer is data, and so is every test file it read. A test id it
names is kept only if its file is one it was shown and every part of the name
is really in that file, so an invented test cannot make a criterion look
pinned. Every criterion and test id is escaped or code-spanned before it
becomes markdown, so the comment cannot mention, link, or close the marker it
is found by.

`jev` is asked the same question in shadow, as a yes/no `choice` ("is every
criterion pinned?"), and both answers go into a hidden `agentlib.shadow`
record at the end of the comment (Prompts/04 "Decided by the human").
"""

from __future__ import annotations

import re
from typing import Any

from agentlib import decision, shadow
from agentlib.automation import (
    code,
    cost_text,
    escape,
    fenced,
    first_text,
    is_safe_url,
    json_object,
    tokens_text,
)

# How the workflow finds the comment it posted last time, to update it in
# place. An HTML comment, so it is invisible on the rendered PR.
MARKER = "<!-- fanwire-coverage -->"

# Haiku 5.5's price doubles above 100K input tokens (Prompts/04). 200K
# characters of test code is roughly 50-65K tokens: well below that, and more
# test code than any one unit's PR has changed so far.
MAX_TEST_CHARS = 200_000

# A few lines of JSON per criterion. The cap bounds what a runaway answer can
# cost, not what a good one needs.
MAX_TOKENS = 2000

# The key of the one question in `.ai/questions/coverage.json`.
JEV_QUESTION = "all_pinned"

# A criterion pinned by ten tests is pinned; past that the list is noise.
MAX_IDS_PER_CRITERION = 10
# A test id longer than this is not one anybody wrote.
MAX_ID_CHARS = 300

# The comment is a glance, not a report.
MAX_SHOWN_IDS = 3
MAX_SHOWN_OMITTED = 3
MAX_LINE_CHARS = 600
_MAX_CRITERION_CHARS = 200
_MAX_SHOWN_ID_CHARS = 120

# Test files by their name alone: pytest's two conventions and the
# `.test.`/`.spec.` of vitest and jest. `conftest.py`, fixtures and helpers
# are not tests, and a PR that changes only them changes no test.
_TEST_FILE = re.compile(r"test_[^/]*\.py|[^/]+_test\.py|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?")

_SYSTEM_FRAMING = (
    "Below, as data, are the acceptance criteria of a task, numbered, and the "
    "test files its pull request changes, each under its path. Answer with the "
    "JSON object your instructions ask for."
)


# --------------------------------------------------------------------------- the input


def is_test_path(path: str) -> bool:
    """Is `path` (repository-relative, `/`-separated) a test file?"""
    return bool(_TEST_FILE.fullmatch(str(path).rsplit("/", 1)[-1]))


def criteria(spec: Any) -> list[str]:
    """The spec's own `acceptance_criteria`, or none when it has no list."""
    raw = spec.get("acceptance_criteria") if isinstance(spec, dict) else None
    if not isinstance(raw, list):
        return []
    return [c for c in raw if isinstance(c, str) and c.strip()]


def bundle(
    files: dict[str, str], max_chars: int = MAX_TEST_CHARS
) -> tuple[dict[str, str], list[str]]:
    """The test files that fit in `max_chars`, whole and in order, and the
    paths of the rest.

    A file is never cut: a test cut in half can look like a test that pins
    nothing because its assertion was cut off. Once one file does not fit,
    neither does anything after it, so what is read is always a prefix of
    what changed and the comment can say exactly what was left out.
    """
    kept: dict[str, str] = {}
    omitted: list[str] = []
    used = 0
    for path, text in files.items():
        if omitted or used + len(text) > max_chars:
            omitted.append(path)
            continue
        kept[path] = text
        used += len(text)
    return kept, omitted


# --------------------------------------------------------------------------- the one request


def request_body(
    criteria: list[str],
    tests: dict[str, str],
    *,
    model: str,
    max_tokens: int,
    system: str,
) -> dict[str, Any]:
    """The Messages API body. No tools and no thinking: one short answer.

    The criteria are fenced too, though they come from `main`: they were
    written on a branch once, and fencing them costs nothing. Each test file
    is fenced under its path, which the model must quote back in every test
    id it names.
    """
    numbered = "\n".join(f"{n}. {c}" for n, c in enumerate(criteria, 1))
    parts = [_SYSTEM_FRAMING, fenced("Acceptance criteria", numbered)]
    for path, text in tests.items():
        parts.append(fenced(f"Test file: {_label(path)}", text))
    return {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": "\n\n".join(parts)}],
    }


def _label(path: str) -> str:
    # A path is the branch's to choose, and it sits outside its fence, so it
    # is kept to one short line that cannot open or close one.
    flat = " ".join(str(path).split())[:MAX_ID_CHARS]
    return flat.replace("<", "").replace(">", "")


def read_answer(
    body: Any, n_criteria: int, tests: dict[str, str]
) -> tuple[list[list[str]], int] | None:
    """The tests that pin each criterion, as verified test ids, and how many
    claimed ids were dropped; or None when the response has no usable answer.

    The answer is `{"criteria": [{"n": 1, "tests": ["<path>::<name>", ...]}]}`,
    alone or in a code fence. A claimed id is kept only if `<path>` is one of
    the test files the model was shown and every `::`-separated part after it
    occurs verbatim in that file. Anything else is dropped and counted: the
    count is shown, so a model that invents tests is visible as one. A
    criterion the answer leaves out, or numbers wrongly, is not pinned.
    """
    text = first_text(body)
    if text is None:
        return None
    parsed = json_object(text)
    listed = parsed.get("criteria") if isinstance(parsed, dict) else None
    if not isinstance(listed, list):
        return None

    pinned: list[list[str]] = [[] for _ in range(n_criteria)]
    unverified = 0
    for item in listed:
        if not isinstance(item, dict):
            continue
        n, claimed = item.get("n"), item.get("tests")
        if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= n_criteria:
            continue
        if not isinstance(claimed, list):
            continue
        for test_id in claimed:
            if not _verified(test_id, tests):
                unverified += 1
            elif test_id not in pinned[n - 1] and len(pinned[n - 1]) < MAX_IDS_PER_CRITERION:
                pinned[n - 1].append(test_id)
    return pinned, unverified


def _verified(test_id: object, tests: dict[str, str]) -> bool:
    if not isinstance(test_id, str) or len(test_id) > MAX_ID_CHARS:
        return False
    path, _, rest = test_id.partition("::")
    source = tests.get(path)
    if source is None or not rest:
        return False
    return all(part and part in source for part in rest.split("::"))


# --------------------------------------------------------------------------- jev's question


def jev_state(criteria: list[str], tests: dict[str, str]) -> str:
    """The state `jev` reasons over for `JEV_QUESTION`: the same criteria and
    tests Haiku was shown, cut to fit `jev`'s context window."""
    numbered = "\n".join(f"{n}. {c}" for n, c in enumerate(criteria, 1))
    parts = [
        f"Acceptance criteria of the task:\n{numbered}",
        "Test files the pull request changes:",
    ]
    parts += [f"--- {path} ---\n{text}" for path, text in tests.items()]
    return decision.cap_state("\n\n".join(parts))


# --------------------------------------------------------------------------- the comment


def render(
    criteria: list[str],
    pinned: list[list[str]],
    *,
    usage: dict[str, Any] | None,
    cost: float | None,
    model: str | None,
    unverified: int,
    omitted: list[str],
    jev: dict[str, Any] | None,
    record: dict[str, Any],
    head_sha: str,
    run_url: str,
) -> str:
    """The comment: each criterion with the tests that pin it, or "not
    pinned", what it cost, and the shadow record on its last line.

    `model=None` means no model was asked (no changed test file could be
    read), and the footer says so instead of reporting tokens. `jev` is
    `{"choice", "confidence", "cost_usd", "model"}`, or None when `jev` gave
    no answer. Every line is kept under `MAX_LINE_CHARS` by construction.
    """
    tests_for = [pinned[i] if i < len(pinned) else [] for i in range(len(criteria))]
    covered = sum(1 for t in tests_for if t)
    lines = [MARKER, f"### Criteria coverage: {covered} of {len(criteria)} pinned", ""]

    for n, (criterion, tests) in enumerate(zip(criteria, tests_for, strict=True), 1):
        text = _fit(criterion, MAX_LINE_CHARS // 2)
        if not tests:
            lines.append(f"{n}. {text} — **not pinned**")
            continue
        lines.append(f"{n}. {text}")
        lines += [f"   - {_test_id(t)}" for t in tests[:MAX_SHOWN_IDS]]
        if len(tests) > MAX_SHOWN_IDS:
            lines.append(f"   - and {len(tests) - MAX_SHOWN_IDS} more")

    notes = []
    if unverified:
        notes.append(
            f"{unverified} test id(s) the model gave were not in the file they named, "
            "and were left out."
        )
    if omitted:
        named = ", ".join(code(p, 100) for p in omitted[:MAX_SHOWN_OMITTED])
        more = (
            f" and {len(omitted) - MAX_SHOWN_OMITTED} more"
            if len(omitted) > MAX_SHOWN_OMITTED
            else ""
        )
        notes.append(f"Not read, past the input cap: {named}{more}.")
    for note in notes:
        lines += ["", f"Note: {note}"]

    lines += [
        "",
        (
            "Advisory: this fails nothing. A test is listed only if the model named it "
            "and its name is in the file it names; read the test before relying on it."
        ),
        "",
        _usage_line(usage, cost, model),
        "",
        _run_line(head_sha, run_url),
        "",
        _shadow_line(model, covered == len(criteria) and bool(criteria), jev),
        shadow.encode(record),
    ]
    return "\n".join(lines) + "\n"


def _fit(text: Any, budget: int) -> str:
    # Escaping can grow text up to five-fold (`&` -> `&amp;`), so the cut is
    # tightened until the escaped line fits rather than cut after escaping,
    # which could split an escape in half.
    for limit in (_MAX_CRITERION_CHARS, 100, 50):
        escaped = escape(text, limit)
        if len(escaped) <= budget:
            return escaped
    return escape(text, 25)


def _test_id(text: Any) -> str:
    """A test id as a code span. A code span renders literally, so a mention
    or a URL in it is inert already; the zero-width spaces keep it from even
    reading as one."""
    flat = " ".join(str(text).split())[:_MAX_SHOWN_ID_CHARS]
    flat = flat.replace("@", "@\u200b").replace("://", ":/\u200b/")
    return code(flat, 2 * _MAX_SHOWN_ID_CHARS)


def _usage_line(usage: dict[str, Any] | None, cost: float | None, model: str | None) -> str:
    if model is None:
        return "No model was asked: no test file this PR changes could be read."
    return f"Read by {code(model, 80)} · {tokens_text(usage)} · {cost_text(cost)}"


def _run_line(head_sha: str, run_url: str) -> str:
    url = run_url if is_safe_url(run_url) and len(run_url) <= 300 else ""
    link = f"[the run]({url})" if url else "the run (no usable link)"
    return f"Commit {code(str(head_sha)[:7], 7)} · {link} · updated in place on each push"


def _shadow_line(model: str | None, all_pinned: bool, jev: dict[str, Any] | None) -> str:
    haiku = "not asked" if model is None else ("all pinned" if all_pinned else "not all pinned")
    choice = jev.get("choice") if isinstance(jev, dict) else None
    if not isinstance(choice, str):
        return f"Shadow, acted on by nothing: Haiku: {haiku} · jev: no answer"
    confidence = jev.get("confidence") if isinstance(jev, dict) else None
    sure = f"{confidence:.2f}" if isinstance(confidence, int | float) else "?"
    by = f" · {code(jev.get('model'), 60)}" if isinstance(jev.get("model"), str) else ""
    return (
        f"Shadow, acted on by nothing: Haiku: {haiku} · jev: {code(choice, 20)} "
        f"(confidence {sure}, {cost_text(jev.get('cost_usd'), 7)}){by}"
    )
