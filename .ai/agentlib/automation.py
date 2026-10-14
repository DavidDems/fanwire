"""What every cheap automation shares: the one call, its price, and inert text.

`wiki/GeneralContext/Architecture/work-modes.md` "Cheap automation". Each
automation asks a model one narrow question from `main`'s copy of a workflow
and turns the answer into a PR comment (`Prompts/04-cheap-automations.md`).
The question differs; how it is asked, priced and written down must not, so
those halves live here once rather than in each automation:

  - the one POST to the Messages API, with no retry and the key redacted
    from anything remote before it is written anywhere;
  - the cost, priced from the response's own `usage` (D6) through telemetry,
    so the pricing rules stay in one place;
  - text that came from a branch or a model, made inert before it reaches
    markdown: escaped, code-spanned, or fenced when it is shown to a model.

Stdlib only, no SDK (`AGENTS.md` "Build / test / run"): this runs in CI steps
that install nothing, and the request is one POST with a JSON body.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

from agentlib import telemetry
from agentlib.promptbuild import FENCE

REDACTED = "***"

# Untrusted text is cut to this before it is escaped, unless a caller says
# otherwise: a sentence, not an essay.
MAX_ESCAPED_CHARS = 400
_MAX_CODE_CHARS = 200
# A response's shape is a stop reason and a few block types: tens of chars.
_MAX_DESCRIBED_CHARS = 200
# Remote text in a job log or summary line: enough to read, never a page.
_MAX_INLINE_CHARS = 300

# Markdown punctuation that could start emphasis, a link, a heading, a table
# or a code span. Backslash-escaped, so it renders as itself.
_MARKDOWN = re.compile(r"([\\`*_\[\]()#+!|~{}])")
# A bare URL or `www.` host is autolinked by GitHub even with no markdown.
_AUTOLINK = re.compile(r"(?i)(://|\bwww\.)")
# A run link is the one link a comment makes, and it comes from the workflow,
# not the branch. Anything that could break out of `(...)` is refused and
# shown as text instead.
_SAFE_URL = re.compile(r"https://[^\s()<>\[\]`\"'\\]+")


# --------------------------------------------------------------------------- the one call


def post(
    endpoint: str,
    version: str,
    api_key: str,
    payload: dict[str, Any],
    timeout: float,
    *,
    user_agent: str,
) -> tuple[dict[str, Any], str | None]:
    """One POST to the Messages API, no retry. Returns `(body, None)` or
    `({}, reason)`.

    Every failure is final, a 429 and a 529 included: an automation's cost
    bound is one call, and the next event is the retry. `urlopen` is looked
    up on `urllib.request` at call time, so a test that fakes the wire there
    fakes it here.
    """
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": version,
            "content-type": "application/json",
            "user-agent": user_agent,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # The body is remote text and can echo the request back, key header
        # and all. It is redacted before it is cut, so a cut can never leave
        # a fragment of the key behind.
        detail = redact(exc.read().decode("utf-8", "replace"), api_key)
        return {}, f"HTTP {exc.code}: {detail[:300]}".replace("\n", " ")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return {}, f"{type(exc).__name__}: {exc}"
    if not isinstance(body, dict):
        return {}, "the response is not a JSON object"
    return body, None


def redact(text: str, secret: str) -> str:
    return text.replace(secret, REDACTED) if secret else text


def describe_response(body: Any) -> str:
    """Why a response gave no answer, as one short line: its `stop_reason`
    and the types of its content blocks, in order, e.g.
    `stop_reason=max_tokens; content=[thinking]`.

    Only the shape, never a block's text: that is the model's, and this line
    goes to the job log and summary unescaped. Never raises, whatever `body`
    is, because it is only ever called once something has already gone wrong.
    """
    data = body if isinstance(body, dict) else {}
    stop = data.get("stop_reason")
    stop_text = stop if isinstance(stop, str) and stop.strip() else "none"
    blocks = data.get("content")
    types = []
    if isinstance(blocks, list):
        for block in blocks:
            kind = block.get("type") if isinstance(block, dict) else None
            types.append(kind if isinstance(kind, str) and kind.strip() else "?")
    described = f"stop_reason={stop_text}; content=[{', '.join(types) or 'none'}]"
    flat = " ".join(described.split()).replace("`", "'")
    return flat if len(flat) <= _MAX_DESCRIBED_CHARS else flat[: _MAX_DESCRIBED_CHARS - 3] + "..."


def first_text(body: Any) -> str | None:
    """The first text block of a Messages API response with anything but
    whitespace in it, stripped, or None when there is none.

    Blocks of any other type, and empty text blocks, are passed over rather
    than ending the search: an empty block ahead of the answer must not hide
    the answer.
    """
    blocks = body.get("content") if isinstance(body, dict) else None
    if not isinstance(blocks, list):
        return None
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        text = str(block.get("text") or "").strip()
        if text:
            return text
    return None


# --------------------------------------------------------------------------- the price


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
        "input_tokens": count(usage.get("input_tokens")),
        "output_tokens": count(usage.get("output_tokens")),
        "cache_read_input_tokens": count(usage.get("cache_read_input_tokens")),
        "cache_creation_input_tokens": count(usage.get("cache_creation_input_tokens")),
        "cache_creation_5m_input_tokens": count(split.get("ephemeral_5m_input_tokens")),
        "cache_creation_1h_input_tokens": count(split.get("ephemeral_1h_input_tokens")),
    }
    return telemetry.estimate(rec, {"anthropic/priced": price})


def priced(
    body: dict[str, Any], model: str, config: dict[str, Any], provider: str = "anthropic"
) -> tuple[dict[str, Any], str, float | None]:
    """The response's usage, the model that answered, and the call's cost."""
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    answered_by = body.get("model") if isinstance(body.get("model"), str) else model
    # Priced by the model requested, as config.json's prices are keyed.
    price = config.get("telemetry", {}).get("prices", {}).get(f"{provider}/{model}")
    return usage, answered_by, cost_usd(usage, price)


def count(value: object) -> int:
    """A token count as a non-negative int; anything else is zero."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def tokens_text(usage: dict[str, Any] | None) -> str:
    """`4000 input / 120 output tokens`, plus cache tokens when there were any."""
    used = usage if isinstance(usage, dict) else {}
    text = f"{count(used.get('input_tokens'))} input / {count(used.get('output_tokens'))} output tokens"
    cached = count(used.get("cache_read_input_tokens")) + count(
        used.get("cache_creation_input_tokens")
    )
    return text + (f" (+{cached} cache)" if cached else "")


def cost_text(cost: object, places: int = 6) -> str:
    """`$0.000460`, or `unpriced` when there is no honest number."""
    priceable = isinstance(cost, int | float) and not isinstance(cost, bool)
    return f"${cost:.{places}f}" if priceable else "unpriced"


# --------------------------------------------------------------------------- the job log and summary


def call_lines(answered_by: str, usage: dict[str, Any], cost: float | None) -> list[str]:
    """The job summary's account of a call that was made: model, usage, cost."""
    return [
        f"- model: `{inline(answered_by)}`",
        (
            f"- usage: {count(usage.get('input_tokens'))} input tokens, "
            f"{count(usage.get('output_tokens'))} output tokens, "
            f"{count(usage.get('cache_read_input_tokens'))} cache read, "
            f"{count(usage.get('cache_creation_input_tokens'))} cache write"
        ),
        f"- cost: {cost_text(cost if isinstance(cost, float) else None)}",
    ]


def log_line(described: str, usage: dict[str, Any], cost: float | None) -> str:
    """The same call as one job-log line. The step summary cannot be read
    back through the API; `gh run view --log` can read this."""
    return (
        f"{inline(described)}; {count(usage.get('input_tokens'))} input / "
        f"{count(usage.get('output_tokens'))} output tokens; "
        f"{cost_text(cost if isinstance(cost, float) else None)}"
    )


def inline(value: object) -> str:
    """Remote or branch text flattened into one inline-code-safe line."""
    return " ".join(str(value).split()).replace("`", "'")[:_MAX_INLINE_CHARS]


def positive(value: object, default: int) -> int:
    """A config cap as a positive int, or `default` when it is not one."""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return default
    return value


# --------------------------------------------------------------------------- inert text


def escape(text: Any, limit: int = MAX_ESCAPED_CHARS) -> str:
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


def code(text: Any, limit: int = _MAX_CODE_CHARS) -> str:
    """A path or test id as an inline code span: rendered literally, so only
    a backtick (which would end the span) has to go."""
    flat = " ".join(str(text).split()).replace("`", "'")[:limit]
    return f"`{flat.replace('<!--', '<!-\u200b-')}`" if flat else "`?`"


def fenced(label: str, body: str) -> str:
    # As promptbuild's: the marker is stripped from the body so the data
    # cannot close its own fence and present the rest of itself as instruction.
    safe = body.replace(FENCE, "[fence marker removed]")
    return f"## {label}\n\n{FENCE}\n{safe}\n{FENCE}"


def is_safe_url(url: object) -> bool:
    """Can `url` be the target of a markdown link without breaking out of it?"""
    return isinstance(url, str) and bool(_SAFE_URL.fullmatch(url))
