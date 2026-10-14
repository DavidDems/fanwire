"""The shadow record: what each automation's two answers were, kept on the PR.

`Prompts/04-cheap-automations.md` "Decided by the human", 2026-10-13. `jev`
is asked each automation's yes/no question in shadow, beside the model that
writes the comment, and nothing acts on either answer. Whether `jev` is worth
keeping is decided from the record of those pairs: does it agree with Haiku,
with the human's own reading, and at what cost.

That record is hidden JSON in the automation's own comment, one line:

    <!-- fanwire-shadow {"agree":true,"automation":"coverage",...} -->

so it needs no new storage and no new permission: the comment is already
written, and an HTML comment is invisible on the rendered PR. An `agentctl
shadow report` will collect them later over `gh api` (not built yet); `decode`
is the half it will use.

The record holds strings a branch or a model wrote (a task id, a model name),
so it is encoded such that no value can end the HTML comment early: `<`, `>`
and `&` are written as JSON unicode escapes, which read back unchanged.
"""

from __future__ import annotations

import json
import re
from typing import Any

PREFIX = "<!-- fanwire-shadow "
SUFFIX = " -->"

_RECORD = re.compile(re.escape(PREFIX) + r"(.*?)" + re.escape(SUFFIX))


def encode(record: dict[str, Any]) -> str:
    """`record` as one hidden line: compact, sorted, ASCII JSON in a comment.

    `ensure_ascii` keeps it on one line whatever the strings hold (a newline
    in a value is already `\\n`). The three replacements only ever touch the
    inside of JSON strings, since JSON's own syntax uses none of them.
    """
    text = json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    text = text.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    return f"{PREFIX}{text}{SUFFIX}"


def decode(text: str) -> list[dict[str, Any]]:
    """Every well-formed record in a comment body, in order.

    A record that is not a JSON object is skipped, not raised on: a report
    over many comments must not stop at one that a person edited by hand.
    """
    out: list[dict[str, Any]] = []
    for match in _RECORD.finditer(text if isinstance(text, str) else ""):
        try:
            record = json.loads(match.group(1))
        except ValueError:
            continue
        if isinstance(record, dict):
            out.append(record)
    return out
