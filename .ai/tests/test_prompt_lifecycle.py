"""Finished threads must not remain runnable session briefs.

The index keeps their completion record; Git history keeps the old instructions.
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
def test_finished_thread_index_entry_records_results_instead_of_live_work(name):
    entries = [
        line
        for line in (GENERAL / "index.md").read_text(encoding="utf-8").splitlines()
        if f"`{name}`" in line
    ]
    assert len(entries) == 1, f"Expected one completion record for {name}"
    entry = entries[0]
    assert entry.startswith("- **Deleted "), entry
    assert "Results:" in entry and "CodeContext/Modules/" in entry, entry
