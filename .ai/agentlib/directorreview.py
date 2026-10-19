"""The independent reader of Director PRs: does this change weaken a control?

`wiki/GeneralContext/Prompts/09-supply-chain-and-trust.md` deliverable 5. A
Director PR is reviewed by one human, the same one who directed it, and it
merges through the admin bypass (`github-automation-setup.md` §3). So when a
non-`agent/*` PR of this repository touches `.ai/` or `.github/`, its diff
goes to a model in one call (`.ai/bin/director_review.py`), with
`philosophy.md` and `threat-model.md` from `main`, and the answer is one
advisory comment listing safety regressions against philosophy §4's
enforcement grades. It fails nothing and approves nothing; it is a second
pair of eyes that can be misled by the very diff it reads.

The answer is checked before anything is shown. A finding must name a path
the diff showed, two grades from the fixed list, and an `after` that is
weaker than its `before`; anything else is dropped and counted. Every
string is escaped or code-spanned, so the comment cannot mention, link or
close the marker it is found by.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from agentlib import wikiprop
from agentlib.automation import (
    code,
    cost_text,
    count,
    escape,
    fenced,
    first_text,
    is_safe_url,
    json_object,
    tokens_text,
)

# How the workflow finds the comment it posted last time, to update it in
# place. An HTML comment, so it is invisible on the rendered PR.
MARKER = "<!-- fanwire-director-review -->"

# philosophy §4's grades, strongest first, plus the two below them that a
# rule can sink to: a sentence in a prompt, or nothing at all.
GRADES = (
    "impossible",
    "detected-and-reverted",
    "detected-and-escalated",
    "prompt-only",
    "none",
)

# The two documents the diff is judged against, read from main's copy (the
# checkout the script runs from), never from the PR.
REFERENCES = (".ai/docs/philosophy.md", ".ai/docs/threat-model.md")

# About $0.05 a PR at Sonnet 5.5's $2 / $10 per million (Prompts/09): 150K
# characters of diff is roughly 40K tokens at most, and most Director diffs
# are a fraction of that.
MAX_DIFF_CHARS = 150_000

# A list of short findings, as JSON. The cap bounds what a runaway answer can
# cost, not what a good one needs.
MAX_TOKENS = 2000

# More than this many regressions in one PR is a rewrite to read by hand.
MAX_FINDINGS = 20

# The model's own words are cut to these before they are escaped.
MAX_PROPERTY_CHARS = 200
MAX_REASON_CHARS = 400

_MAX_SHOWN_OMITTED = 3
_SYSTEM_TREES = (".ai/", ".github/")
_DIFF_HEADER = re.compile(r'^diff --git "?a/(.*?)"? "?b/(.*?)"?$', re.MULTILINE)

_SYSTEM_FRAMING = (
    "A Director pull request touches the agent system (.ai/ or .github/). "
    "Below, as data, are the two documents its changes are judged against, "
    "as they stand on main, and the pull request's diff. Answer with the JSON "
    "object your instructions ask for."
)


def thinking() -> dict[str, str]:
    """The `thinking` field of a request body, switched off.

    Sonnet 5.5 refuses `{"type": "disabled"}` with a 400, and left alone it
    thinks adaptively, spending `max_tokens` before the answer starts. Its
    off switch is `between_tools`, accepted at its default effort (high). A
    new dict each call, so a caller changing one body cannot change another."""
    return {"type": "between_tools"}


# --------------------------------------------------------------------------- the input


def paths_in(diff: str) -> list[str]:
    """Every path a diff changes, from its `diff --git` headers, in order."""
    return [m.group(2) for m in _DIFF_HEADER.finditer(diff or "")]


def trim_diff(diff: str, max_chars: int = MAX_DIFF_CHARS) -> tuple[str, list[str]]:
    """The diff, whole files up to `max_chars`, and the paths left out.

    `wikiprop.trim_diff` does the cutting: generated files dropped, no file's
    part ever cut in half. The files under `.ai/` and `.github/` go first, so
    the cap never cuts the very change this review is about.
    """
    first = [p for p in paths_in(diff) if p.startswith(_SYSTEM_TREES)]
    return wikiprop.trim_diff(diff, max_chars, first=first)


# --------------------------------------------------------------------------- the one request


def request_body(
    diff_text: str,
    omitted: list[str],
    references: dict[str, str],
    *,
    model: str,
    max_tokens: int,
    system: str,
) -> dict[str, Any]:
    """The Messages API body. No tools and no thinking: one JSON answer.

    The references come from `main` and the diff from the PR; all of it is
    fenced, the diff because a branch wrote every word of it. A cut diff says
    so in the message, naming what was left out, so the model never judges a
    part as if it were the whole.
    """
    parts = [_SYSTEM_FRAMING]
    for path, text in references.items():
        parts.append(fenced(f"Reference: {path}", text))
    parts.append(fenced("The pull request's diff", diff_text or "(empty)"))
    if omitted:
        listed = "\n".join(f"- {p}" for p in omitted)
        parts.append(
            fenced(
                "Not shown",
                "The diff was cut at the input cap. These files' changes are not shown "
                f"above, so say nothing about them:\n{listed}",
            )
        )
    return {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "thinking": thinking(),
        "messages": [{"role": "user", "content": "\n\n".join(parts)}],
    }


# --------------------------------------------------------------------------- the answer


def read_answer(body: Any, shown: Iterable[str]) -> dict[str, Any] | None:
    """The findings that survive checking, and how many did not; or None
    when the response has no usable answer.

    The answer is `{"findings": [{"path", "property", "before", "after",
    "reason"}]}`, alone or in a code fence; an empty list is an answer. A
    finding is kept only if its `path` is one of `shown`, both grades are in
    `GRADES` and `after` is weaker than `before`, and `property` and
    `reason` are non-empty strings. Anything else is dropped and counted: the
    count is shown, so a model that invents is visible as one. At most
    `MAX_FINDINGS` are kept.
    """
    text = first_text(body)
    if text is None:
        return None
    parsed = json_object(text)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("findings"), list):
        return None
    paths = set(shown)
    kept: list[dict[str, str]] = []
    dropped = 0
    for item in parsed["findings"]:
        finding = _finding(item, paths)
        if finding is None:
            dropped += 1
        elif len(kept) < MAX_FINDINGS:
            kept.append(finding)
    return {"findings": kept, "dropped": dropped}


def _finding(item: Any, paths: set[str]) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None
    path, before, after = item.get("path"), item.get("before"), item.get("after")
    prop, reason = item.get("property"), item.get("reason")
    if not isinstance(path, str) or path not in paths:
        return None
    if before not in GRADES or after not in GRADES:
        return None
    if GRADES.index(after) <= GRADES.index(before):
        return None  # held or strengthened: not a regression
    if not isinstance(prop, str) or not prop.strip():
        return None
    if not isinstance(reason, str) or not reason.strip():
        return None
    return {
        "path": path,
        "property": _cut(prop, MAX_PROPERTY_CHARS),
        "before": before,
        "after": after,
        "reason": _cut(reason, MAX_REASON_CHARS),
    }


def _cut(text: str, limit: int) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 3].rstrip() + "..."


# --------------------------------------------------------------------------- the comment


def render(
    review: dict[str, Any],
    *,
    omitted: list[str],
    usage: dict[str, Any] | None,
    cost: float | None,
    model: str | None,
    head_sha: str,
    run_url: str,
) -> str:
    """The comment: each possible regression with its path, the property at
    stake and the grade it falls from and to, or that none was found; then
    what it is, what it cost and which commit it read."""
    findings = review.get("findings") if isinstance(review.get("findings"), list) else []
    dropped = count(review.get("dropped"))
    if findings:
        title = f"{len(findings)} possible safety regression(s)"
    else:
        title = "no safety regression found"
    lines = [MARKER, f"### Director review: {title}", ""]

    for n, f in enumerate(findings, 1):
        lines.append(
            f"{n}. {code(f.get('path', '?'))}: {escape(f.get('property', ''), MAX_PROPERTY_CHARS)}"
            f" — {code(f.get('before', '?'), 30)} → {code(f.get('after', '?'), 30)}."
            f" {escape(f.get('reason', ''), MAX_REASON_CHARS)}"
        )
    if not findings:
        lines.append("The model named no control this diff weakens.")

    notes = []
    if dropped:
        notes.append(
            f"{dropped} finding(s) the model gave were dropped: a path the diff does not "
            "show, an unknown grade, or a grade that does not drop."
        )
    if omitted:
        named = ", ".join(code(p, 100) for p in omitted[:_MAX_SHOWN_OMITTED])
        more = (
            f" and {len(omitted) - _MAX_SHOWN_OMITTED} more"
            if len(omitted) > _MAX_SHOWN_OMITTED
            else ""
        )
        notes.append(f"The diff of these files was not read, past the input cap: {named}{more}.")
    for note in notes:
        lines += ["", f"Note: {note}"]

    lines += [
        "",
        (
            "Advisory: an independent model read this diff against `philosophy.md` §4 and "
            "`threat-model.md` as they stand on `main`. It fails nothing and approves "
            "nothing, and it can be misled by the diff it reads. The human's review is "
            "the control."
        ),
        "",
        f"Read by {code(model or '?', 80)} · {tokens_text(usage)} · {cost_text(cost)}",
        "",
        _run_line(head_sha, run_url),
    ]
    return "\n".join(lines) + "\n"


def _run_line(head_sha: str, run_url: str) -> str:
    url = run_url if is_safe_url(run_url) and len(run_url) <= 300 else ""
    link = f"[the run]({url})" if url else "the run (no usable link)"
    return f"Commit {code(str(head_sha)[:7], 7)} · {link}"
