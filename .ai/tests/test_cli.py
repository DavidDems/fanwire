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
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
AGENTCTL = REPO_ROOT / ".ai" / "bin" / "agentctl.py"

# A task that has a committed spec and, on a fresh clone, no state file.
SPEC_ONLY_TASK = "DEMO-001"


def clean_env(**extra: str) -> dict[str, str]:
    """os.environ without GIT_*: under a git hook those aim every `git` a test
    starts at the repository being committed to (see conftest.py)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(extra)
    return env


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(AGENTCTL), *args],
        cwd=REPO_ROOT,
        env=clean_env(),
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


class TestGuardTested:
    """handoff.md §10, D1: `guard tested` decides whether a CI verdict for
    `--sha` may be applied to the task branch now checked out."""

    def test_the_checked_out_commit_is_tested(self, has_demo_task):
        result = run("guard", "tested", SPEC_ONLY_TASK, "--sha", "HEAD")
        assert result.returncode == 0, result.stderr

    def test_a_commit_that_is_not_an_ancestor_is_refused(self, has_demo_task):
        # A verdict for code that is not in this branch's history at all.
        result = run("guard", "tested", SPEC_ONLY_TASK, "--sha", "0" * 40)
        assert result.returncode != 0
        assert "not" in result.stderr.lower()

    def test_a_crafted_task_id_is_refused(self):
        result = run("guard", "tested", "../DEMO-001", "--sha", "HEAD")
        assert result.returncode != 0

    def test_a_trailing_newline_is_not_a_task_id(self, has_demo_task):
        # handoff.md §10, D2b: `re.match` with `$` accepted "DEMO-001\n".
        result = run("guard", "tested", SPEC_ONLY_TASK + "\n", "--sha", "HEAD")
        assert result.returncode != 0


# --------------------------------------------------------------------------- D2b

DATA_TASK = "DROOT-001"
INVOKE = REPO_ROOT / ".ai" / "bin" / "invoke_agent.sh"


def run_in(data_root: Path, *args: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    """agentctl from this checkout (the "tools"), against another tree's data."""
    return subprocess.run(
        [sys.executable, str(AGENTCTL), *args],
        cwd=cwd or REPO_ROOT,
        env=clean_env(AGENTCTL_DATA_ROOT=str(data_root)),
        capture_output=True,
        text=True,
        check=False,
    )


def _posix_bash() -> str | None:
    """Git Bash or a real bash; not WSL's launcher, which sees another filesystem."""
    path = shutil.which("bash")
    if path is None:
        return None
    lowered = path.lower()
    if sys.platform == "win32" and ("system32" in lowered or "windowsapps" in lowered):
        return None
    return path


@pytest.fixture
def data_root(tmp_path, has_demo_task) -> Path:
    """A task checkout: a spec, its brief and its context, and nothing else."""
    root = tmp_path / "task"
    task = root / ".ai" / "tasks" / DATA_TASK
    task.mkdir(parents=True)
    spec = json.loads(
        (REPO_ROOT / ".ai" / "tasks" / SPEC_ONLY_TASK / "task.json").read_text(encoding="utf-8")
    )
    spec["task_id"] = DATA_TASK
    spec["allowed_paths"] = [*spec["allowed_paths"], "backend/tests/test_x.py"]
    (task / "task.json").write_text(json.dumps(spec), encoding="utf-8")
    (task / "brief.md").write_text(f"# {DATA_TASK}\n", encoding="utf-8")
    for ref in spec["required_context"]:
        (root / ref).parent.mkdir(parents=True, exist_ok=True)
        (root / ref).write_text("context from the data root\n", encoding="utf-8")
    return root


class TestTheDataRootIsSeparateFromTheCode:
    """handoff.md §10, D2b. The workflows run agentctl from a checkout of
    `main` (the tools) against the task branch's checkout (the data), so that
    nothing the model can write is ever executed. `AGENTCTL_DATA_ROOT` names
    the data: task specs, state, telemetry and where git runs. Code, config,
    policy, prompts and skills always come from where agentctl.py lives.
    Unset, everything is this checkout, as before."""

    def test_specs_come_from_the_data_root(self, data_root):
        assert run_in(data_root, "task", "validate", DATA_TASK).returncode == 0
        assert run("task", "validate", DATA_TASK).returncode != 0

    def test_state_is_written_under_the_data_root(self, data_root):
        result = run_in(data_root, "state", "init", DATA_TASK)
        assert result.returncode == 0, result.stderr
        assert (data_root / ".ai" / "tasks" / DATA_TASK / "state.json").exists()
        assert not (REPO_ROOT / ".ai" / "tasks" / DATA_TASK).exists()

    def test_telemetry_is_written_under_the_data_root(self, data_root, tmp_path):
        agent_result = tmp_path / "agent-result.json"
        agent_result.write_text(
            json.dumps({"provider": "anthropic", "model": "m", "usage": {}}), encoding="utf-8"
        )
        result = run_in(
            data_root,
            *("telemetry-from-run", "--task", DATA_TASK, "--role", "code_agent"),
            *("--started", "2026-10-08T00:00:00Z", "--workflow-run-id", "1"),
            *("--agent-result", str(agent_result), "--result", "success"),
        )
        leaked = REPO_ROOT / ".ai" / "telemetry" / "runs" / DATA_TASK
        try:
            assert result.returncode == 0, result.stderr
            assert list((data_root / ".ai" / "telemetry" / "runs" / DATA_TASK).glob("*.json"))
            assert not leaked.exists()
        finally:
            # This module must never leave anything in the real tree.
            shutil.rmtree(leaked, ignore_errors=True)

    def test_policy_and_code_come_from_the_tools_copy(self, data_root, tmp_path):
        # A data root that grants everything and replaces agentlib. Neither
        # may take effect, wherever agentctl is run from.
        ai = data_root / ".ai"
        (ai / "policy.json").write_text(
            json.dumps({"roles": {"code_agent": {"ci_dispatched": True, "write": ["**"]}}}),
            encoding="utf-8",
        )
        (ai / "agentlib").mkdir()
        (ai / "agentlib" / "__init__.py").write_text("raise SystemExit(97)\n", encoding="utf-8")
        (data_root / "json.py").write_text("raise SystemExit(98)\n", encoding="utf-8")
        diff = tmp_path / "changed.txt"
        diff.write_text("backend/tests/test_x.py\n", encoding="utf-8")
        for cwd in (REPO_ROOT, data_root):
            result = run_in(
                data_root,
                *("guard", "check", DATA_TASK, "--role", "code_agent"),
                *("--diff-file", str(diff)),
                cwd=cwd,
            )
            # The real policy denies the code agent its tests; the planted one
            # would have allowed them.
            assert result.returncode == 1, (cwd, result.returncode, result.stderr)
            assert "role_denied" in result.stderr

    def test_git_runs_in_the_data_root(self, data_root):
        if shutil.which("git") is None:
            pytest.skip("git not available")

        def git(*args: str) -> str:
            return subprocess.run(
                ["git", *args],
                cwd=data_root,
                env=clean_env(),
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()

        git("init", "-q")
        git("config", "user.email", "t@example.com")
        git("config", "user.name", "t")
        git("add", "-A")
        git("commit", "-q", "-m", "data")
        sha = git("rev-parse", "HEAD")
        assert run_in(data_root, "guard", "tested", DATA_TASK, "--sha", sha).returncode == 0
        assert run("guard", "tested", SPEC_ONLY_TASK, "--sha", sha).returncode != 0

    def test_context_comes_from_the_data_and_skills_from_the_tools(self, data_root):
        assert run_in(data_root, "state", "init", DATA_TASK).returncode == 0
        result = run_in(data_root, "context", DATA_TASK)
        assert result.returncode == 0, result.stderr
        ctx = json.loads(result.stdout)
        assert ctx["context_files"]
        for f in ctx["context_files"]:
            assert Path(f).resolve().is_relative_to(data_root.resolve()), f
        for f in ctx["skill_files"]:
            assert Path(f).resolve().is_relative_to((REPO_ROOT / ".ai" / "skills").resolve()), f

    def test_a_data_root_that_is_not_a_directory_fails_fast(self, tmp_path):
        result = run_in(tmp_path / "missing", "status")
        assert result.returncode == 2
        assert "AGENTCTL_DATA_ROOT" in result.stderr


FAKE_CLAUDE = """#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "fake 0"; exit 0; fi
{
  if [ -f ./data-root-marker ]; then echo "cwd=data-root"; else echo "cwd=elsewhere"; fi
  prev=""
  for a in "$@"; do
    if [ "$prev" = "--add-dir" ]; then
      if [ -f "$a/data-root-marker" ]; then echo "add-dir=data-root"; else echo "add-dir=elsewhere"; fi
    fi
    if [ "$prev" = "--model" ]; then echo "model=$a"; fi
    if [ "$prev" = "--setting-sources" ]; then echo "setting-sources=$a"; fi
    if [ "$a" = "--strict-mcp-config" ]; then echo "strict-mcp-config"; fi
    prev="$a"
  done
} > "$FAKE_LOG"
cat > /dev/null
echo '{"result": "done", "usage": {"input_tokens": 1, "output_tokens": 2}, "session_id": "s-1"}'
"""


class TestInvokeAgentRunsTheModelInTheDataRoot:
    """handoff.md §10, D2b. invoke_agent.sh runs from the tools copy, so its
    provider config is `main`'s; the model it starts works in, and is given,
    the task checkout named by `AGENTCTL_DATA_ROOT`."""

    def test_the_model_works_in_the_data_root_with_the_tools_config(self, tmp_path):
        bash = _posix_bash()
        if bash is None:
            pytest.skip("no POSIX bash on this machine")
        root = tmp_path / "task"
        (root / ".ai").mkdir(parents=True)
        (root / "data-root-marker").write_text("x", encoding="utf-8")
        (root / ".ai" / "config.json").write_text(
            json.dumps({"roles": {"test_agent": {"provider": "anthropic", "model": "evil-model"}}}),
            encoding="utf-8",
        )
        bindir = tmp_path / "bin"
        bindir.mkdir()
        (bindir / "claude").write_bytes(FAKE_CLAUDE.encode("utf-8"))
        (bindir / "claude").chmod(0o755)
        prompt = tmp_path / "prompt.md"
        prompt.write_text("hello", encoding="utf-8")
        log = tmp_path / "claude.log"
        out = tmp_path / "agent-result.json"
        proc = subprocess.run(
            [bash, INVOKE.as_posix(), "test_agent", prompt.as_posix(), out.as_posix()],
            cwd=tmp_path,
            env=clean_env(
                AGENTCTL_DATA_ROOT=root.as_posix(),
                PATH=str(bindir) + os.pathsep + os.environ.get("PATH", ""),
                FAKE_LOG=log.as_posix(),
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        seen = log.read_text(encoding="utf-8").split()
        tools_model = json.loads((REPO_ROOT / ".ai" / "config.json").read_text(encoding="utf-8"))[
            "roles"
        ]["test_agent"]["model"]
        assert "cwd=data-root" in seen
        assert "add-dir=data-root" in seen
        assert f"model={tools_model}" in seen
        assert json.loads(out.read_text(encoding="utf-8"))["session_id"] == "s-1"
        # The CLI must not load the checkout's own settings (hooks run
        # commands) or MCP servers (processes), whatever the branch carries.
        # Both flags confirmed in `claude --help`, CLI 2.1.293.
        assert "setting-sources=user" in seen
        assert "strict-mcp-config" in seen
