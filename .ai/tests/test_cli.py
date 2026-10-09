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


# --------------------------------------------------------------------------- D3


def _write_state(data_root: Path, **over) -> Path:
    """Initialise DATA_TASK's state under `data_root`, then overwrite fields."""
    result = run_in(data_root, "state", "init", DATA_TASK)
    assert result.returncode == 0, result.stderr
    path = data_root / ".ai" / "tasks" / DATA_TASK / "state.json"
    s = json.loads(path.read_text(encoding="utf-8"))
    s.update(over)
    path.write_text(json.dumps(s, indent=2), encoding="utf-8")
    return path


def _row(stdout: str, task: str) -> str:
    rows = [ln for ln in stdout.splitlines() if ln.startswith(task)]
    assert len(rows) == 1, stdout
    return rows[0]


class TestStatusFlagsAStalledTask:
    """handoff.md §10, D3 (detection). A worker or CI run whose result never
    came back used to be indistinguishable on the board from one still
    running. `status` now says STALLED once the dispatch is older than that
    workflow can possibly run for."""

    def _dispatched(self, at: str) -> dict:
        return {
            "state": "CODE_AGENT_RUNNING",
            "attempt": 1,
            "history": [
                {
                    "at": at,
                    "from": "READY_FOR_IMPLEMENTATION",
                    "to": "CODE_AGENT_RUNNING",
                    "event": "DISPATCH_CODE_AGENT",
                    "note": "",
                }
            ],
            "last_dispatch": {
                "at": at,
                "event": "DISPATCH_CODE_AGENT",
                "workflow": "agent-worker",
                "role": "code_agent",
                "run_id": None,
            },
        }

    def test_an_overdue_dispatch_is_stalled(self, data_root):
        _write_state(data_root, **self._dispatched("2001-01-01T00:00:00Z"))
        result = run_in(data_root, "status")
        assert result.returncode == 0, result.stderr
        row = _row(result.stdout, DATA_TASK)
        assert "STALLED" in row and "agent-worker" in row

    def test_a_recent_dispatch_is_not(self, data_root):
        from datetime import UTC, datetime

        now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        _write_state(data_root, **self._dispatched(now))
        result = run_in(data_root, "status")
        assert result.returncode == 0, result.stderr
        assert "STALLED" not in _row(result.stdout, DATA_TASK)


class TestACiResultWhilePausedIsDiscardedVisibly:
    """handoff.md §10, D3 (S2). A CI result that arrives while a human has the
    task paused is not applied, and used to vanish: the orchestrator run
    failed and nothing recorded which run had been lost. Now it is discarded
    on purpose, with a notice naming the run, and the run id is kept."""

    ARGS = (
        *("--event", "CI_PASSED", "--ci-run-id", "4242", "--ci-conclusion", "success"),
        *("--commit-sha", "abc123", "--ignore-terminal"),
    )

    def test_the_result_is_discarded_with_a_notice(self, data_root):
        path = _write_state(data_root, state="IMPL_CI", control="PAUSE", attempt=1)
        result = run_in(data_root, "state", "advance", DATA_TASK, *self.ARGS, "--discard-if-paused")
        assert result.returncode == 0, result.stderr
        assert "::notice::" in result.stdout and "4242" in result.stdout
        s = json.loads(path.read_text(encoding="utf-8"))
        assert s["state"] == "IMPL_CI"
        assert s["last_ci_run"]["run_id"] == "4242"
        assert s["last_ci_run"]["applied"] is False

    def test_without_the_flag_a_paused_task_still_refuses(self, data_root):
        _write_state(data_root, state="IMPL_CI", control="PAUSE", attempt=1)
        result = run_in(data_root, "state", "advance", DATA_TASK, *self.ARGS)
        assert result.returncode == 1

    def test_an_applied_result_records_its_run(self, data_root):
        path = _write_state(data_root, state="IMPL_CI", attempt=1)
        result = run_in(data_root, "state", "advance", DATA_TASK, *self.ARGS, "--discard-if-paused")
        assert result.returncode == 0, result.stderr
        s = json.loads(path.read_text(encoding="utf-8"))
        assert s["state"] != "IMPL_CI"
        assert s["last_ci_run"]["run_id"] == "4242"
        assert s["last_ci_run"]["applied"] is True


class TestTheCiConclusionIsMappedInPython:
    """handoff.md §10, D3 (S1). The orchestrator asks agentlib which event a
    conclusion means instead of keeping a `case` of its own."""

    @pytest.mark.parametrize(
        "conclusion,event",
        [("success", "CI_PASSED"), ("timed_out", "CI_FAILED"), ("cancelled", "ESCALATE")],
    )
    def test_ci_event(self, conclusion, event):
        result = run("ci-event", "--conclusion", conclusion)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == event


class TestAWorkerDecisionCannotUnEscalate:
    """handoff.md §10, D3 (S9). MANAGER_RETRY and MANAGER_RESCOPE are now
    legal from ESCALATED, for a human. The manager worker applies its decision
    with `--from-state MANAGER_REVIEW`, so a manager that lands after the task
    was escalated cannot use that door."""

    def test_a_decision_from_the_wrong_state_is_refused(self, data_root):
        path = _write_state(data_root, state="ESCALATED", escalation_reason="human needed")
        result = run_in(
            data_root,
            *("state", "advance", DATA_TASK, "--event", "MANAGER_RETRY"),
            *("--from-state", "MANAGER_REVIEW"),
        )
        assert result.returncode == 1
        assert "MANAGER_REVIEW" in result.stderr
        assert json.loads(path.read_text(encoding="utf-8"))["state"] == "ESCALATED"

    def test_a_decision_from_review_applies(self, data_root):
        path = _write_state(data_root, state="MANAGER_REVIEW")
        result = run_in(
            data_root,
            *("state", "advance", DATA_TASK, "--event", "MANAGER_RESCOPE"),
            *("--from-state", "MANAGER_REVIEW"),
        )
        assert result.returncode == 0, result.stderr
        assert json.loads(path.read_text(encoding="utf-8"))["state"] == "READY"


class TestTheTestedShaIsTheTipAfterTheReorder:
    """handoff.md §10, D3 (the race) against D1's rule. The orchestrator now
    commits and pushes CI_STARTED *before* it dispatches CI, so the run tests
    the branch tip itself; bookkeeping after it (a human's PAUSE, say) is
    still allowed, code is not."""

    def _git(self, root: Path, *args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=root, env=clean_env(), capture_output=True, text=True, check=True
        ).stdout.strip()

    def test_ci_dispatched_after_the_bookkeeping_commit_tests_the_tip(self, data_root):
        if shutil.which("git") is None:
            pytest.skip("git not available")
        g = self._git
        g(data_root, "init", "-q")
        g(data_root, "config", "user.email", "t@example.com")
        g(data_root, "config", "user.name", "t")
        (data_root / "backend").mkdir()
        (data_root / "backend" / "x.py").write_text("x = 1\n", encoding="utf-8")
        g(data_root, "add", "-A")
        g(data_root, "commit", "-q", "-m", "work")
        # The orchestrator's CI_STARTED commit, pushed before CI is dispatched.
        state = _write_state(data_root, state="IMPL_CI", attempt=1)
        g(data_root, "add", "-A")
        g(data_root, "commit", "-q", "-m", "[agent-state] CI_STARTED")
        tested = g(data_root, "rev-parse", "HEAD")
        assert run_in(data_root, "guard", "tested", DATA_TASK, "--sha", tested).returncode == 0
        # More bookkeeping after the run started leaves the verdict valid.
        state.write_text(state.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        g(data_root, "commit", "-q", "-am", "[agent-state] control")
        assert run_in(data_root, "guard", "tested", DATA_TASK, "--sha", tested).returncode == 0
        # Code after it does not.
        (data_root / "backend" / "x.py").write_text("x = 2\n", encoding="utf-8")
        g(data_root, "commit", "-q", "-am", "late code")
        assert run_in(data_root, "guard", "tested", DATA_TASK, "--sha", tested).returncode == 1


# --------------------------------------------------------------------------- D6

ENVELOPE_FIXTURE = REPO_ROOT / ".ai" / "tests" / "fixtures" / "claude-cli-2.1.295-envelope.json"

# Prints a saved envelope as the CLI would, and exits as told.
ENVELOPE_CLAUDE = """#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "fake 0"; exit 0; fi
cat > /dev/null
cat "$FAKE_ENVELOPE"
exit "${FAKE_EXIT:-0}"
"""


class TestInvokeAgentCarriesTheEnvelope:
    """handoff.md §10, D6. The envelope of `claude --print --output-format
    json` carries the real cost, the cache tokens and the permission denials;
    invoke_agent.sh used to keep only input and output tokens."""

    def _invoke(self, tmp_path, envelope: dict, exit_code: int = 0):
        bash = _posix_bash()
        if bash is None:
            pytest.skip("no POSIX bash on this machine")
        root = tmp_path / "task"
        root.mkdir()
        bindir = tmp_path / "bin"
        bindir.mkdir()
        (bindir / "claude").write_bytes(ENVELOPE_CLAUDE.encode("utf-8"))
        (bindir / "claude").chmod(0o755)
        env_file = tmp_path / "envelope.json"
        env_file.write_text(json.dumps(envelope), encoding="utf-8")
        prompt = tmp_path / "prompt.md"
        prompt.write_text("hello", encoding="utf-8")
        out = tmp_path / "agent-result.json"
        proc = subprocess.run(
            [bash, INVOKE.as_posix(), "distiller", prompt.as_posix(), out.as_posix()],
            cwd=tmp_path,
            env=clean_env(
                AGENTCTL_DATA_ROOT=root.as_posix(),
                PATH=str(bindir) + os.pathsep + os.environ.get("PATH", ""),
                FAKE_ENVELOPE=env_file.as_posix(),
                FAKE_EXIT=str(exit_code),
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        return proc, out

    def _real(self) -> dict:
        return json.loads(ENVELOPE_FIXTURE.read_text(encoding="utf-8"))

    def test_the_real_envelope_is_normalised_in_full(self, tmp_path):
        proc, out = self._invoke(tmp_path, self._real())
        assert proc.returncode == 0, proc.stdout + proc.stderr
        r = json.loads(out.read_text(encoding="utf-8"))
        assert r["session_id"] == "00000000-0000-0000-0000-000000000001"
        assert r["cost_usd"] == pytest.approx(0.0191064)
        assert r["usage"] == {
            "input_tokens": 9,
            "output_tokens": 48,
            "cache_creation_input_tokens": 8596,
            "cache_read_input_tokens": 16654,
            "cache_creation_1h_input_tokens": 8596,
            "cache_creation_5m_input_tokens": 0,
            "thinking_tokens": 42,
        }
        assert r["num_turns"] == 1
        assert r["permission_denials"] == {"count": 0, "tools": []}
        assert r["is_error"] is False
        assert r["subtype"] == "success"

    def test_denials_keep_tool_names_and_never_their_content(self, tmp_path):
        envelope = {
            **self._real(),
            "permission_denials": [
                {
                    "tool_name": "Bash",
                    "tool_use_id": "toolu_1",
                    "tool_input": {"command": "cat .git/config SECRET-MARKER"},
                },
                {"tool_name": "WebFetch", "tool_input": {"url": "https://SECRET-MARKER"}},
            ],
        }
        proc, out = self._invoke(tmp_path, envelope)
        assert proc.returncode == 0, proc.stdout + proc.stderr
        text = out.read_text(encoding="utf-8")
        assert "SECRET-MARKER" not in text
        assert "toolu_1" not in text
        assert json.loads(text)["permission_denials"] == {
            "count": 2,
            "tools": ["Bash", "WebFetch"],
        }

    def test_an_envelope_without_the_fields_still_normalises(self, tmp_path):
        proc, out = self._invoke(tmp_path, {"result": "done", "usage": {"input_tokens": 1}})
        assert proc.returncode == 0, proc.stdout + proc.stderr
        r = json.loads(out.read_text(encoding="utf-8"))
        assert r["usage"]["input_tokens"] == 1
        assert r["cost_usd"] is None
        assert r["usage"]["cache_read_input_tokens"] is None
        assert r["num_turns"] is None
        assert r["permission_denials"] is None
        assert r["is_error"] is None

    def test_a_failed_call_still_records_what_it_cost(self, tmp_path):
        # A run that ends in error is billed too; its envelope is normalised
        # before the script reports the failure.
        envelope = {
            **self._real(),
            "is_error": True,
            "subtype": "error_max_turns",
            "total_cost_usd": 1.5,
        }
        proc, out = self._invoke(tmp_path, envelope, exit_code=1)
        assert proc.returncode == 1
        r = json.loads(out.read_text(encoding="utf-8"))
        assert r["cost_usd"] == pytest.approx(1.5)
        assert r["is_error"] is True
        assert r["subtype"] == "error_max_turns"


class TestTelemetryReportShowsTheRealSpend:
    def _runs(self, tmp_path) -> Path:
        runs = tmp_path / "data" / ".ai" / "telemetry" / "runs" / "DEMO-001"
        runs.mkdir(parents=True)
        base = {
            "schema": 2,
            "task_id": "DEMO-001",
            "workflow_run_id": "1",
            "provider": "anthropic",
            "model": "claude-sonnet-5",
            "attempt": 1,
            "input_tokens": 10,
            "output_tokens": 10,
            "total_tokens": 20,
            "result": "completed",
        }
        (runs / "1-test_agent-a1.json").write_text(
            json.dumps(
                {
                    **base,
                    "role": "test_agent",
                    "cost_usd": 2.0,
                    "cost_source": "provider",
                    "permission_denials": 2,
                    "permission_denied_tools": ["Bash", "Bash"],
                }
            ),
            encoding="utf-8",
        )
        (runs / "2-code_agent-a1.json").write_text(
            json.dumps({**base, "role": "code_agent", "schema": 1, "estimated_cost_usd": 0.5}),
            encoding="utf-8",
        )
        return tmp_path / "data"

    def test_cost_estimates_and_denials_are_shown(self, tmp_path):
        result = run_in(self._runs(tmp_path), "telemetry", "report")
        assert result.returncode == 0, result.stderr
        out = result.stdout
        assert "$2.5000" in out
        assert "1 estimated" in out
        estimated = out.split("estimated cost", 1)[1]
        assert "DEMO-001/2-code_agent-a1.json" in estimated
        assert "permission denials 2" in out
        denied = out.split("permission denied", 1)[1]
        assert "DEMO-001/1-test_agent-a1.json" in denied
        assert "Bash" in denied
