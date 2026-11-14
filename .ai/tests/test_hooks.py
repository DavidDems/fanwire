"""Structural checks on the git hooks.

Plain text, like `test_workflows.py`, and for the same reason: the hooks are
shell, `.ai/` is stdlib-only, and the properties worth pinning are the ones a
reader would otherwise have to re-derive from the script each time.

These do not prove a hook *runs* correctly — nothing here executes git. They
pin the decisions that were made deliberately and would be easy to undo by
accident.
"""

from pathlib import Path

import pytest

HOOKS = Path(__file__).resolve().parents[1] / "hooks"
PRE_PUSH = HOOKS / "pre-push"
PRE_COMMIT = HOOKS / "pre-commit"


@pytest.fixture
def pre_push() -> str:
    if not PRE_PUSH.exists():
        pytest.skip("pre-push not present")
    return PRE_PUSH.read_text(encoding="utf-8")


class TestPrePushCatchesLeakedAgentState:
    """A human branch created while HEAD was on an agent branch carried two
    `[agent-state]` commits and a mid-flight `state.json` onto `main` in #35.
    The next run of that task would have read "a test agent is already
    running" from `main` and stalled."""

    def test_it_looks_for_agent_state_commits(self, pre_push):
        assert "[agent-state]" in pre_push

    def test_agent_branches_are_exempt(self, pre_push):
        # They are where those commits are legitimately made. A hook that
        # refused them would block the system's own workflow.
        assert "agent/*)" in pre_push

    def test_the_range_is_measured_against_main_not_the_remote_branch(self, pre_push):
        # The question is what reaches `main` on merge, not what is new on this
        # branch — a second push of an already-poisoned branch must still fail.
        assert "origin/main" in pre_push

    def test_a_branch_deletion_is_not_inspected(self, pre_push):
        # A delete sends the all-zero sha; `git log` against it is an error,
        # and refusing a deletion would be absurd.
        assert "zero=" in pre_push

    def test_it_tells_you_how_to_recover(self, pre_push):
        # A refusal with no way forward gets solved with --no-verify, which
        # defeats the hook permanently rather than once.
        assert "git switch -c" in pre_push


class TestHooksStayAdvisory:
    """`.ai/docs/permissions.md` and hooks/README.md both state that no part of
    the permission model depends on a hook. If one ever starts claiming to be a
    control, that claim has to be made deliberately."""

    @pytest.mark.parametrize("path", [PRE_PUSH, PRE_COMMIT])
    def test_the_hook_says_it_is_not_a_control(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        text = path.read_text(encoding="utf-8").lower()
        assert "no-verify" in text or "convenience" in text, (
            f"{path.name} should say plainly that it can be skipped and is not a control"
        )
