"""Prompt 10 migrations keep decisions canonical without losing safety choices.

The first slice moves D3 out of a mixed history/status handoff. Existing
section citations remain useful through routing links; the ADR owns the choice,
and the state-machine reference continues to own executable protocol details.
"""

import json
import re
from pathlib import Path

from agentlib import doclint

ROOT = Path(__file__).resolve().parents[2]
ADR = ROOT / "wiki/GeneralContext/Decisions/0001-bounded-orchestration.md"
HANDOFF = ROOT / ".ai/docs/handoff.md"
ROUTING = ROOT / "wiki/GeneralContext/Architecture/work-modes.md"


def links_to_adr(source, text):
    return any(
        doclint.resolve(ROOT, source.relative_to(ROOT).as_posix(), target.split("#", 1)[0])
        == ADR.resolve()
        for target in doclint.inline_links(text)
        if not target.startswith(("https:", "http:"))
    )


def test_d3_decision_has_one_numbered_typed_home_within_the_shared_budget():
    assert ADR.is_file(), "D3's choice needs its own canonical numbered ADR"
    text = ADR.read_text(encoding="utf-8")
    fields, body, valid = doclint.frontmatter(text)
    assert valid and fields.get("type") == "decision"
    assert re.search(r"(?m)^#\s+0001\b", body)
    assert {"context", "choice", "consequences"} <= doclint.anchors(text)
    assert len(body.split()) <= doclint.load_budgets(ROOT)["decision"]
    # Preserve the safety commitments, without prescribing their explanatory prose.
    assert {
        "DISPATCH_MANAGER",
        "MAX_MANAGER_INVOCATIONS",
        "MANAGER_RETRY",
        "MANAGER_RESCOPE",
        "ESCALATED",
        "AGENT_FAILED",
        "last_dispatch",
        "last_ci_run",
    } <= set(re.findall(r"`([A-Za-z_]+)`", body))


def test_handoff_d3_routes_to_the_decision_instead_of_its_old_line_citations():
    text = HANDOFF.read_text(encoding="utf-8")
    (row,) = re.findall(r"(?m)^\| D3 \|.*$", text)
    assert links_to_adr(HANDOFF, row), "The retained D3 citation must route to its ADR"
    assert "state.py:274" not in row
    assert doclint.has_section(text, "10") and doclint.has_section(text, "10.3")


def test_the_human_escalation_exit_routes_to_the_same_decision():
    text = HANDOFF.read_text(encoding="utf-8")
    agreement = text.split("### 10.3 ", 1)[1].split("### 10.4 ", 1)[0]
    (item,) = re.findall(r"(?ms)^3\. (.*?)(?=^\d+\. |\Z)", agreement)
    assert links_to_adr(HANDOFF, item), "Item 3 must share D3's decision owner"


def test_canonical_routing_discovers_the_migrated_decision():
    text = ROUTING.read_text(encoding="utf-8")
    routing = text.split("## How work is handed on and planned", 1)[1].split("\n## ", 1)[0]
    assert links_to_adr(ROUTING, routing)


def test_the_fixed_d3_citation_exception_is_retired():
    baseline = json.loads((ROOT / ".ai/docs-baseline.json").read_text(encoding="utf-8"))
    retired = json.dumps([".ai/docs/handoff.md", "citation", "state.py:274"], separators=(",", ":"))
    assert retired not in baseline
