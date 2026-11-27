"""The Director review skills: `.claude/skills/` plus a thin Codex entry point.

`wiki-update` is the model (`.ai/skills/README.md`, "Director wiki skill"): the
rules live once in `.claude/skills/<name>/SKILL.md`, and
`.agents/skills/<name>/SKILL.md` only names it. These skills are run by a
Director session that has a shell, so the worker rule in `test_skills.py`
(no shell command in a skill) does not apply to them; what does apply is the
frontmatter, the name-equals-directory rule and links that resolve.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ["wiki-update", "wiki-review", "ai-review"]
_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)\)")


def _canonical(name: str) -> Path:
    return ROOT / ".claude" / "skills" / name / "SKILL.md"


def _entry(name: str) -> Path:
    return ROOT / ".agents" / "skills" / name / "SKILL.md"


def _frontmatter(path: Path) -> str:
    head = path.read_text(encoding="utf-8").split("---", 2)
    assert len(head) == 3 and head[0] == "", f"{path} has no frontmatter"
    return head[1]


def _relative_targets(path: Path) -> list[str]:
    text = re.sub(r"```.*?```", "", path.read_text(encoding="utf-8"), flags=re.DOTALL)
    out = []
    for target in _LINK.findall(text):
        if re.match(r"^(?:[a-z][a-z0-9+.-]*:|#)", target):
            continue
        out.append(target.split("#", 1)[0])
    return [t for t in out if t]


@pytest.mark.parametrize("name", SKILLS)
@pytest.mark.parametrize("make", [_canonical, _entry], ids=["canonical", "entry"])
def test_the_skill_file_exists(name, make):
    assert make(name).is_file(), f"missing {make(name).relative_to(ROOT)}"


@pytest.mark.parametrize("name", SKILLS)
@pytest.mark.parametrize("make", [_canonical, _entry], ids=["canonical", "entry"])
def test_name_is_the_directory_and_description_is_present(name, make):
    front = _frontmatter(make(name))
    assert re.search(rf"^name: {re.escape(name)}$", front, re.MULTILINE)
    assert re.search(r"^description: \S", front, re.MULTILINE)


@pytest.mark.parametrize("name", SKILLS)
@pytest.mark.parametrize("make", [_canonical, _entry], ids=["canonical", "entry"])
def test_every_relative_link_resolves(name, make):
    path = make(name)
    for target in _relative_targets(path):
        assert (path.parent / target).resolve().exists(), f"{path.relative_to(ROOT)}: {target}"


@pytest.mark.parametrize("name", SKILLS)
def test_the_entry_point_names_the_canonical_skill_and_holds_no_rules(name):
    entry = _entry(name)
    assert (entry.parent / f"../../../.claude/skills/{name}/SKILL.md").resolve() in {
        (entry.parent / t).resolve() for t in _relative_targets(entry)
    }
    assert len(entry.read_text(encoding="utf-8").split()) < 120, "entry points only point"


@pytest.mark.parametrize("name", ["wiki-review", "ai-review"])
def test_a_review_skill_is_read_only_until_its_one_pr(name):
    text = _canonical(name).read_text(encoding="utf-8")
    assert "restricted" in text, "must say it names restricted-tree edits"
    assert "agentctl" in text


def test_wiki_review_keeps_the_decision_and_deletion_rules():
    text = _canonical("wiki-review").read_text(encoding="utf-8")
    assert re.search(r"never rewrite a `?decision", text, re.IGNORECASE)
    assert re.search(r"never delete a fact", text, re.IGNORECASE)
    assert "0 errors" in text


def test_wiki_review_reuses_wiki_update_by_reference():
    text = _canonical("wiki-review").read_text(encoding="utf-8")
    assert "wiki-update/SKILL.md" in text
    assert "<!-- wiki-update:rules" not in text, "reference the rules; never restate them"


def test_ai_review_covers_its_sources():
    text = _canonical("ai-review").read_text(encoding="utf-8")
    for needle in ("agentctl status", "HAND_RUNNING", "handoff-live-proof.md", "agentctl metrics report", "Scorecard", "Dependabot"):
        assert needle in text, needle
