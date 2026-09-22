"""End-to-end tests of the `agentctl` CLI, run the way CI runs it.

Why these exist: the first live orchestrator run failed at `agentctl next` on a
brand-new task, with a chicken-and-egg the unit tests could not catch. Every
unit test of `orchestrator.next_action` hands it a state *dict*, so they all
passed. The bug was in the CLI wrapper, which refused to run without a state
*file* — while the action it should have returned (`validate`) is precisely the
one that creates that file.

So: exercise the real entry point, against the real repository tree, as a
subprocess. Only read-only commands belong here — nothing in this module may
mutate `.ai/tasks/` or `.ai/telemetry/`.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
AGENTCTL = REPO_ROOT / ".ai" / "bin" / "agentctl.py"

# A task that has a committed spec and, on a fresh clone, no state file.
SPEC_ONLY_TASK = "DEMO-001"


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(AGENTCTL), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture(scope="module")
def has_demo_task() -> bool:
    if not (REPO_ROOT / ".ai" / "tasks" / SPEC_ONLY_TASK / "task.json").exists():
        pytest.skip(f"{SPEC_ONLY_TASK} spec not present")
    return True


class TestNextOnAFreshTask:
    """The regression. A task with a spec and no state file is a DRAFT."""

    def test_next_succeeds_before_any_state_file_exists(self, has_demo_task, tmp_path):
        # Only meaningful when state.json genuinely does not exist yet; once a
        # run has started, the task has moved on and the check is vacuous.
        if (REPO_ROOT / ".ai" / "tasks" / SPEC_ONLY_TASK / "state.json").exists():
            pytest.skip("task already has state; nothing to assert about a fresh one")
        result = run("next", SPEC_ONLY_TASK)
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)["kind"] == "validate"

    def test_next_never_dies_asking_for_the_thing_it_would_create(self, has_demo_task):
        result = run("next", SPEC_ONLY_TASK)
        assert "state init" not in result.stderr
        assert result.returncode == 0, result.stderr


class TestAdvanceAdvertisesIgnoreTerminal:
    """`agent-orchestrator.yml` passes `--ignore-terminal` on the CI-result
    step (run 35670385955). If the CLI does not accept it, argparse exits 2 and
    the job fails for a second, sillier reason than the one being fixed — so
    the flag's existence is pinned here, next to the workflow test that pins
    its use."""

    def test_the_flag_exists(self):
        result = run("state", "advance", "--help")
        assert result.returncode == 0, result.stderr
        assert "--ignore-terminal" in result.stdout


class TestStatus:
    def test_status_lists_a_task_that_has_a_spec_but_no_state(self, has_demo_task):
        # A spec-only task is invisible on the board if status keys off state
        # files alone, which is how DEMO-001 read as "no tasks" while it existed.
        result = run("status")
        assert result.returncode == 0, result.stderr
        assert SPEC_ONLY_TASK in result.stdout

    def test_status_exits_zero_with_no_tasks_at_all(self):
        assert run("status").returncode == 0


class TestValidate:
    def test_the_committed_demo_spec_validates(self, has_demo_task):
        result = run("task", "validate", SPEC_ONLY_TASK)
        assert result.returncode == 0, result.stdout + result.stderr

    def test_an_unknown_task_fails_cleanly(self):
        result = run("next", "NOPE-999")
        assert result.returncode != 0
        assert "NOPE-999" in result.stderr or "no task" in result.stderr.lower()

    def test_a_malformed_task_id_is_refused(self):
        result = run("next", "../../etc/passwd")
        assert result.returncode != 0


class TestSelfcheck:
    def test_selfcheck_passes_against_the_committed_tree(self):
        result = run("selfcheck")
        assert result.returncode == 0, result.stdout + result.stderr
