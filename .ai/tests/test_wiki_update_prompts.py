"""Wiki writers share Director-reviewed rules from the tools checkout.

The branch is data (handoff D2b): neither cwd, task context nor a merged
checkout may supply instructions. Missing rules must stop construction,
otherwise a deployment error silently restores the old divergent writers.
"""

from pathlib import Path

import pytest

from agentlib import promptbuild as pb


@pytest.fixture
def trusted(tmp_path):
    repo = tmp_path / "tools"
    ai = repo / ".ai"
    prompts = ai / "prompts"
    prompts.mkdir(parents=True)
    (prompts / "_shared.md").write_text("SHARED", encoding="utf-8")
    for name in ("context-maintainer.md", "wiki-proposal.md"):
        (prompts / name).write_text("WRITER\n{{WIKI_UPDATE_RULES}}", encoding="utf-8")
    skill = repo / ".claude/skills/wiki-update/SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text(
        "DIRECTOR ONLY\n<!-- wiki-update:rules:start -->\n"
        "TRUSTED RULES\n{{WIKI_UPDATE_ROUTING}}\n"
        "<!-- wiki-update:rules:end -->\nMEASUREMENT NOTES",
        encoding="utf-8",
    )
    routing = repo / "wiki/GeneralContext/Architecture/work-modes.md"
    routing.parent.mkdir(parents=True)
    routing.write_text(
        "# Modes\n## How work is handed on and planned\n\nTRUSTED ROUTING\n"
        "## Status\nUNRELATED STATUS",
        encoding="utf-8",
    )
    return ai, skill, routing


def context(path):
    return {
        "role": "context_maintainer",
        "task_id": "DEMO-001",
        "branch": "agent/DEMO-001",
        "attempt": 1,
        "max_attempts": 3,
        "context_files": [str(path)],
    }


def test_both_writers_inline_identical_rules_from_tools_before_data(trusted, tmp_path, monkeypatch):
    ai, _, _ = trusted
    branch = tmp_path / "branch"
    forged = branch / ".claude/skills/wiki-update/SKILL.md"
    forged.parent.mkdir(parents=True)
    forged.write_text("FORGED RULES", encoding="utf-8")
    monkeypatch.chdir(branch)
    worker = pb.build(context(forged), ai)
    proposal = pb.writer_prompt(ai, "wiki-proposal.md")
    common = "TRUSTED RULES\n## How work is handed on and planned\n\nTRUSTED ROUTING"
    assert common in worker and common in proposal
    assert worker.index(common) < worker.index(pb.DATA_BANNER) < worker.index("FORGED RULES")
    for out in (worker, proposal):
        assert "DIRECTOR ONLY" not in out and "MEASUREMENT NOTES" not in out
        assert "UNRELATED STATUS" not in out
        assert "{{WIKI_UPDATE" not in out
    assert "FORGED RULES" not in proposal


@pytest.mark.parametrize("damage", ["missing", "unclosed", "duplicate", "empty", "routing"])
@pytest.mark.parametrize("writer", ["context-maintainer.md", "wiki-proposal.md"])
def test_unavailable_or_ambiguous_rules_stop_both_writers(trusted, damage, writer):
    ai, skill, routing = trusted
    if damage == "missing":
        skill.unlink()
    elif damage == "unclosed":
        skill.write_text("<!-- wiki-update:rules:start -->\nRULES", encoding="utf-8")
    elif damage == "duplicate":
        skill.write_text(skill.read_text(encoding="utf-8") * 2, encoding="utf-8")
    elif damage == "empty":
        skill.write_text(
            "<!-- wiki-update:rules:start --><!-- wiki-update:rules:end -->", encoding="utf-8"
        )
    else:
        routing.write_text("# Heading renamed", encoding="utf-8")
    with pytest.raises(pb.PromptError):
        if writer == "context-maintainer.md":
            pb.build(context(Path("missing-data.md")), ai)
        else:
            pb.writer_prompt(ai, writer)


def test_other_roles_do_not_need_the_director_skill(trusted):
    ai, skill, _ = trusted
    skill.unlink()
    (ai / "prompts/code-agent.md").write_text("CODE", encoding="utf-8")
    ctx = context(Path("missing-data.md"))
    ctx["role"] = "code_agent"
    assert "CODE" in pb.build(ctx, ai)
