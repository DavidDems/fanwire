"""Path-permission enforcement — the technical backing for the agent rules.

This is the security boundary: whatever a worker was persuaded to do, the guard
decides whether its diff is allowed to land. See `.ai/docs/threat-model.md`.
"""

import pytest

from agentlib import guard


class TestPathMatches:
    @pytest.mark.parametrize(
        "path,pattern,expected",
        [
            ("backend/app/users/service.py", "backend/app/users/**", True),
            ("backend/app/users/service.py", "backend/app/**", True),
            ("backend/app/users/service.py", "backend/app/*.py", False),
            ("backend/app/main.py", "backend/app/*.py", True),
            ("backend/app/users/service.py", "backend/app/users/*.py", True),
            (".ai/config.json", ".ai/**", True),
            (".ai/config.json", ".ai/*", True),
            (".github/workflows/x.yml", ".github/**", True),
            ("wiki/CodeContext/Modules/0x01-users.md", "wiki/CodeContext/Modules/*.md", True),
            ("wiki/GeneralContext/index.md", "wiki/CodeContext/**", False),
            ("README.md", "*.md", True),
            ("docs/README.md", "*.md", False),
            ("backend/tests/users/test_service.py", "backend/tests/**", True),
        ],
    )
    def test_glob_semantics(self, path, pattern, expected):
        assert guard.path_matches(path, pattern) is expected

    def test_star_does_not_cross_separator(self):
        # The whole point: `backend/*` must not silently authorise
        # `backend/app/users/service.py`.
        assert guard.path_matches("backend/app", "backend/*") is True
        assert guard.path_matches("backend/app/users/service.py", "backend/*") is False

    def test_windows_separators_are_normalised(self):
        assert guard.path_matches("backend\\app\\main.py", "backend/app/**") is True


class TestAlwaysForbidden:
    def test_agent_infrastructure_is_always_forbidden(self):
        for path in (".ai/policy.json", ".ai/agentlib/guard.py", ".ai/telemetry/runs/x.json"):
            assert guard.is_always_forbidden(path), path

    def test_workflows_are_always_forbidden(self):
        assert guard.is_always_forbidden(".github/workflows/agent-orchestrator.yml")

    def test_general_context_is_always_forbidden(self):
        assert guard.is_always_forbidden("wiki/GeneralContext/index.md")

    def test_application_code_is_not_always_forbidden(self):
        assert not guard.is_always_forbidden("backend/app/users/service.py")
        assert not guard.is_always_forbidden("wiki/CodeContext/Modules/0x01-users.md")


class TestCheckDiff:
    policy = {
        "roles": {
            "test_agent": {
                "write": ["backend/tests/**", "frontend/src/**/*.test.tsx", "infra/test/**"],
                "deny": ["backend/app/**", "frontend/src/**/*.tsx", "infra/lib/**"],
            },
            "code_agent": {
                "write": ["backend/app/**", "frontend/src/**", "infra/lib/**"],
                "deny": ["backend/tests/**", "infra/test/**"],
            },
            "context_maintainer": {
                "write": ["wiki/CodeContext/Modules/*.md"],
                "deny": ["**"],
            },
        }
    }
    spec = {
        "task_id": "DEMO-001",
        "allowed_paths": ["backend/app/users/**", "backend/tests/users/**"],
        "forbidden_paths": ["backend/app/users/models.py"],
    }

    def test_test_agent_may_write_its_own_tests(self):
        result = guard.check_diff(
            ["backend/tests/users/test_service.py"], "test_agent", self.spec, self.policy
        )
        assert result.ok
        assert result.violations == []

    def test_test_agent_may_not_write_production_code(self):
        result = guard.check_diff(
            ["backend/app/users/service.py"], "test_agent", self.spec, self.policy
        )
        assert not result.ok
        assert result.violations[0].path == "backend/app/users/service.py"
        assert result.violations[0].reason == "role_denied"

    def test_code_agent_may_not_write_tests_by_default(self):
        result = guard.check_diff(
            ["backend/tests/users/test_service.py"], "code_agent", self.spec, self.policy
        )
        assert not result.ok
        assert result.violations[0].reason == "role_denied"

    def test_code_agent_may_write_tests_when_workflow_permits(self):
        result = guard.check_diff(
            ["backend/tests/users/test_service.py"],
            "code_agent",
            self.spec,
            self.policy,
            allow_test_edits=True,
        )
        assert result.ok

    def test_path_outside_task_scope_is_rejected_even_if_role_allows(self):
        # `backend/app/posts/` is inside code_agent's role grant but outside
        # this task's allowed_paths. Task scope narrows the role, never widens.
        result = guard.check_diff(
            ["backend/app/posts/service.py"], "code_agent", self.spec, self.policy
        )
        assert not result.ok
        assert result.violations[0].reason == "outside_task_scope"

    def test_task_forbidden_path_beats_task_allowed_path(self):
        result = guard.check_diff(
            ["backend/app/users/models.py"], "code_agent", self.spec, self.policy
        )
        assert not result.ok
        assert result.violations[0].reason == "task_forbidden"

    def test_always_forbidden_beats_everything(self):
        wide_open = {
            "task_id": "X-001",
            "allowed_paths": ["**"],
            "forbidden_paths": [],
        }
        wide_policy = {"roles": {"code_agent": {"write": ["**"], "deny": []}}}
        result = guard.check_diff([".ai/policy.json"], "code_agent", wide_open, wide_policy)
        assert not result.ok
        assert result.violations[0].reason == "always_forbidden"

    def test_unknown_role_fails_closed(self):
        result = guard.check_diff(["backend/app/x.py"], "nope", self.spec, self.policy)
        assert not result.ok
        assert result.violations[0].reason == "unknown_role"

    def test_empty_diff_is_allowed(self):
        assert guard.check_diff([], "code_agent", self.spec, self.policy).ok

    def test_all_violations_are_reported_not_just_the_first(self):
        result = guard.check_diff(
            [
                "backend/app/users/service.py",  # ok
                ".github/workflows/x.yml",  # always_forbidden
                "backend/app/posts/service.py",  # outside_task_scope
            ],
            "code_agent",
            self.spec,
            self.policy,
        )
        assert not result.ok
        assert len(result.violations) == 2


class TestOrchestratorBookkeeping:
    """agent-guard failed on the first real agent PR (run on agent/DEMO-001).

    Two design decisions collided. State and telemetry live on the task branch
    so the PR is self-documenting; `.ai/**` is always-forbidden so no agent can
    touch the system. The PR-level guard checks the whole branch diff, so the
    orchestrator's own bookkeeping commits tripped the boundary check — making
    agent-guard unpassable on every real agent PR, and it is a required check.

    The resolution is narrow: exactly the two bookkeeping paths, scoped to the
    task the branch belongs to. Everything else under `.ai/` stays forbidden.
    """

    def test_a_tasks_own_state_file_is_bookkeeping(self):
        assert guard.is_orchestrator_bookkeeping(".ai/tasks/DEMO-001/state.json", "DEMO-001")

    def test_a_tasks_own_telemetry_is_bookkeeping(self):
        assert guard.is_orchestrator_bookkeeping(
            ".ai/telemetry/runs/DEMO-001/123-code_agent-a1.json", "DEMO-001"
        )

    def test_another_tasks_state_is_not(self):
        # A task branch may not reach into a different task's records.
        assert not guard.is_orchestrator_bookkeeping(".ai/tasks/AUTH-017/state.json", "DEMO-001")
        assert not guard.is_orchestrator_bookkeeping(
            ".ai/telemetry/runs/AUTH-017/123-code_agent-a1.json", "DEMO-001"
        )

    def test_the_task_contract_itself_is_not_bookkeeping(self):
        # Rewriting your own allowed_paths mid-task is the whole thing the
        # permission model exists to prevent.
        assert not guard.is_orchestrator_bookkeeping(".ai/tasks/DEMO-001/task.json", "DEMO-001")
        assert not guard.is_orchestrator_bookkeeping(".ai/tasks/DEMO-001/brief.md", "DEMO-001")

    @pytest.mark.parametrize(
        "path",
        [
            ".ai/policy.json",
            ".ai/config.json",
            ".ai/agentlib/guard.py",
            ".ai/bin/agentctl.py",
            ".ai/prompts/code-agent.md",
            ".ai/skills/git-workflow/SKILL.md",
            ".github/workflows/agent-guard.yml",
            "wiki/GeneralContext/index.md",
            "AGENTS.md",
        ],
    )
    def test_nothing_else_is_ever_bookkeeping(self, path):
        assert not guard.is_orchestrator_bookkeeping(path, "DEMO-001")

    def test_a_traversal_dressed_as_bookkeeping_is_refused(self):
        assert not guard.is_orchestrator_bookkeeping(
            ".ai/tasks/DEMO-001/../../policy.json", "DEMO-001"
        )

    def test_it_stays_always_forbidden_for_the_per_role_guard(self):
        # The distinction is only for the PR-level check. A worker's own diff
        # must still never contain these.
        assert guard.is_always_forbidden(".ai/tasks/DEMO-001/state.json")
