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
D4_ADR = ROOT / "wiki/GeneralContext/Decisions/0003-red-baseline.md"
D5_ADR = ROOT / "wiki/GeneralContext/Decisions/0004-required-quality-checks.md"
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


def test_d4_decision_has_a_typed_numbered_home_and_keeps_the_failure_reason_gate():
    assert D4_ADR.is_file(), "D4's red-baseline choice needs its own numbered ADR"
    text = D4_ADR.read_text(encoding="utf-8")
    fields, body, valid = doclint.frontmatter(text)
    assert valid and fields.get("type") == "decision"
    assert re.search(r"(?m)^#\s+0003\b", body)
    assert {"context", "choice", "consequences"} <= doclint.anchors(text)
    assert len(body.split()) <= doclint.load_budgets(ROOT)["decision"]
    # Preserve the decision's controls, rather than a line number or prose copy.
    assert {
        "ciresult.baseline_verdict",
        "TEST_AGENT_RUNNING",
        "CI_FAILED_WRONG_REASON",
        "MANAGER_REVIEW",
        "red_baseline_wrong_reason",
    } <= set(re.findall(r"`([^`]+)`", body))
    assert re.search(r"fail(?:ing)?[ -]closed", body, re.IGNORECASE)


def test_d4_decision_links_to_immutable_evidence_and_the_existing_protocol_owners():
    assert D4_ADR.is_file()
    text = D4_ADR.read_text(encoding="utf-8")
    links = doclint.inline_links(text)
    assert any(
        re.fullmatch(
            r"https://github\.com/DavidDems/fanwire/blob/[0-9a-f]{40}/"
            r"\.ai/docs/handoff\.md(?:#[\w-]+)?",
            target,
        )
        for target in links
    ), "Original evidence must survive at an immutable Git revision"
    for owner in ("state-machine.md", "operations.md"):
        assert links_to_adr(D4_ADR, text, ROOT / ".ai/docs" / owner)


def test_handoff_d4_routes_to_its_decision_without_losing_existing_section_citations():
    text = HANDOFF.read_text(encoding="utf-8")
    (row,) = re.findall(r"(?m)^\| D4 \|.*$", text)
    assert links_to_adr(HANDOFF, row, D4_ADR)
    assert "state.py:251" not in text
    for section in ("10", "10.1", "10.3"):
        assert doclint.has_section(text, section)


def test_canonical_routing_discovers_the_migrated_red_baseline_choice():
    text = ROUTING.read_text(encoding="utf-8")
    routing = text.split("## How work is handed on and planned", 1)[1].split("\n## ", 1)[0]
    assert links_to_adr(ROUTING, routing, D4_ADR)


def test_d4_unproven_cases_and_residue_remain_visible_in_the_defect_review():
    text = HANDOFF.read_text(encoding="utf-8")
    review = text.split("### 10.1 ", 1)[1].split("### 10.2 ", 1)[0]
    # Keep these limits in the retained review, not only the historical source.
    for gap in (
        r"[Uu]nproven[^.]*live failure",
        r"log fetch[^.]*`workflow_run`",
        r"real vitest output[^.]*hand-written",
        r"both suites red at once",
        r"incidental red[^.]*hostile test agent",
        r"MANAGER_RETRY[^.]*baseline[^.]*skips the check",
        r"re-run of a baseline[^.]*editing `state\.json`",
    ):
        assert re.search(gap, review), f"D4 migration must retain this limitation: {gap}"


def test_d4_retains_the_static_check_distinction_from_a_failed_test_job():
    text = D4_ADR.read_text(encoding="utf-8")
    # D5's row can migrate now; the same safety distinction is already owned
    # by immutable ADR 0003, rather than by the handoff's temporary inline copy.
    assert re.search(r"type-check failures.*?qualify only with a failed test job", text, re.DOTALL)
    assert "a lint failure never qualifies" in text


def test_the_migrated_d4_line_citation_exception_is_retired():
    baseline = json.loads((ROOT / ".ai/docs-baseline.json").read_text(encoding="utf-8"))
    retired = json.dumps([".ai/docs/handoff.md", "citation", "state.py:251"], separators=(",", ":"))
    assert retired not in baseline


def test_d5_decision_has_a_typed_numbered_home_and_keeps_the_required_quality_jobs():
    assert D5_ADR.is_file(), "D5's required quality checks need their own numbered ADR"
    text = D5_ADR.read_text(encoding="utf-8")
    fields, body, valid = doclint.frontmatter(text)
    assert valid and fields.get("type") == "decision"
    assert re.search(r"(?m)^#\s+0004\b", body)
    assert {"context", "choice", "consequences"} <= doclint.anchors(text)
    assert len(body.split()) <= doclint.load_budgets(ROOT)["decision"]
    assert {
        "backend-ruff",
        "backend-mypy",
        "frontend-typecheck",
        "frontend-lint",
        "app",
    } <= set(re.findall(r"`([^`]+)`", body))


def test_d5_links_the_existing_baseline_choice_protocol_and_immutable_evidence():
    assert D5_ADR.is_file()
    text = D5_ADR.read_text(encoding="utf-8")
    assert links_to_adr(D5_ADR, text, D4_ADR)
    for owner in (ROOT / ".ai/docs/state-machine.md", ROOT / ".github/workflows/test-agent.yml"):
        assert links_to_adr(D5_ADR, text, owner)
    assert (
        "https://github.com/DavidDems/fanwire/blob/"
        "c6af661ef1dd6fef0a9eb0f0042c38beee65a425/.ai/docs/handoff.md#101-defects"
    ) in doclint.inline_links(text)


def test_handoff_d5_routes_to_its_decision_without_losing_numbered_sections():
    text = HANDOFF.read_text(encoding="utf-8")
    (row,) = re.findall(r"(?m)^\| D5 \|.*$", text)
    assert links_to_adr(HANDOFF, row, D5_ADR)
    for section in ("10", "10.1", "10.3"):
        assert doclint.has_section(text, section)


def test_canonical_routing_discovers_the_migrated_quality_check_choice():
    text = ROUTING.read_text(encoding="utf-8")
    routing = text.split("## How work is handed on and planned", 1)[1].split("\n## ", 1)[0]
    assert links_to_adr(ROUTING, routing, D5_ADR)


def test_d5_live_proof_gaps_remain_visible_in_the_defect_review():
    text = HANDOFF.read_text(encoding="utf-8")
    review = text.split("### 10.1 ", 1)[1].split("### 10.2 ", 1)[0]
    # Extracting the choice must not turn unexercised runner paths into proof.
    for gap in (
        "Unproven until live: the cache reads",
        "`--log-failed`'s `Process completed` line",
        "`compose run -T --no-deps --entrypoint` on the runner",
    ):
        assert gap in review


def test_d5_residue_and_the_historical_pin_correction_remain_visible():
    text = HANDOFF.read_text(encoding="utf-8")
    review = text.split("### 10.1 ", 1)[1].split("### 10.2 ", 1)[0]
    for limit in (
        "ruff/mypy were `>=`-pinned",
        "**pinned 2026-10-19**",
        "`ruff==0.17.1`",
        "`mypy==2.4.0`",
        "test-agent run 39295837789",
        "test agents cannot run lint (D7)",
        "`ruff format` is not gated",
        "`distill` does not parse vitest's per-test lines",
    ):
        assert limit in review


def test_the_failure_exercise_citation_names_section_six_item_three():
    text = HANDOFF.read_text(encoding="utf-8")
    assert doclint.has_section(text, "6")
    assert not doclint.has_section(text, "6.3"), "Do not invent a heading to satisfy old debt"
    section = text.split("## 6. ", 1)[1].split("## 7. ", 1)[0]
    (exercise,) = re.findall(r"(?ms)^3\. (.*?)(?=^\d+\. |\Z)", section)
    assert "Exercise a failure path on purpose" in exercise
    agreement = text.split("### 10.3 ", 1)[1].split("### 10.4 ", 1)[0]
    (item,) = re.findall(r"(?ms)^2\. (.*?)(?=^\d+\. |\Z)", agreement)
    assert "§6.3" not in item
    assert re.search(r"§6\s*[,;:]?\s*item\s*3\b", item)


def test_the_repaired_failure_exercise_citation_exception_is_retired():
    baseline = json.loads((ROOT / ".ai/docs-baseline.json").read_text(encoding="utf-8"))
    retired = json.dumps(
        [".ai/docs/handoff.md", "citation", ".ai/docs/handoff.md §6.3"],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    assert retired not in baseline


def test_the_live_prompt_routes_to_d5_and_stays_within_its_prompt_budget():
    prompt = ROOT / "wiki/GeneralContext/Prompts/10-docs-structure.md"
    text = prompt.read_text(encoding="utf-8")
    fields, body, valid = doclint.frontmatter(text)
    assert valid and fields.get("type") == "prompt"
    assert len(body.split()) <= doclint.load_budgets(ROOT)["prompt"]
    assert links_to_adr(prompt, text, D5_ADR)
