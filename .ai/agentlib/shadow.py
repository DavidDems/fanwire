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
shadow report` collects them from the issue comments `gh api` wrote;
`load_comments`, `collect`, `haiku_answer` and `summarize` are its offline
half, and `decode` reads each record.

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


BOT = "github-actions[bot]"

# Haiku's verdict, per automation: the key in the record's `haiku` object whose
# bool is jev's yes/no. A new automation adds one line.
_HAIKU_KEY = {"coverage": "all_pinned", "spec_drift": "matches"}


def load_comments(text: str) -> list[dict[str, Any]]:
    """The comment objects in `gh api` output; never raises.

    One array, several arrays back to back (`--paginate`), or an array of
    arrays (`--slurp`). Anything that is not a dict is dropped.
    """
    if not isinstance(text, str):
        return []
    decoder = json.JSONDecoder()
    out: list[dict[str, Any]] = []

    def take(value: Any) -> None:
        if isinstance(value, dict):
            out.append(value)
        elif isinstance(value, list):
            for item in value:
                take(item)

    pos, n = 0, len(text)
    while True:
        while pos < n and text[pos].isspace():
            pos += 1
        if pos >= n:
            break
        try:
            value, pos = decoder.raw_decode(text, pos)
        except ValueError:
            break
        if isinstance(value, list):
            take(value)
    return out


def collect(comments: list[Any]) -> list[dict[str, Any]]:
    """The bot's records, one per (automation, pr): the latest comment wins."""
    best: dict[tuple[str, int], tuple[str, dict[str, Any]]] = {}
    for c in comments:
        if not isinstance(c, dict):
            continue
        user = c.get("user")
        body = c.get("body")
        if not isinstance(user, dict) or user.get("login") != BOT or not isinstance(body, str):
            continue
        updated = c.get("updated_at")
        stamp = updated if isinstance(updated, str) else ""
        for rec in decode(body):
            auto, pr = rec.get("automation"), rec.get("pr")
            if not isinstance(auto, str) or not isinstance(pr, int) or isinstance(pr, bool):
                continue
            key = (auto, pr)
            if key not in best or stamp >= best[key][0]:
                best[key] = (stamp, rec)
    return [rec for _, rec in best.values()]


def haiku_answer(record: dict[str, Any]) -> str | None:
    """Haiku's verdict in jev's terms: "yes", "no", or None if not stated."""
    key = _HAIKU_KEY.get(record.get("automation"))  # type: ignore[arg-type]
    haiku = record.get("haiku")
    if key is None or not isinstance(haiku, dict):
        return None
    value = haiku.get(key)
    if not isinstance(value, bool):
        return None
    return "yes" if value else "no"


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def _cost(obj: Any) -> float:
    return (_number(obj.get("cost_usd")) if isinstance(obj, dict) else None) or 0.0


def _jev_choice(record: dict[str, Any]) -> str | None:
    jev = record.get("jev")
    if isinstance(jev, dict) and jev.get("choice") in ("yes", "no"):
        return jev["choice"]
    return None


def _confidence(record: dict[str, Any]) -> float | None:
    jev = record.get("jev")
    return _number(jev.get("confidence")) if isinstance(jev, dict) else None


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Agreement, jev's answers, confidence and cost, per automation."""
    totals = {"records": 0, "agree": 0, "disagree": 0, "haiku_cost_usd": 0.0, "jev_cost_usd": 0.0}
    by: dict[str, dict[str, Any]] = {}
    confs: dict[str, list[float]] = {}
    rows: list[dict[str, Any]] = []
    for r in records:
        name = str(r.get("automation"))
        b = by.setdefault(
            name,
            {
                "records": 0,
                "agree": 0,
                "disagree": 0,
                "jev": {"yes": 0, "no": 0, "none": 0},
                "haiku": {"yes": 0, "no": 0, "none": 0},
                "mean_confidence": None,
                "haiku_cost_usd": 0.0,
                "jev_cost_usd": 0.0,
            },
        )
        haiku, jev = haiku_answer(r), _jev_choice(r)
        conf = _confidence(r)
        hc, jc = _cost(r.get("haiku")), _cost(r.get("jev"))
        b["records"] += 1
        b["jev"][jev or "none"] += 1
        b["haiku"][haiku or "none"] += 1
        b["haiku_cost_usd"] += hc
        b["jev_cost_usd"] += jc
        totals["records"] += 1
        totals["haiku_cost_usd"] += hc
        totals["jev_cost_usd"] += jc
        agree = r.get("agree")
        if agree is True:
            b["agree"] += 1
            totals["agree"] += 1
        elif agree is False:
            b["disagree"] += 1
            totals["disagree"] += 1
        if conf is not None:
            confs.setdefault(name, []).append(conf)
        rows.append(
            {
                "pr": r.get("pr"),
                "task": r.get("task"),
                "automation": name,
                "haiku": haiku,
                "jev": jev,
                "confidence": conf,
                "agree": agree if isinstance(agree, bool) else None,
                "haiku_cost_usd": hc,
                "jev_cost_usd": jc,
            }
        )
    for name, values in confs.items():
        by[name]["mean_confidence"] = sum(values) / len(values)
    rows.sort(key=lambda row: (row["pr"], row["automation"]))
    return {"totals": totals, "by_automation": by, "rows": rows}
