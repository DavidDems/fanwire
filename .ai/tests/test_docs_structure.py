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
D2B_ADR = ROOT / "wiki/GeneralContext/Decisions/0002-worker-credential-isolation.md"
HANDOFF = ROOT / ".ai/docs/handoff.md"
ROUTING = ROOT / "wiki/GeneralContext/Architecture/work-modes.md"
DEPLOYMENT_ARCHIVE = (
    "https://github.com/DavidDems/fanwire/blob/"
    "95339e87be1f15815d46bcd08ccc51f91ea4dd60/TODO/02-deployment-requirements.md"
)


def links_to_adr(source, text, decision=ADR):
    return any(
        doclint.resolve(ROOT, source.relative_to(ROOT).as_posix(), target.split("#", 1)[0])
        == decision.resolve()
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


def test_d2b_decision_has_a_typed_numbered_home_and_keeps_the_isolation_contract():
    assert D2B_ADR.is_file(), "D2b's worker-isolation choice needs its own numbered ADR"
    text = D2B_ADR.read_text(encoding="utf-8")
    fields, body, valid = doclint.frontmatter(text)
    assert valid and fields.get("type") == "decision"
    assert re.search(r"(?m)^#\s+0002\b", body)
    assert {"context", "choice", "consequences"} <= doclint.anchors(text)
    assert len(body.split()) <= doclint.load_budgets(ROOT)["decision"]
    # These identify the existing boundaries, not a prescribed prose rendering.
    assert {
        "run-model",
        "land",
        "agentrun",
        "AGENTCTL_DATA_ROOT",
        "python -I",
        "fullmatch",
        ".ai/",
        ".claude/",
        ".mcp.json",
        "--setting-sources user",
        "--strict-mcp-config",
        "persist-credentials: false",
    } <= set(re.findall(r"`([^`]+)`", body))


def test_handoff_d2b_routes_to_its_decision_without_losing_section_citations():
    text = HANDOFF.read_text(encoding="utf-8")
    (row,) = re.findall(r"(?m)^\| D2b \|.*$", text)
    assert links_to_adr(HANDOFF, row, D2B_ADR)
    assert doclint.has_section(text, "10.1") and doclint.has_section(text, "10.3")


def test_the_split_worker_agreement_routes_to_the_same_d2b_owner():
    text = HANDOFF.read_text(encoding="utf-8")
    agreement = text.split("### 10.3 ", 1)[1].split("### 10.4 ", 1)[0]
    (item,) = re.findall(r"(?ms)^7\. (.*?)(?=^\d+\. |\Z)", agreement)
    assert links_to_adr(HANDOFF, item, D2B_ADR)


def test_canonical_routing_discovers_the_migrated_worker_isolation_choice():
    text = ROUTING.read_text(encoding="utf-8")
    routing = text.split("## How work is handed on and planned", 1)[1].split("\n## ", 1)[0]
    assert links_to_adr(ROUTING, routing, D2B_ADR)


def test_d2b_proof_gaps_and_residue_stay_visible_during_the_choice_migration():
    text = HANDOFF.read_text(encoding="utf-8")
    proof = text.split("**D2b, what only the first live run proves**", 1)[1].split(
        "**D3, what only a live run proves**", 1
    )[0]
    for unproven in ("MEDIA-002", "failed or cancelled", "run-model", "no live run on"):
        assert unproven in proof
    residue = text.split("**D2b residue, not fixed:**", 1)[1].split("### 10.2 ", 1)[0]
    for unresolved in ("cron", "timer", "ANTHROPIC_API_KEY", "/tmp", "merge base"):
        assert unresolved in residue


def test_the_bad_deployment_gate_citation_points_to_its_real_historical_source():
    text = HANDOFF.read_text(encoding="utf-8")
    assert DEPLOYMENT_ARCHIVE in doclint.inline_links(text)
    assert "`TODO/02-deployment-requirements.md` §3" not in text


def test_the_repaired_historical_deployment_citation_exception_is_retired():
    baseline = json.loads((ROOT / ".ai/docs-baseline.json").read_text(encoding="utf-8"))
    retired = json.dumps(
        [".ai/docs/handoff.md", "citation", "TODO/02-deployment-requirements.md §3"],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    assert retired not in baseline
