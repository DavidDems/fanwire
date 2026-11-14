"""Finished threads must not remain runnable session briefs.

The Timeline keeps when they finished; Git history keeps the old instructions.
These regressions cover the two completed threads retired together, without
pinning their replacement prose or unrelated unfinished work.
"""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
GENERAL = ROOT / "wiki/GeneralContext"
RETIRED = (
    "20-stats-navigation-and-compose-modal.md",
    "21-visual-refresh-specs.md",
)


@pytest.mark.parametrize("name", RETIRED)
def test_finished_thread_has_no_runnable_prompt(name):
    assert not (GENERAL / "Prompts" / name).exists(), (
        f"Finished thread {name} still offers obsolete instructions to a new session"
    )


@pytest.mark.parametrize("name", RETIRED)
def test_finished_thread_is_not_listed_in_the_index(name):
    # CUT-03 (the human, 2026-11-11): the index lists only live prompts; the
    # Timeline volumes record when a thread finished, and git keeps its text.
    index = (GENERAL / "index.md").read_text(encoding="utf-8")
    assert f"`{name}`" not in index, f"index.md still lists finished thread {name}"
    assert "A finished prompt is deleted" in index
