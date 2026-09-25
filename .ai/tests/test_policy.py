"""The *real* `.ai/policy.json`, exercised against the paths each role's job
actually requires.

`test_guard.py` covers the guard's decision logic with synthetic policies, which
is the right way to test an algorithm. But it means the shipped policy document
itself was never exercised: `check_diff` was proven correct, and the data it is
run against was proven by nothing.

That gap has already cost a live finding. `test_agent.deny` contained
`frontend/src/**/*.tsx`, and `deny` is evaluated *before* the `write`
allowlist — so the test agent was denied the `.tsx` test files that are its
entire output. Every FRONTEND-* task would have escalated on its first commit,
for a reason having nothing to do with the tests it wrote. The mirror-image
entry under `code_agent` was written correctly as `frontend/src/**/*.test.tsx`,
and that asymmetry is what identifies it as an oversight rather than intent.

So these tests are not a restatement of the JSON. Each row is a file some role
has to be able to produce in order to do its job at all, or must never be able
to produce. If a row here and the policy disagree, one of them is wrong and it
is worth finding out which before a live run does.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agentlib import guard

AI_ROOT = Path(__file__).resolve().parents[1]

# Maximally permissive, on purpose: a task spec NARROWS a role, so a restrictive
# one here would mask the policy layer that is under test.
ANY_TASK = {"allowed_paths": ["**"], "forbidden_paths": []}


@pytest.fixture(scope="module")
def policy() -> dict:
    return json.loads((AI_ROOT / "policy.json").read_text(encoding="utf-8"))


def writable(policy: dict, role: str, path: str) -> bool:
    return guard.check_diff([path], role, ANY_TASK, policy).ok


# --------------------------------------------------------------------------
# test_agent: its output is test files, in all three trees.
# --------------------------------------------------------------------------

TEST_AGENT_MUST_WRITE = [
    "backend/tests/test_users.py",
    "backend/tests/users/test_service.py",
    "infra/test/frontend-deployment.test.ts",
    "frontend/src/config.test.ts",
    "frontend/src/api/client.test.ts",
    # The .tsx cases are the regression. A component test is a .tsx file, and
    # component tests are most of what a frontend test agent writes.
    "frontend/src/App.test.tsx",
    "frontend/src/routes/routes.test.tsx",
    "frontend/src/test/render.test.tsx",
    "frontend/src/features/feed/FeedPage.test.tsx",
    "frontend/src/components/__tests__/Button.tsx",
]

TEST_AGENT_MUST_NOT_WRITE = [
    "frontend/src/App.tsx",
    "frontend/src/config.ts",
    "frontend/src/features/feed/FeedPage.tsx",
    "backend/app/users/service.py",
    "backend/alembic/versions/0001_init.py",
    "infra/lib/cdn-stack.ts",
    "wiki/CodeContext/Modules/0x08-frontend.md",
]


@pytest.mark.parametrize("path", TEST_AGENT_MUST_WRITE)
def test_the_test_agent_can_write_its_own_output(policy, path):
    assert writable(policy, "test_agent", path), (
        f"the test agent cannot write {path}, which is the kind of file it exists to "
        "produce. Check `deny` before `write`: deny is evaluated first and a pattern "
        "there silently overrides the allowlist."
    )


@pytest.mark.parametrize("path", TEST_AGENT_MUST_NOT_WRITE)
def test_the_test_agent_cannot_write_implementation(policy, path):
    assert not writable(policy, "test_agent", path)


# --------------------------------------------------------------------------
# code_agent: implementation, and the generated contract. Never tests.
# --------------------------------------------------------------------------

CODE_AGENT_MUST_WRITE = [
    "backend/app/users/service.py",
    "backend/alembic/versions/0001_init.py",
    "backend/scripts/export_openapi.py",
    "backend/openapi.json",
    "frontend/src/config.ts",
    "frontend/src/api/client.ts",
    "frontend/src/test/server.ts",
    "frontend/src/vite-env.d.ts",
    "frontend/src/features/feed/FeedPage.tsx",
    "infra/lib/app-stack.ts",
    "infra/bin/fanwire.ts",
]

CODE_AGENT_MUST_NOT_WRITE = [
    "backend/tests/test_users.py",
    "infra/test/iam-policy.test.ts",
    "frontend/src/App.test.tsx",
    "frontend/src/config.test.ts",
    "wiki/CodeContext/Modules/0x08-frontend.md",
    # Dependency and build changes are a Director call, never a retry-loop one.
    "backend/pyproject.toml",
    "frontend/package.json",
    "infra/package.json",
    "docker/backend.Dockerfile",
    "docker-compose.yml",
]


@pytest.mark.parametrize("path", CODE_AGENT_MUST_WRITE)
def test_the_code_agent_can_write_implementation(policy, path):
    assert writable(policy, "code_agent", path), (
        f"the code agent cannot write {path}, which it must produce to make the "
        "committed tests pass."
    )


@pytest.mark.parametrize("path", CODE_AGENT_MUST_NOT_WRITE)
def test_the_code_agent_cannot_write_tests_or_dependencies(policy, path):
    assert not writable(policy, "code_agent", path)


# --------------------------------------------------------------------------
# context_maintainer: exactly one kind of file.
# --------------------------------------------------------------------------


def test_the_context_maintainer_can_write_a_module_file(policy):
    assert writable(policy, "context_maintainer", "wiki/CodeContext/Modules/0x08-frontend.md")


@pytest.mark.parametrize(
    "path",
    [
        "wiki/CodeContext/Standards/design-principles.md",
        "wiki/CodeContext/Modules/nested/0x09-other.md",
        "backend/app/users/service.py",
        "frontend/src/App.tsx",
        "infra/lib/cdn-stack.ts",
    ],
)
def test_the_context_maintainer_can_write_nothing_else(policy, path):
    assert not writable(policy, "context_maintainer", path)


# --------------------------------------------------------------------------
# Roles that commit nothing, and the boundary no role may cross.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["manager", "distiller", "director"])
@pytest.mark.parametrize("path", ["backend/app/x.py", "frontend/src/App.tsx", "README.md"])
def test_the_advisory_roles_commit_nothing(policy, role, path):
    assert not writable(policy, role, path)


@pytest.mark.parametrize(
    "path",
    [
        ".ai/policy.json",
        ".ai/tasks/FRONTEND-001/task.json",
        ".github/workflows/test-agent.yml",
        "wiki/GeneralContext/index.md",
        "AGENTS.md",
        ".gitignore",
    ],
)
def test_no_role_may_cross_the_system_boundary(policy, path):
    for role in policy["roles"]:
        assert not writable(policy, role, path), f"{role} can write {path}"


def test_every_ci_dispatched_role_is_reachable_and_declared(policy):
    """A role the worker can be dispatched with must exist here with a decision
    recorded — `ci_dispatched` is what agent-worker.yml gates on."""
    dispatchable = {r for r, e in policy["roles"].items() if e.get("ci_dispatched")}
    assert dispatchable == {
        "manager",
        "test_agent",
        "code_agent",
        "distiller",
        "context_maintainer",
    }
    assert policy["roles"]["director"]["ci_dispatched"] is False
