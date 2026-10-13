"""The CI failure summary: one PR comment when CI fails on an `agent/*` PR.

`wiki/GeneralContext/Architecture/work-modes.md` "Cheap automation" and
`Prompts/04-cheap-automations.md` automation 1. The human should learn what
failed, where, and the likely cause without reading a raw Actions log.

Script-first, like `ciresult`, which this builds on: which jobs failed and
which tests are parsing, done here for free and the same way every time. A
model (`.ai/bin/ci_summary.py` makes the one call) writes only the "likely
cause" sentence, from the parsed failure and a capped log tail.

Everything that reaches the comment came from a branch or a model, so all of
it is treated as hostile text: the log is fenced when it is shown to the
model, and every string is escaped before it becomes markdown. A comment that
could mention someone, link somewhere, or close the marker it is found by
would turn a failing test into a way to write on the PR.
"""

from __future__ import annotations

import json
import re
from typing import Any

from agentlib import ciresult, telemetry
from agentlib.promptbuild import FENCE

# How the workflow finds the comment it posted last time, to update it in
# place. An HTML comment, so it is invisible on the rendered PR.
MARKER = "<!-- fanwire-ci-summary -->"

# Haiku 5.5's price doubles above 100K input tokens (Prompts/04). 20K
# characters of log is roughly 5-7K tokens: far below that, and the end of a
# failed job's log is where its reason is.
MAX_LOG_CHARS = 20_000

# One sentence needs tens of tokens. The cap bounds what a runaway answer can
# cost, not what a good one needs.
MAX_TOKENS = 300

# The cause is cut to this before it is escaped: one sentence, not an essay.
MAX_CAUSE_CHARS = 400

# The comment is a glance, not a report: the run link has the rest.
MAX_LISTED = 5
_MAX_CODE_CHARS = 200
_MAX_SUMMARY_CHARS = 200

# Markdown punctuation that could start emphasis, a link, a heading, a table
# or a code span. Backslash-escaped, so it renders as itself.
_MARKDOWN = re.compile(r"([\\`*_\[\]()#+!|~{}])")
# A bare URL or `www.` host is autolinked by GitHub even with no markdown.
_AUTOLINK = re.compile(r"(?i)(://|\bwww\.)")
# The run link is the one link the comment makes, and it comes from the
# workflow, not the branch. Anything that could break out of `(...)` is
# refused and shown as text instead.
_SAFE_URL = re.compile(r"https://[^\s()<>\[\]`\"'\\]+")

_SYSTEM_FRAMING = (
    "CI failed on an agent branch. Below, as data, are the names of the failed "
    "jobs, the failure as a parser already read it, and the end of the failed "
    "jobs' log. Write the one sentence your instructions ask for."
)


# --------------------------------------------------------------------------- what failed


def failed_jobs(ran: Any) -> list[str]:
    """Jobs whose conclusion is `failure`, from `gh run view --json jobs`.

    The aggregate `gate` is left out: it fails whenever anything does, so it
    names nothing. Unreadable input is an empty list, not an error; the
    comment then says less, it does not fail.
    """
    listed = ran.get("jobs") if isinstance(ran, dict) else None
    if not isinstance(listed, list):
        return []
    out: list[str] = []
    for job in listed:
        if not isinstance(job, dict) or not isinstance(job.get("name"), str):
            continue
        name = job["name"]
        if job.get("conclusion") == "failure" and name != ciresult.AGGREGATE_JOB:
            out.append(name)
    return out


def log_tail(raw_log: str, max_chars: int = MAX_LOG_CHARS) -> str:
    """The end of a `--log-failed` log, each line `[job] content`, at most
    `max_chars` long.

    The `job<TAB>step<TAB>timestamp` prefix is replaced by the job alone:
    the timestamps are thousands of characters of nothing, and the step name
    repeats on every line. A log with no prefix is kept as it is.
    """
    parsed = ciresult._gh_lines(raw_log or "")
    if parsed:
        text = "\n".join(f"[{job}] {content}" for job, content in parsed)
    else:
        text = raw_log or ""
    if len(text) <= max_chars:
        return text
    cut = text[-max_chars:]
    # Drop the partial first line, so the model never reads half a line as
    # if it were whole.
    newline = cut.find("\n")
    return cut[newline + 1 :] if newline != -1 else cut


# --------------------------------------------------------------------------- the one request


def request_body(
    distilled: dict[str, Any],
    jobs: list[str],
    tail: str,
    *,
    model: str,
    max_tokens: int,
    system: str,
) -> dict[str, Any]:
    """The Messages API body. No tools and no thinking: one short answer.

    Job names, the parse and the log are all fenced. Job names are fenced
    too because on a `pull_request` run the workflow file, and so its job
    names, comes from the branch.
    """
    content = "\n\n".join(
        [
            _SYSTEM_FRAMING,
            _fenced("Failed jobs", "\n".join(jobs) or "(none could be read)"),
            _fenced("Parsed failure (ciresult)", json.dumps(distilled, indent=2, sort_keys=True)),
            _fenced("End of the failed jobs' log", tail),
        ]
    )
    return {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": content}],
    }


def _fenced(label: str, body: str) -> str:
    # As promptbuild's: the marker is stripped from the body so the log cannot
    # close its own fence and present the rest of itself as instruction.
    safe = body.replace(FENCE, "[fence marker removed]")
    return f"## {label}\n\n{FENCE}\n{safe}\n{FENCE}"


def read_cause(body: Any) -> str | None:
    """The first text block of a Messages API response, flattened to one line
    and cut to `MAX_CAUSE_CHARS`, or None when there is no usable text."""
    blocks = body.get("content") if isinstance(body, dict) else None
    if not isinstance(blocks, list):
        return None
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            text = " ".join(str(block.get("text") or "").split())
            if not text:
                return None
            if len(text) > MAX_CAUSE_CHARS:
                text = text[: MAX_CAUSE_CHARS - 3].rstrip() + "..."
            return text
    return None


def cost_usd(usage: Any, price: dict[str, float] | None) -> float | None:
    """The call's cost from the usage the response reports (D6: cache tokens
    included), or None when it cannot be priced honestly.

    Anthropic's usage is mapped onto telemetry's record fields so the pricing
    rules live in one place. Cache writes whose 5-minute/1-hour split the
    response did not give are not guessed at: telemetry returns None.
    """
    if not isinstance(usage, dict) or not isinstance(price, dict):
        return None
    if "input_tokens" not in usage and "output_tokens" not in usage:
        return None
    split = usage.get("cache_creation") if isinstance(usage.get("cache_creation"), dict) else {}
    rec = {
        "provider": "anthropic",
        "model": "priced",
        "input_tokens": _count(usage.get("input_tokens")),
        "output_tokens": _count(usage.get("output_tokens")),
        "cache_read_input_tokens": _count(usage.get("cache_read_input_tokens")),
        "cache_creation_input_tokens": _count(usage.get("cache_creation_input_tokens")),
        "cache_creation_5m_input_tokens": _count(split.get("ephemeral_5m_input_tokens")),
        "cache_creation_1h_input_tokens": _count(split.get("ephemeral_1h_input_tokens")),
    }
    return telemetry.estimate(rec, {"anthropic/priced": price})


def _count(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


# --------------------------------------------------------------------------- the comment


def escape(text: Any, limit: int = MAX_CAUSE_CHARS) -> str:
    """Untrusted text as one line of inert markdown.

    HTML is entity-escaped (so no tag and no `<!--`), markdown punctuation is
    backslash-escaped (no emphasis, link or code span), and `@` and URLs get
    a zero-width space (no mention, no autolink). Cut to `limit` first, so the
    cut can never split an escape in half.
    """
    flat = " ".join(str(text).split())
    if len(flat) > limit:
        flat = flat[: limit - 3].rstrip() + "..."
    flat = flat.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    flat = _MARKDOWN.sub(r"\\\1", flat)
    flat = flat.replace("@", "@\u200b")
    return _AUTOLINK.sub(lambda m: m.group(1)[:-1] + "\u200b" + m.group(1)[-1], flat)


def _code(text: Any) -> str:
    """A path or test id as an inline code span: rendered literally, so only
    a backtick (which would end the span) has to go."""
    flat = " ".join(str(text).split()).replace("`", "'")[:_MAX_CODE_CHARS]
    return f"`{flat.replace('<!--', '<!-\u200b-')}`" if flat else "`?`"


def render(
    distilled: dict[str, Any],
    jobs: list[str],
    cause: str,
    *,
    usage: dict[str, Any] | None,
    cost: float | None,
    model: str | None,
    run_url: str,
) -> str:
    """The comment: what failed, where, the likely cause, and what it cost.

    `model=None` means no model was asked (an infrastructure failure), and
    the footer says so instead of reporting tokens.
    """
    failures = distilled.get("failures") if isinstance(distilled, dict) else None
    failures = [f for f in failures if isinstance(f, dict)] if isinstance(failures, list) else []

    if jobs:
        noun = "job" if len(jobs) == 1 else "jobs"
        named = ", ".join(_code(j) for j in jobs[:MAX_LISTED])
        more = f" and {len(jobs) - MAX_LISTED} more" if len(jobs) > MAX_LISTED else ""
        heading = f"### CI failed: {len(jobs)} {noun} ({named}{more})"
    else:
        heading = "### CI failed"
    lines = [MARKER, heading, ""]

    for failure in failures[:MAX_LISTED]:
        where = failure.get("test") or failure.get("file") or "?"
        category = _code(str(failure.get("category") or "unknown")[:40])
        summary = escape(failure.get("summary") or "", _MAX_SUMMARY_CHARS)
        lines.append(f"- {_code(where)} ({category}){': ' + summary if summary else ''}")
    hidden = len(failures) - MAX_LISTED
    if hidden > 0:
        lines.append(f"- and {hidden} more")
    elif failures and distilled.get("truncated"):
        lines.append("- and more (the parsed list was truncated)")
    if not failures:
        origin = escape(distilled.get("origin") or "unknown", 40) if distilled else "unknown"
        lines.append(f"- no failing test could be parsed from the log (origin: {origin})")

    lines += ["", f"**Likely cause:** {escape(cause)}", "", _footer(usage, cost, model, run_url)]
    return "\n".join(lines) + "\n"


def _footer(usage: dict[str, Any] | None, cost: float | None, model: str | None, url: str) -> str:
    link = f"[the run]({url})" if _SAFE_URL.fullmatch(url or "") else escape(url, 200)
    tail = f"{link} · updated in place on each run"
    if model is None:
        return f"No model was asked; this was read from the log alone. {tail}"
    used = usage if isinstance(usage, dict) else {}
    tokens = (
        f"{_count(used.get('input_tokens'))} input / "
        f"{_count(used.get('output_tokens'))} output tokens"
    )
    cached = _count(used.get("cache_read_input_tokens")) + _count(
        used.get("cache_creation_input_tokens")
    )
    if cached:
        tokens += f" (+{cached} cache)"
    priceable = isinstance(cost, (int, float)) and not isinstance(cost, bool)
    priced = f"${cost:.6f}" if priceable else "unpriced"
    return f"Cause by {_code(model)} · {tokens} · {priced} · {tail}"
