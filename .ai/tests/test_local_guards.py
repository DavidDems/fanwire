"""Local guards: workspace install check, `git stash` refusal, compose port
pre-flight (backlog item 20).

The hook is exercised the way Claude Code runs it: JSON on stdin, exit code 2
plus a stderr reason to refuse. Every subprocess gets an environment with all
`GIT_*` variables removed.
"""

import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

AI = Path(__file__).resolve().parents[1]
HOOK = AI / "hooks" / "claude_pretool.py"
AGENTCTL = AI / "bin" / "agentctl.py"
REPO = AI.parent


def clean_env(**extra) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(extra)
    return env


def run_hook(command, cwd=None, tool="Bash", env=None, raw=None):
    payload = {"tool_name": tool, "tool_input": {"command": command}}
    if cwd is not None:
        payload["cwd"] = str(cwd)
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=raw if raw is not None else json.dumps(payload),
        capture_output=True,
        text=True,
        env=env or clean_env(),
        timeout=30,
    )


@pytest.fixture
def busy_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    yield s.getsockname()[1]
    s.close()


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def guards():
    if str(AI) not in sys.path:
        sys.path.insert(0, str(AI))
    from agentlib import localguards

    return localguards


COMPOSE = """\
services:
  db:
    image: postgres
    ports:
      - "${TEST_DB_PORT:-5432}:5432"
  svc:
    image: x
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${TEST_SVC_PORT:-8001}:8001"
  lone:
    image: y
"""


@pytest.fixture
def compose_dir(tmp_path):
    (tmp_path / "docker-compose.yml").write_text(COMPOSE, encoding="utf-8")
    return tmp_path


# --- (b) git stash refusal -----------------------------------------------------


@pytest.mark.parametrize(
    "command",
    [
        "git stash",
        "git stash pop",
        "git stash push -m x",
        "git -C ../other stash",
        "git -c user.name=x stash list",
        "git --git-dir=.git stash drop",
        "cd x && git stash",
        "git status; git stash pop",
        "git status || git stash",
        "git log | head && git stash apply",
        "FOO=1 git stash",
        "/usr/bin/git stash",
        "git.exe stash",
        'bash -c "git stash"',
        "sh -c 'git add . && git stash'",
        "echo $(git stash)",
        "echo `git stash`",
        'git commit -m "$(git stash)"',
        "sudo git stash",
        "true\ngit stash",
    ],
)
def test_stash_is_refused(command):
    r = run_hook(command)
    assert r.returncode == 2, command
    assert "git stash" in r.stderr
    assert "worktree" in r.stderr


@pytest.mark.parametrize(
    "command",
    [
        "git status",
        "git commit -m 'never use git stash here'",
        'git commit -m "git stash is shared across worktrees"',
        "git log --grep=stash",
        "git branch stash-fix",
        "echo stash",
        "git checkout -b stash",
        'git commit -m "$(cat <<\'EOF\'\nfix\n\ngit stash is banned\nEOF\n)"',
        "ls",
    ],
)
def test_other_commands_pass(command):
    r = run_hook(command)
    assert r.returncode == 0, (command, r.stderr)


def test_non_bash_tools_pass():
    assert run_hook("git stash", tool="Read").returncode == 0


def test_unparseable_input_fails_closed_for_the_stash_guard():
    r = run_hook(None, raw="not json")
    assert r.returncode == 2


# --- (c) port pre-flight ------------------------------------------------------


def test_preflight_detects_a_bound_port(guards, compose_dir, busy_port):
    env = {"TEST_DB_PORT": str(busy_port), "TEST_SVC_PORT": str(free_port())}
    found = guards.port_collisions(compose_dir / "docker-compose.yml", env=env)
    assert [(c.service, c.port, c.env_var) for c in found] == [("db", busy_port, "TEST_DB_PORT")]


def test_preflight_resolves_defaults_and_env_overrides(guards, compose_dir):
    ports = guards.published_ports(compose_dir / "docker-compose.yml", env={"TEST_SVC_PORT": "9123"})
    assert {(p.service, p.port, p.env_var) for p in ports} == {
        ("db", 5432, "TEST_DB_PORT"),
        ("svc", 9123, "TEST_SVC_PORT"),
    }


def test_the_real_compose_file_publishes_the_documented_defaults(guards):
    ports = {
        (p.service, p.env_var): p.port for p in guards.published_ports(REPO / "docker-compose.yml", env={})
    }
    assert ports[("postgres", "POSTGRES_HOST_PORT")] == 5432
    assert ports[("backend-dev", "BACKEND_DEV_PORT")] == 8001
    assert ports[("backend-perf", "BACKEND_PERF_PORT")] == 8002


def test_cli_preflight_fails_naming_port_var_and_rule(compose_dir, busy_port):
    r = subprocess.run(
        [
            sys.executable,
            str(AGENTCTL),
            "preflight",
            "ports",
            "--compose-file",
            str(compose_dir / "docker-compose.yml"),
        ],
        capture_output=True,
        text=True,
        env=clean_env(TEST_DB_PORT=str(busy_port), TEST_SVC_PORT=str(free_port())),
    )
    assert r.returncode == 1
    assert str(busy_port) in r.stderr
    assert "TEST_DB_PORT" in r.stderr
    assert "only" in r.stderr and "you started" in r.stderr


def test_cli_preflight_passes_when_free(compose_dir):
    r = subprocess.run(
        [
            sys.executable,
            str(AGENTCTL),
            "preflight",
            "ports",
            "--compose-file",
            str(compose_dir / "docker-compose.yml"),
        ],
        capture_output=True,
        text=True,
        env=clean_env(TEST_DB_PORT=str(free_port()), TEST_SVC_PORT=str(free_port())),
    )
    assert r.returncode == 0, r.stderr


def test_hook_refuses_compose_run_on_a_collision(compose_dir, busy_port):
    # `svc` publishes nothing on `run` without --service-ports, but its
    # dependency `db` does, and compose starts dependencies.
    env = clean_env(TEST_DB_PORT=str(busy_port), TEST_SVC_PORT=str(free_port()))
    r = run_hook("docker compose run --rm svc pytest", cwd=compose_dir, env=env)
    assert r.returncode == 2
    assert "TEST_DB_PORT" in r.stderr and str(busy_port) in r.stderr


def test_hook_also_reads_a_command_prefix_override(compose_dir, busy_port):
    env = clean_env(TEST_DB_PORT=str(busy_port))
    cmd = f"TEST_DB_PORT={free_port()} docker compose run --rm svc pytest"
    assert run_hook(cmd, cwd=compose_dir, env=env).returncode == 0


def test_hook_allows_compose_run_when_free(compose_dir):
    env = clean_env(TEST_DB_PORT=str(free_port()), TEST_SVC_PORT=str(free_port()))
    assert run_hook("docker-compose run --rm svc", cwd=compose_dir, env=env).returncode == 0


def test_hook_only_checks_the_services_run_would_start(compose_dir, busy_port):
    env = clean_env(TEST_DB_PORT=str(busy_port))
    assert run_hook("docker compose run --rm lone", cwd=compose_dir, env=env).returncode == 0
    assert run_hook("docker compose run --rm --no-deps svc", cwd=compose_dir, env=env).returncode == 0
    r = run_hook("docker compose run --rm --service-ports svc", cwd=compose_dir, env=env)
    assert r.returncode == 2


def test_hook_ignores_other_compose_subcommands(compose_dir, busy_port):
    env = clean_env(TEST_DB_PORT=str(busy_port))
    assert run_hook("docker compose ps", cwd=compose_dir, env=env).returncode == 0
    assert run_hook("docker compose config", cwd=compose_dir, env=env).returncode == 0


def test_hook_honours_the_compose_file_flag(tmp_path, busy_port):
    other = tmp_path / "alt.yml"
    other.write_text(COMPOSE, encoding="utf-8")
    env = clean_env(TEST_DB_PORT=str(busy_port))
    r = run_hook(f"docker compose -f {other.as_posix()} run --rm svc", cwd=tmp_path, env=env)
    assert r.returncode == 2


def test_preflight_fails_open_on_its_own_errors(tmp_path):
    # No compose file, and a compose file that is garbage: never block.
    assert run_hook("docker compose run --rm svc", cwd=tmp_path).returncode == 0
    (tmp_path / "docker-compose.yml").write_text("\x01 not: [yaml", encoding="utf-8")
    assert run_hook("docker compose run --rm svc", cwd=tmp_path).returncode == 0


# --- (a) selfcheck workspaces --------------------------------------------------


def selfcheck(root, *flags, **env):
    e = clean_env(AGENTCTL_DATA_ROOT=str(root), **env)
    if "CI" not in env:
        e.pop("CI", None)
    return subprocess.run(
        [sys.executable, str(AGENTCTL), "selfcheck", *flags],
        capture_output=True,
        text=True,
        env=e,
    )


@pytest.fixture
def tree(tmp_path):
    for ws in ("frontend", "infra"):
        (tmp_path / ws).mkdir()
        (tmp_path / ws / "package.json").write_text("{}", encoding="utf-8")
    (tmp_path / "docs").mkdir()  # no package.json: not a workspace
    return tmp_path


def test_plain_selfcheck_does_not_need_node_modules(tree):
    r = selfcheck(tree)
    assert r.returncode == 0, r.stderr


def test_workspaces_flag_names_each_missing_install_and_the_fix(tree):
    r = selfcheck(tree, "--workspaces")
    assert r.returncode == 1
    for ws in ("frontend", "infra"):
        assert f"{ws}: node_modules is missing" in r.stderr
    assert "npm ci" in r.stderr
    assert "docs" not in r.stderr


def test_workspaces_flag_passes_once_installed(tree):
    for ws in ("frontend", "infra"):
        (tree / ws / "node_modules" / ".bin").mkdir(parents=True)
    r = selfcheck(tree, "--workspaces")
    assert r.returncode == 0, r.stderr


def test_an_empty_node_modules_counts_as_missing(tree):
    for ws in ("frontend", "infra"):
        (tree / ws / "node_modules").mkdir()
    assert selfcheck(tree, "--workspaces").returncode == 1


def test_workspaces_check_is_skipped_in_ci_even_when_asked(tree):
    r = selfcheck(tree, "--workspaces", CI="true")
    assert r.returncode == 0, r.stderr
