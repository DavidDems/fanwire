"""The real `.ai/skills/`, read as what a dispatched worker can act on.

A worker has file tools and nothing else: `invoke_agent.sh` runs the CLI with
`--permission-mode acceptEdits` in `--print` mode, where nothing can approve a
shell command, and `agent-worker.yml` moves `.git` out of its tree before the
model starts. CI runs the suites, the linters and the type-checkers, and the
workflow commits. A skill that tells a worker to run `npm`, `docker`, `pytest`
or `git` asks for something it cannot do, and teaches it to believe a check
ran that did not (handoff.md §10, D7: `frontend-unit` did exactly that).

These tests read the shipped files, the way `test_policy.py` reads the shipped
policy. Saying what CI runs, or naming a command a worker must never use, is
fine; a shell block, or "run `<command>`", is not.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"
SKILL_FILES = sorted(SKILLS_DIR.glob("*/SKILL.md"))

# A command a worker would need a shell for.
_COMMAND = r"(?:\$env:\S+\s+)?(?:cd|npm|npx|docker|python|pytest|git|ruff|mypy|prettier|eslint|tsc|cdk|\.venv)\b"
_SHELL_LINE = re.compile(rf"^\s*(?:[$>]\s*)?{_COMMAND}")
_FENCE = re.compile(r"^```(\S*)\s*$")
_SHELL_LANGS = {"", "sh", "bash", "shell", "console", "powershell", "ps1", "pwsh"}
_RUN_IT = re.compile(rf"\b(?:run|runs|use|execute|try)\s+`{_COMMAND}", re.IGNORECASE)
_NEGATION = re.compile(r"\b(?:never|not|cannot|can't|don't|do not|no)\b[^.`]*$", re.IGNORECASE)


def _shell_lines(text: str) -> list[str]:
    found: list[str] = []
    lang: str | None = None
    for line in text.splitlines():
        fence = _FENCE.match(line.strip())
        if fence:
            lang = None if lang is not None else fence.group(1).lower()
            continue
        if lang in _SHELL_LANGS and _SHELL_LINE.match(line):
            found.append(line.strip())
    return found


def _run_instructions(text: str) -> list[str]:
    found = []
    for m in _RUN_IT.finditer(text):
        before = text[max(0, m.start() - 60) : m.start()]
        if not _NEGATION.search(before):
            found.append(text[m.start() : m.end() + 30].splitlines()[0])
    return found


def test_the_skills_directory_is_found():
    assert SKILL_FILES, f"no SKILL.md under {SKILLS_DIR}"


@pytest.mark.parametrize("path", SKILL_FILES, ids=lambda p: p.parent.name)
def test_a_skills_name_is_its_directory(path):
    head = path.read_text(encoding="utf-8").split("---", 2)
    assert len(head) == 3 and head[0] == "", f"{path} has no frontmatter"
    assert re.search(rf"^name: {re.escape(path.parent.name)}$", head[1], re.MULTILINE)
    assert re.search(r"^description: \S", head[1], re.MULTILINE)


@pytest.mark.parametrize("path", SKILL_FILES, ids=lambda p: p.parent.name)
def test_no_skill_hands_a_worker_a_shell_command(path):
    assert _shell_lines(path.read_text(encoding="utf-8")) == []


@pytest.mark.parametrize("path", SKILL_FILES, ids=lambda p: p.parent.name)
def test_no_skill_tells_a_worker_to_run_a_command(path):
    assert _run_instructions(path.read_text(encoding="utf-8")) == []


class TestTheDetectorsThemselves:
    """Each check is proven able to fail, so a green run means something."""

    def test_a_shell_block_is_found(self):
        assert _shell_lines("x\n```\ncd frontend && npm test\n```\n") == ["cd frontend && npm test"]
        assert _shell_lines("```powershell\n$env:X=1; npx jest\n```") != []

    def test_a_layout_or_json_block_is_not_a_shell_block(self):
        assert _shell_lines("```\nfrontend/src/\n├── api/\n```") == []
        assert _shell_lines('```json\n"required_skills": ["git-workflow"]\n```') == []

    def test_an_instruction_to_run_is_found(self):
        assert _run_instructions("After that, run `docker compose down`.") != []
        assert _run_instructions("Run `$env:IAM_GATE_REPORT=1; npx jest t.ts` to see") != []

    def test_a_prohibition_is_not_an_instruction(self):
        assert _run_instructions("Never run `cdk deploy`.") == []
        assert _run_instructions("You cannot run `npm test` here.") == []
