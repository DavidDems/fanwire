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


PARKED = (
    "04-cheap-automations.md",
    "12-agent-evals.md",
    "13-worker-shell.md",
    "14-learning-loop.md",
    "15-context-graph.md",
)


@pytest.mark.parametrize("name", PARKED)
def test_parked_brief_says_so_and_links_adr_0035(name):
    # ADR 0035 parks the briefs that need metered API runs; the brief itself
    # must say so, so a new session does not start them unasked.
    text = (GENERAL / "Prompts" / name).read_text(encoding="utf-8")
    lines = [ln for ln in text.splitlines() if ln.startswith("*Update, 2026-11-24")]
    assert lines or "*Update, 2026-11-24" in text, f"{name} has no 2026-11-24 Update"
    assert "parked" in text.lower().split("**brief for")[0]
    assert "../Decisions/0035-outstanding-work-answers.md" in text
