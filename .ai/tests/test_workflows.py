"""Structural invariants of the agent workflows.

Plain text checks, no YAML parser — `.ai/` stays stdlib-only. These pin
properties that unit tests cannot see because they live in workflow YAML, and
every one of them is here because it broke a live run.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from agentlib.guard import TASK_ID_SAFE

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
WORKER = WORKFLOWS / "agent-worker.yml"
ORCHESTRATOR = WORKFLOWS / "agent-orchestrator.yml"
GUARD_WF = WORKFLOWS / "agent-guard.yml"
JEV_SMOKE = WORKFLOWS / "jev-smoke.yml"
CI_SUMMARY = WORKFLOWS / "ci-summary.yml"
COVERAGE = WORKFLOWS / "coverage-check.yml"
SPEC_DRIFT = WORKFLOWS / "spec-drift.yml"
WIKI_PROPOSAL = WORKFLOWS / "wiki-proposal.yml"
RENOVATE = WORKFLOWS.parent / "renovate.json"

# handoff.md §10, D2b. The one way a workflow step may run agentctl: from the
# trusted copy of `main` checked out beside the task, never the task branch's.
AGENTCTL = 'python -I "$TOOLS/.ai/bin/agentctl.py"'
GATE = "Refuse .ai changes beyond this task's bookkeeping"
CLI_GATE = "Refuse CLI project config that differs from main"
UNPRIVILEGED = "Hand the checkout to an unprivileged user"
KILL = "Stop every process the model left behind"
RECLAIM = "Take the checkout back"
MODEL_USER = "agentrun"

# handoff.md §10, D5. test-agent.yml's static checks: job -> (the image it runs
# in, the exact `docker compose run` it ends with). One tool per job, so the job
# name alone tells ciresult which output format to read.
STATIC_CHECKS = {
    "backend-ruff": (
        "backend",
        "--entrypoint python backend-test -m ruff check --output-format concise .",
    ),
    "backend-mypy": ("backend", "--entrypoint python backend-test -m mypy app"),
    "frontend-typecheck": (
        "frontend",
        "--entrypoint npm frontend-test run typecheck -- --pretty false",
    ),
    "frontend-lint": ("frontend", "--entrypoint npm frontend-test run lint"),
}


@pytest.fixture
def worker() -> str:
    if not WORKER.exists():
        pytest.skip("agent-worker.yml not present")
    return WORKER.read_text(encoding="utf-8")


@pytest.fixture
def orchestrator() -> str:
    if not ORCHESTRATOR.exists():
        pytest.skip("agent-orchestrator.yml not present")
    return ORCHESTRATOR.read_text(encoding="utf-8")


def step(text: str, name: str) -> str:
    """One step's YAML, from its `- name:` line to the next step."""
    marker = f"- name: {name}\n"
    assert marker in text, f"no step named {name!r}"
    return text.split(marker, 1)[1].split("\n      - ", 1)[0]


_RUN_KEY = re.compile(r"^(?P<lead>\s*(?:-\s+)?)run:\s*(?P<rest>.*)$")


def run_bodies(text: str) -> list[str]:
    """Every `run:` script in a workflow, as the text the runner will execute.

    Handles both `run: one-liner` and block scalars (`run: |`, `run: >-`): a
    block is every following line indented deeper than the `run` key, which is
    how YAML ends it. Shell comments are deliberately kept — GitHub expands
    `${{ }}` inside them too, before bash ever sees the `#`.
    """
    lines = text.splitlines()
    bodies: list[str] = []
    i = 0
    while i < len(lines):
        m = _RUN_KEY.match(lines[i])
        i += 1
        if not m:
            continue
        rest = m.group("rest").strip()
        if rest and rest[0] not in "|>":
            bodies.append(rest)
            continue
        key_col = len(m.group("lead"))
        block: list[str] = []
        while i < len(lines):
            line = lines[i]
            if line.strip() and len(line) - len(line.lstrip()) <= key_col:
                break
            block.append(line)
            i += 1
        bodies.append(textwrap.dedent("\n".join(block)).strip("\n"))
    return bodies


def _posix_bash() -> str | None:
    """A bash that can run a step body against this filesystem, or None.

    On Windows `shutil.which` can resolve to WSL's `bash.exe` launcher, which
    runs in a different filesystem; Git Bash is fine.
    """
    path = shutil.which("bash")
    if path is None:
        return None
    lowered = path.lower()
    if sys.platform == "win32" and ("system32" in lowered or "windowsapps" in lowered):
        return None
    return path


def run_step_body(body: str, env: dict[str, str], tmp_path: Path) -> tuple[int, str]:
    """Execute one step's script the way the runner would, minus the runner.

    Returns the exit code and what the script wrote to `$GITHUB_OUTPUT`.
    """
    bash = _posix_bash()
    if bash is None:
        pytest.skip("no POSIX bash on this machine")
    output = tmp_path / "github_output"
    output.write_text("", encoding="utf-8")
    github_env = tmp_path / "github_env"
    github_env.write_text("", encoding="utf-8")
    scrubbed = ("TASK_ID", "INPUT_TASK_ID", "HEAD_BRANCH", "GITHUB_OUTPUT", "GITHUB_ENV")
    # GIT_* too: under a git hook they would aim any `git` in the step at the
    # repository being committed to (see conftest.py).
    full_env = {
        k: v for k, v in os.environ.items() if k not in scrubbed and not k.startswith("GIT_")
    }
    full_env.update(GITHUB_OUTPUT=output.as_posix(), GITHUB_ENV=github_env.as_posix(), **env)
    proc = subprocess.run(
        [bash, "-c", body],
        env=full_env,
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,  # a refused id is a non-zero exit, which is the point
    )
    return proc.returncode, output.read_text(encoding="utf-8")


class TestScratchFilesStayOutOfTheCheckout:
    """Run 35556225202: the test agent wrote exactly the right file and was
    still failed, because the workflow's own prompt.md, context.json and
    agent-result.json sat in the checkout, got staged by `git add -A`, and the
    guard correctly refused a diff containing paths no role may write."""

    SCRATCH = ("prompt.md", "context.json", "agent-result.json", "changed.txt")

    def test_the_worker_uses_the_runner_temp_directory(self, worker):
        assert "$RUNNER_TEMP/" in worker, "scratch must live in the runner temp dir, not the repo"

    def test_the_runner_context_is_not_used_in_job_level_env(self, worker):
        # `runner` is unavailable in `jobs.<id>.env`, and GitHub rejects the
        # entire workflow file if it appears there — no job runs at all. A YAML
        # parser cannot see this; run 35556516395 is what it looks like.
        head = worker.split("steps:", 1)[0]
        live = [ln for ln in head.splitlines() if not ln.strip().startswith("#")]
        offenders = [ln for ln in live if "runner." in ln]
        assert not offenders, "the runner context is not available above `steps:`: " + "; ".join(
            offenders
        )

    @pytest.mark.parametrize("name", SCRATCH)
    def test_no_scratch_file_is_referenced_at_the_repo_root(self, worker, name):
        for line in worker.splitlines():
            stripped = line.strip()
            if name not in stripped or stripped.startswith("#"):
                continue
            # Every mention must be qualified by the scratch directory.
            assert "$RUNNER_TEMP/" in stripped, (
                f"{name} is referenced without $RUNNER_TEMP/ — it would land in the checkout "
                f"and be staged by `git add -A`:\n    {stripped}"
            )


class TestAFailedGuardMustEscalate:
    """A boundary violation that fails the job kills every later step, so the
    state is never advanced and the task sits in *_RUNNING forever. Failures
    must be recorded and routed, never silently dropped."""

    def test_the_guard_step_does_not_abort_the_job(self, worker):
        guard_block = worker.split("- name: Check the diff against the permission model", 1)[1]
        guard_block = guard_block.split("- name:", 1)[0]
        assert "continue-on-error: true" in guard_block, (
            "the guard step must not fail the job outright, or the escalate step "
            "below it can never run"
        )

    def test_there_is_an_escalation_step_keyed_on_the_guard(self, worker):
        assert "Escalate a boundary violation" in worker
        assert "steps.guard.outcome == 'failure'" in worker
        assert "GUARD_VIOLATION" in worker

    def test_state_is_pushed_even_when_the_job_fails(self, worker):
        push = worker.split("- name: Push state and work", 1)[1].split("- name:", 1)[0]
        assert "if: always()" in push, "an escalated state that is never pushed is lost"


class TestTheAgentGetsNoGitHubToken:
    """The model process must not be able to reach the GitHub API, whatever it
    is persuaded to do by content it reads."""

    def test_the_invoke_step_blanks_both_token_variables(self, worker):
        # Anchor on the step header, not a prose mention of it in the file's
        # own comments — which is what this test matched on its first draft.
        invoke = worker.split("- name: Invoke the agent", 1)[1].split("- name:", 1)[0]
        assert 'GITHUB_TOKEN: ""' in invoke
        assert 'GH_TOKEN: ""' in invoke

    # handoff.md §10, D2. Blanking the variables was never enough on its own:
    # `actions/checkout` persists the job token into `.git/config` by default,
    # where the model can read it with nothing but its file tools — and that
    # token carries `contents: write` and `actions: write`.

    def test_the_checkout_does_not_persist_the_token(self, worker):
        checkouts = worker.split("uses: actions/checkout@")[1:]
        assert checkouts, "expected the worker to check out the task branch"
        for chunk in checkouts:
            with_block = chunk.split("\n      - ", 1)[0]
            assert "persist-credentials: false" in with_block, (
                "actions/checkout writes the job token into .git/config unless told not to, "
                "and the model can read .git/config"
            )

    def test_nothing_writes_a_credential_into_the_repository(self, worker):
        for body in run_bodies(worker):
            for line in body.splitlines():
                live = line.strip()
                if live.startswith("#"):
                    continue
                assert not (live.startswith("git config") and "extraheader" in live), (
                    f"writes an auth header into .git/config, where the model reads it: {live}"
                )
                assert "x-access-token@" not in live and "remote set-url" not in live, (
                    f"puts a credential into a remote URL, which lands in .git/config: {live}"
                )

    def test_only_the_push_and_the_hand_off_hold_the_repo_token(self, worker):
        holders = set()
        for chunk in worker.split("      - name: ")[1:]:
            if "github.token" in chunk:
                holders.add(chunk.split("\n", 1)[0].strip())
        assert holders == {"Push state and work", "Hand control back to the orchestrator"}, (
            f"the job token must reach exactly the two steps that need it, found {holders}"
        )

    def test_the_push_step_does_nothing_but_push(self, worker):
        # `git add` and `git commit` run fsmonitor, filters and hooks from a
        # .git directory the model has just had write access to. They belong in
        # a step that holds no token.
        push = step(worker, "Push state and work")
        assert "github.token" in push, "the push must authenticate explicitly, in this step"
        body = "\n".join(run_bodies(push))
        assert "git push" in body
        assert "git commit" not in body and "git add" not in body

    def test_the_push_credential_is_masked(self, worker):
        # GitHub masks the raw token, not the base64 header derived from it.
        body = "\n".join(run_bodies(step(worker, "Push state and work")))
        assert "::add-mask::" in body


class TestAWorkerCannotEscapeItsOwnBranch:
    """The single property the two-tier permission model rests on.

    A dispatched worker is restricted by `agent-guard.yml`, which runs only on
    branches named `agent/*`. A Director is unrestricted and is bounded by
    code-owner review on an ordinary branch instead. That split is only worth
    anything if a worker cannot put its diff somewhere the guard does not look
    — one push to `main`, or to `feature/x`, and the guard never runs and the
    tiers have silently become one.

    Two things make it hold, and neither is obvious from reading the job top to
    bottom: the push target is built by the workflow from its own dispatch
    input, and the model step has no credential to push with. Pinned here so
    that a later edit moving the branch name somewhere an agent can influence
    fails a test instead of quietly widening every worker's blast radius."""

    def test_the_push_target_is_built_by_the_workflow(self, worker):
        assert "BRANCH: agent/${{ github.event.inputs.task_id }}" in worker, (
            "the branch a worker pushes to must be constructed by the workflow from its "
            "dispatch input, never taken from anything the agent can write"
        )

    def test_the_worker_pushes_nowhere_else(self, worker):
        pushes = [
            line.strip()
            for line in worker.splitlines()
            if "git push" in line and not line.strip().startswith("#")
        ]
        assert pushes, "expected the worker to push its work somewhere"
        for push in pushes:
            assert 'HEAD:"$BRANCH"' in push, (
                f"{push!r} sends a worker's diff somewhere other than its own task branch, "
                f"where agent-guard would never see it"
            )

    def test_the_checkout_is_the_same_task_branch(self, worker):
        assert "ref: agent/${{ github.event.inputs.task_id }}" in worker

    def test_the_task_id_is_validated_before_anything_uses_it(self, worker):
        # handoff.md §10, D2. The branch name is only as safe as the id it is
        # built from; a crafted id must fail the job before the first step
        # that consumes it.
        steps = worker.split("    steps:\n", 1)[1].splitlines()
        first_step = next(line for line in steps if line.startswith("      - "))
        assert first_step == "      - name: Refuse a malformed task id", (
            "the task id must be validated in the worker's very first step"
        )

    def test_the_guard_covers_exactly_that_namespace(self):
        path = WORKFLOWS / "agent-guard.yml"
        if not path.exists():
            pytest.skip("agent-guard.yml not present")
        assert "startsWith(github.head_ref, 'agent/')" in path.read_text(encoding="utf-8"), (
            "the guard must key off the same prefix the worker is pinned to, or a worker "
            "branch exists that nothing checks"
        )


class TestNoWorkflowCanMerge:
    """Nothing in the system may merge its own work."""

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR, JEV_SMOKE, CI_SUMMARY])
    def test_no_workflow_calls_pr_merge(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        text = path.read_text(encoding="utf-8")
        assert "gh pr merge" not in text
        assert "--auto" not in text


class TestNoWorkflowCanApprove:
    """`gh pr create` needs "Allow GitHub Actions to create and approve pull
    requests", which also grants approval. Nothing here may use it: a workflow
    that can approve could satisfy the 1-approval rule on an agent's own PR."""

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR, JEV_SMOKE, CI_SUMMARY])
    def test_no_workflow_approves_a_pull_request(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        text = path.read_text(encoding="utf-8")
        assert "gh pr review" not in text
        assert "--approve" not in text


class TestTheToolchainIsPinnedInOnePlace:
    """`Prompts/09` deliverable 2, handoff.md §5.6. The provider CLI was
    installed unpinned, so a release on npm could change the agent's behaviour,
    or drop the D2b flags it is started with, with no diff here at all. Its
    version now lives in one place, `.ai/config.json`, read from main's copy
    (`$TOOLS`) and checked before npm sees it: a task branch cannot move it,
    and moving it is a reviewed diff. The same for ruff and mypy (D5 residue):
    `>=` let a cache-evicted rebuild bring new lint rules and turn every PR
    red."""

    CONFIG = Path(__file__).resolve().parents[1] / "config.json"
    BIN = Path(__file__).resolve().parents[1] / "bin"
    PYPROJECT = Path(__file__).resolve().parents[2] / "backend" / "pyproject.toml"
    STEP = "Install the provider CLI"
    PACKAGE = "@anthropic-ai/claude-code"
    EXACT_SEMVER = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
    # An install of the CLI by any package manager, pinned or not.
    INSTALLS_CLI = re.compile(r"\b(npm|npx|pnpm|yarn|bun)\b.*claude-code")

    def anthropic(self) -> dict:
        return json.loads(self.CONFIG.read_text(encoding="utf-8"))["providers"]["anthropic"]

    def scripts(self) -> list[Path]:
        return sorted(WORKFLOWS.glob("*.yml")) + sorted(p for p in self.BIN.iterdir() if p.is_file())

    def test_config_names_the_package_and_one_exact_version(self):
        cfg = self.anthropic()
        assert cfg.get("cli_package") == self.PACKAGE
        version = cfg.get("cli_version")
        assert isinstance(version, str) and self.EXACT_SEMVER.fullmatch(version), (
            f"providers.anthropic.cli_version must be an exact x.y.z, got {version!r}"
        )

    def test_nothing_installs_the_cli_but_the_worker_from_config(self):
        version = self.anthropic()["cli_version"]
        offenders = []
        for path in self.scripts():
            for line in path.read_text(encoding="utf-8").splitlines():
                code = line.split("#", 1)[0] if path.suffix in (".yml", ".sh", ".py") else line
                if self.INSTALLS_CLI.search(code) or "claude-code@" in code:
                    offenders.append(f"{path.name}: {line.strip()}")
            if path.suffix == ".yml":
                assert version not in path.read_text(encoding="utf-8"), (
                    f"{path.name} names CLI version {version} literally; read it from config.json"
                )
        assert not offenders, (
            "the CLI is installed only by agent-worker.yml, from config.json's "
            "cli_package/cli_version:\n    " + "\n    ".join(offenders)
        )

    def test_the_install_step_reads_trusted_config_and_validates_first(self, worker):
        body = step(worker, self.STEP)
        script = run_bodies("steps:\n      - name: x\n" + body)[0]
        assert '"$TOOLS/.ai/config.json"' in script, "read main's config, never the task tree's"
        assert "${{" not in script, "values reach the script through env:, not ${{ }}"
        assert "::error::" in script
        npm = script.index('npm install -g "${CLI_PACKAGE}@${CLI_VERSION}"')
        check = script.index("=~")
        assert check < npm, "the version is checked before npm sees it"
        assert "claude --version" in script[npm:], "the installed CLI must report the pin"

    @pytest.mark.parametrize(
        "version,installed,ok",
        [
            ("2.1.295", "2.1.295", True),
            ("2.1.295", "2.1.303", False),  # npm resolved something else
            ("latest", None, False),
            ("2.1", None, False),
            ("^2.1.295", None, False),
            ("2.1.295; touch pwned", None, False),
            ("2.1.295\n", None, False),
            ("02.1.295", None, False),
        ],
    )
    def test_the_install_step_refuses_anything_but_the_pin(
        self, worker, tmp_path, version, installed, ok
    ):
        tools = tmp_path / "tools"
        (tools / ".ai").mkdir(parents=True)
        cfg = {"providers": {"anthropic": {"cli_package": self.PACKAGE, "cli_version": version}}}
        (tools / ".ai" / "config.json").write_text(json.dumps(cfg), encoding="utf-8")
        fake = tmp_path / "fakebin"
        fake.mkdir()
        log = tmp_path / "npm.log"
        (fake / "npm").write_text(f'#!/bin/sh\necho "$@" >> "{log.as_posix()}"\n', encoding="utf-8")
        (fake / "claude").write_text(
            f'#!/bin/sh\necho "{installed or "0.0.0"} (Claude Code)"\n', encoding="utf-8"
        )
        for f in fake.iterdir():
            f.chmod(0o755)
        script = run_bodies("steps:\n      - name: x\n" + step(worker, self.STEP))[0]
        bash_path = fake.as_posix()
        if sys.platform == "win32" and re.match(r"^[A-Za-z]:/", bash_path):
            bash_path = "/" + bash_path[0].lower() + bash_path[2:]
        code, _ = run_step_body(
            f'export PATH="{bash_path}:$PATH"\n' + script,
            {"TOOLS": tools.as_posix()},
            tmp_path,
        )
        assert (code == 0) is ok
        if installed is None:
            assert not log.exists(), "npm ran with a version that failed the check"
        else:
            assert f"install -g {self.PACKAGE}@{version}" in log.read_text(encoding="utf-8")

    def test_backend_lint_and_type_check_are_exactly_pinned(self):
        text = self.PYPROJECT.read_text(encoding="utf-8")
        for tool in ("ruff", "mypy"):
            specs = re.findall(rf'"{tool}([^"]*)"', text)
            assert specs, f"backend/pyproject.toml does not list {tool}"
            for spec in specs:
                assert re.fullmatch(r"==\d+\.\d+\.\d+", spec), (
                    f"{tool}{spec}: pin it with == so a rebuilt image cannot bring new rules"
                )


class TestAFinishedTaskDoesNotFailTheOrchestrator:
    """Run 35670385955. CI ran on `agent/DEMO-001` for PR #30 *after* the task
    had reached COMPLETE. `workflow_run` woke the orchestrator, which tried to
    apply `CI_PASSED` to a terminal state; the state machine refused —
    `COMPLETE is terminal; CI_PASSED rejected` — and the step's non-zero exit
    failed the whole job.

    The refusal is correct and must stay. Failing the run over it is not: every
    later CI run on a finished task's branch, including the "Update branch" the
    strict up-to-date policy forces before its review PR can merge, paints a
    red X that reads as a broken pipeline at exactly the moment someone is
    deciding whether to merge."""

    def test_the_ci_result_step_tolerates_a_terminal_task(self):
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        text = ORCHESTRATOR.read_text(encoding="utf-8")
        step = text.split("- name: Apply the CI result", 1)[1].split("- name:", 1)[0]
        assert "--ignore-terminal" in step, (
            "an unsolicited CI result on an already-finished task must be a no-op, "
            "not a failed orchestrator run"
        )

    def test_the_human_event_step_still_refuses_a_terminal_task(self):
        # The opposite guarantee: a person explicitly supplying an event is
        # telling the machine something, and being told "that is impossible" is
        # the useful answer. Only the unsolicited path may shrug.
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        text = ORCHESTRATOR.read_text(encoding="utf-8")
        step = text.split("- name: Apply a human-supplied event", 1)[1].split("- name:", 1)[0]
        assert "--ignore-terminal" not in step


class TestAHandAuthoredBranchDoesNotDriveTheOrchestrator:
    """Runs 36205815256 and 36366090454. `agent/FRONTEND-002` was cut by hand,
    as `wiki/GeneralContext/Prompts/frontend-build-handoff.md` instructs: the
    `agent/` prefix is what makes `agent-guard.yml` check the diff against the
    spec's `allowed_paths`, which is free verification worth having. But
    `workflow_run` keys off that same prefix, so CI finishing on the branch
    woke the orchestrator, which tried to apply `CI_PASSED` to a task with no
    state file and exited 2.

    Failing is the mild half. `agentctl next` answers `validate` for a
    stateless task, so simply letting the run continue would have created a
    state file, committed it onto an open review PR, and gone on to dispatch a
    paid worker for work a human had already finished — which is the one thing
    the current pass exists to avoid.

    `agent-guard.yml` had this right already ("no state file; treating as a
    hand-authored branch"). This pins the same rule in the other workflow that
    reads the branch name."""

    def _steps(self, text: str) -> dict[str, str]:
        out: dict[str, str] = {}
        for chunk in text.split("      - name: ")[1:]:
            out[chunk.split("\n", 1)[0].strip()] = chunk
        return out

    def test_the_orchestrator_asks_whether_it_owns_the_task(self):
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        step = self._steps(ORCHESTRATOR.read_text(encoding="utf-8")).get(
            "Is this a task this orchestrator drives?"
        )
        assert step is not None, "the orchestrator must decide whether the task is its own"
        assert "state.json" in step, (
            "presence of the task's state file is what distinguishes a dispatched task "
            "from a hand-authored branch"
        )
        assert 'echo "drive=' in step

    def test_a_dispatch_can_still_bootstrap_a_brand_new_task(self):
        # The opposite guarantee, and the reason this cannot be a blanket
        # "skip when there is no state file": a person naming a task id is how
        # a task is started, and a new task has no state file either.
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        step = self._steps(ORCHESTRATOR.read_text(encoding="utf-8"))[
            "Is this a task this orchestrator drives?"
        ]
        assert "workflow_dispatch" in step, (
            "a human-dispatched run must proceed even with no state file, or no task "
            "could ever be bootstrapped"
        )

    @pytest.mark.parametrize(
        "name",
        [
            "Apply the CI result",
            "Decide the next action",
            "Commit the state change",
        ],
    )
    def test_every_state_touching_step_is_gated(self, name: str):
        # These three are the whole gate. Every other action step is already
        # conditioned on `decide.outputs.kind`, which stays empty when
        # "Decide the next action" is skipped, so they fall out on their own.
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        step = self._steps(ORCHESTRATOR.read_text(encoding="utf-8"))[name]
        head = step.split("run: |", 1)[0]
        assert "steps.drive.outputs.drive == 'true'" in head, (
            f"{name!r} reads or writes task state, so it must not run on a branch "
            f"this orchestrator never dispatched"
        )


DRIVE = "Is this a task this orchestrator drives?"
GUARD_STATE = "The task must not have been left in a failed or paused state"
HAND_TASK = "UI-009"


class TestAHandRunIsNotTheOrchestratorsToDrive:
    """A hand-run task now leaves a state file (`agentctl hand start`), so the
    file's presence no longer means "the orchestrator dispatched this". The
    drive step reads the state's `mode` instead, and drives only `auto`,
    whatever woke it: a dispatch naming a hand task has nothing to drive
    either. A missing file keeps its old meaning, so a dispatch still
    bootstraps a new task. Bash only: it runs before the .ai gate, and no
    python may (TestModelWrittenCodeNeverRunsWithAToken)."""

    @pytest.fixture
    def drive_body(self, orchestrator) -> str:
        return run_bodies(step(job_block(orchestrator, "orchestrate"), DRIVE))[0]

    @staticmethod
    def _live(body: str) -> list[str]:
        stripped = (ln.strip() for ln in body.splitlines())
        return [ln for ln in stripped if ln and not ln.startswith("#")]

    def test_the_mode_is_read_with_jq_defaulting_to_auto(self, drive_body):
        # `has`, not `//`: `.mode // "auto"` would read a null mode as auto and
        # drive it, where load_state rejects it. Only a missing key is auto.
        lines = self._live(drive_body)
        reads = [ln for ln in lines if "jq" in ln]
        assert reads, "the drive step must read the state's mode"
        assert any('if has("mode") then .mode else "auto" end' in ln for ln in reads), reads
        assert any(".ai/tasks/$TASK_ID/state.json" in ln for ln in reads), reads

    def test_only_auto_is_driven(self, drive_body):
        lines = self._live(drive_body)
        assert any(re.search(r'"\$MODE" = "auto"', ln) for ln in lines), lines
        assert sum('echo "drive=true"' in ln for ln in lines) == 2, (
            "drive=true exactly twice: an auto state file, and a dispatch with no file"
        )

    def test_the_bootstrap_dispatch_survives(self, drive_body):
        assert "workflow_dispatch" in drive_body

    def test_the_drive_step_runs_no_python(self, orchestrator):
        chunk = step(job_block(orchestrator, "orchestrate"), DRIVE)
        assert not step_runs_python(chunk)

    def test_the_guard_reports_the_mode(self):
        body = run_bodies(step(GUARD_WF.read_text(encoding="utf-8"), GUARD_STATE))[0]
        assert "task_mode" in body

    # --- behaviour -------------------------------------------------------------

    def _state_file(self, root: Path, **fields) -> None:
        d = root / ".ai" / "tasks" / HAND_TASK
        d.mkdir(parents=True, exist_ok=True)
        s = {"task_id": HAND_TASK, "state": "HAND_RUNNING", "control": "RUN", **fields}
        (d / "state.json").write_text(json.dumps(s), encoding="utf-8")

    @pytest.mark.parametrize(
        "mode,event,drive",
        [
            ("hand", "workflow_run", "false"),
            ("hand", "workflow_dispatch", "false"),
            ("auto", "workflow_run", "true"),
            ("auto", "workflow_dispatch", "true"),
            ("legacy", "workflow_run", "true"),  # a state file from before modes
            ("weird", "workflow_run", "false"),
            ("weird", "workflow_dispatch", "false"),
            ("null", "workflow_run", "false"),  # load_state rejects it too
            (None, "workflow_run", "false"),  # no state file: hand-authored
            (None, "workflow_dispatch", "true"),  # no state file: bootstrap
        ],
    )
    def test_the_drive_decision(self, drive_body, tmp_path, mode, event, drive):
        if shutil.which("jq") is None:
            pytest.skip("jq is not on PATH here (it is on ubuntu-latest)")
        if mode == "legacy":
            self._state_file(tmp_path, state="IMPL_CI")
        elif mode == "null":
            self._state_file(tmp_path, mode=None)
        elif mode is not None:
            self._state_file(tmp_path, mode=mode)
        code, output = run_step_body(
            drive_body, {"TASK_ID": HAND_TASK, "EVENT_NAME": event}, tmp_path
        )
        assert code == 0
        assert output.splitlines() == [f"drive={drive}"]

    @pytest.mark.parametrize(
        "state,code",
        [("HAND_RUNNING", 0), ("COMPLETE", 0), ("ESCALATED", 1), ("FAILED", 1)],
    )
    def test_the_guard_passes_a_live_or_finished_hand_run(self, tmp_path, state, code):
        from agentlib import state as st

        body = run_bodies(step(GUARD_WF.read_text(encoding="utf-8"), GUARD_STATE))[0]
        s = dict(st.new_state(HAND_TASK, branch=f"agent/{HAND_TASK}"), mode="hand", state=state)
        d = tmp_path / ".ai" / "tasks" / HAND_TASK
        d.mkdir(parents=True)
        (d / "state.json").write_text(json.dumps(s), encoding="utf-8")
        env = {
            "TASK_ID": HAND_TASK,
            "TOOLS": Path(__file__).resolve().parents[2].as_posix(),
            # The step's `python` is the runner's; here it is this interpreter.
            "PATH": os.path.dirname(sys.executable) + os.pathsep + os.environ.get("PATH", ""),
        }
        got, _ = run_step_body(body, env, tmp_path)
        assert got == code

    def test_the_guard_prints_the_mode(self, tmp_path):
        from agentlib import state as st

        bash = _posix_bash()
        if bash is None:
            pytest.skip("no POSIX bash on this machine")
        body = run_bodies(step(GUARD_WF.read_text(encoding="utf-8"), GUARD_STATE))[0]
        s = dict(st.new_state(HAND_TASK), mode="hand", state="HAND_RUNNING")
        d = tmp_path / ".ai" / "tasks" / HAND_TASK
        d.mkdir(parents=True)
        (d / "state.json").write_text(json.dumps(s), encoding="utf-8")
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        env.update(
            TASK_ID=HAND_TASK,
            TOOLS=Path(__file__).resolve().parents[2].as_posix(),
            PATH=os.path.dirname(sys.executable) + os.pathsep + os.environ.get("PATH", ""),
        )
        proc = subprocess.run(
            [bash, "-c", body], env=env, cwd=tmp_path, capture_output=True, text=True, check=False
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        assert f"{HAND_TASK}: HAND_RUNNING (hand run" in proc.stdout


class TestOnlyTheOrchestratorsOwnCiRunIsTrusted:
    """handoff.md §10, D1. `workflow_run` fires for every completed
    `test-agent` run, and `head_branch` is just a name: a fork PR from a branch
    called `agent/<ID>`, or a path-filtered `pull_request` run on the real
    branch, used to be applied as the task's authoritative verdict. The
    repository is public, so the first was open to anyone whose fork run got
    approved.

    Only the run the orchestrator dispatched itself is the verdict: a
    `workflow_dispatch` run, in this repository, on a commit the branch still
    carries with nothing but bookkeeping since."""

    @pytest.fixture
    def orch(self) -> str:
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        return ORCHESTRATOR.read_text(encoding="utf-8")

    def _job_if(self, orch: str) -> str:
        return orch.split("  orchestrate:", 1)[1].split("runs-on:", 1)[0]

    def test_only_a_dispatched_ci_run_wakes_the_orchestrator(self, orch):
        assert "github.event.workflow_run.event == 'workflow_dispatch'" in self._job_if(orch)

    def test_only_a_run_from_this_repository_wakes_it(self, orch):
        assert (
            "github.event.workflow_run.head_repository.full_name == github.repository"
            in self._job_if(orch)
        )

    def test_the_verdict_must_be_for_code_the_branch_still_carries(self, orch):
        step = orch.split("- name: Apply the CI result", 1)[1].split("- name:", 1)[0]
        # The tools copy since handoff.md §10, D2b.
        assert f"{AGENTCTL} guard tested" in step, "the tested SHA must be checked"
        assert step.index("guard tested") < step.index("state advance"), (
            "the SHA check must run before the verdict is applied"
        )


class TestEveryJobIsBounded:
    """A run with no `timeout-minutes` inherits GitHub's 6-hour default. The
    orchestrator holds its task's concurrency group for as long as it runs, and
    GitHub keeps only one pending run per group — so one hung orchestrator
    drops transitions and stalls the task for the rest of the day."""

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR, JEV_SMOKE, CI_SUMMARY])
    def test_the_job_declares_a_timeout(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("timeout-minutes:") and not stripped.startswith("#"):
                return
        raise AssertionError(
            f"{path.name} declares no timeout-minutes, so it inherits the 6-hour default"
        )

    @pytest.mark.parametrize("name", sorted(STATIC_CHECKS))
    def test_every_static_check_job_declares_a_timeout(self, name):
        """handoff.md §10, D5. test-agent.yml's older jobs still inherit the
        default (a D3 residue); a job added to it does not."""
        text = (WORKFLOWS / "test-agent.yml").read_text(encoding="utf-8")
        assert re.search(r"^    timeout-minutes:\s*\d+", job_block(text, name), re.MULTILINE), (
            f"{name} declares no timeout-minutes"
        )


class TestPrCreationFailuresAreNotMasked:
    """The real error — "GitHub Actions is not permitted to create or approve
    pull requests" — was swallowed by `|| echo "a PR for this branch already
    exists"`, which reported the wrong cause for a setting that was switched
    off."""

    def test_the_pr_step_does_not_claim_a_duplicate_on_any_failure(self):
        if not ORCHESTRATOR.exists():
            pytest.skip("agent-orchestrator.yml not present")
        text = ORCHESTRATOR.read_text(encoding="utf-8")
        assert '|| echo "a PR for this branch already exists"' not in text, (
            "a blanket || masks every gh pr create failure as a duplicate"
        )


class TestTheGateStaysAuthoritative:
    """`test-agent.yml` skips suites a change cannot affect. These pin the
    properties that make that safe, each of which fails silently if broken:
    a green run that proved nothing, or a cache that quietly stops being used.
    """

    @pytest.fixture
    def gate(self) -> str:
        path = WORKFLOWS / "test-agent.yml"
        if not path.exists():
            pytest.skip("test-agent.yml not present")
        return path.read_text(encoding="utf-8")

    def test_a_dispatched_run_never_skips_a_suite(self, gate):
        """The orchestrator gets its verdict from workflow_dispatch. If the
        path filter applied there, a red baseline could report success and the
        state machine would believe tests pin something that pins nothing."""
        assert '"$EVENT" != "pull_request"' in gate, (
            "non-PR events must bypass the path filter entirely"
        )

    def test_changing_the_gate_itself_runs_everything(self, gate):
        """Trusting the filter to decide whether to test the filter is how a
        broken gate ships green."""
        for escape in (".github/workflows/", "docker-compose.yml", "docker/"):
            assert escape in gate, f"{escape} must force a full run"

    def test_the_aggregate_check_reports_even_when_jobs_skip(self, gate):
        """A required check that names a skipped job never reports at all, and
        a protected branch reads that as 'waiting' forever."""
        assert "  gate:" in gate
        assert "if: always()" in gate
        # Comments discuss success(); what matters is that no `if:` uses it.
        conditions = [
            line
            for line in gate.splitlines()
            if line.strip().startswith("if:") and "success()" in line
        ]
        assert not conditions, (
            "success() treats a skipped dependency as failure; a skip must pass here: "
            + "; ".join(conditions)
        )

    def test_the_built_image_tags_match_what_compose_runs(self, gate):
        """The one coupling with no error path. CI builds the image under a
        tag; compose runs the service by its own `image:`. If the two drift,
        compose silently rebuilds from scratch and the layer cache stops
        working, with nothing failing to say so."""
        compose = (WORKFLOWS / ".." / ".." / "docker-compose.yml").resolve()
        if not compose.exists():
            pytest.skip("docker-compose.yml not present")
        text = compose.read_text(encoding="utf-8")
        for tag in ("fanwire-backend-test:latest", "fanwire-frontend-test:latest"):
            assert f"image: {tag}" in text, f"docker-compose.yml must tag {tag}"
            assert f"tags: {tag}" in gate, f"test-agent.yml must build {tag}"


class TestTheGuardCanBeARequiredCheck:
    """`agent-guard` is the enforcement backstop, but it runs only on `agent/`
    branches — so on a human PR it is skipped and never reports. A required
    check naming a skipped job reads as "waiting" on a protected branch, which
    would stop any human PR merging; not requiring it at all makes the
    backstop advisory, because a non-required failing check does not block a
    merge. `guard-gate` is what resolves that, and it is the job to require.
    """

    @pytest.fixture
    def guard_wf(self) -> str:
        path = WORKFLOWS / "agent-guard.yml"
        if not path.exists():
            pytest.skip("agent-guard.yml not present")
        return path.read_text(encoding="utf-8")

    def test_there_is_an_always_reporting_aggregate(self, guard_wf):
        assert "  guard-gate:" in guard_wf
        block = guard_wf.split("  guard-gate:", 1)[1]
        assert "if: always()" in block
        assert "needs: guard" in block

    def test_a_skipped_guard_on_an_agent_branch_is_an_error(self, guard_wf):
        """The one case a skip is NOT benign: if the guard's own condition
        ever breaks, every agent PR would sail through reporting success."""
        block = guard_wf.split("  guard-gate:", 1)[1]
        assert "HEAD_REF#agent/" in block, (
            "guard-gate must fail when an agent/ branch skipped the guard"
        )

    def test_a_failed_guard_fails_the_aggregate(self, guard_wf):
        block = guard_wf.split("  guard-gate:", 1)[1]
        assert "exit 1" in block

    def test_the_aggregate_does_not_use_success(self, guard_wf):
        offenders = [
            line
            for line in guard_wf.splitlines()
            if line.strip().startswith("if:") and "success()" in line
        ]
        assert not offenders, (
            "success() treats the skipped-guard case as failure, which is the "
            "case this job exists to distinguish: " + "; ".join(offenders)
        )

    def test_the_guard_itself_still_only_runs_on_agent_branches(self, guard_wf):
        """The aggregate must not be an excuse to widen the guard onto human
        PRs, which are governed by review and CODEOWNERS instead."""
        assert "startsWith(github.head_ref, 'agent/')" in guard_wf


class TestTheOpenApiContractCannotDrift:
    """`backend/openapi.json` is what the frontend's TypeScript types
    (`frontend/src/api/schema.d.ts`) are generated from. If either is stale,
    the client compiles cleanly and fails at runtime, so a CI job regenerates
    both and fails on any difference. Each check below is a way that job could
    exist and still pass everything."""

    @pytest.fixture
    def gate(self) -> str:
        path = WORKFLOWS / "test-agent.yml"
        if not path.exists():
            pytest.skip("test-agent.yml not present")
        return path.read_text(encoding="utf-8")

    @staticmethod
    def job(gate: str, name: str) -> str:
        assert f"\n  {name}:\n" in gate, f"test-agent.yml has no `{name}` job"
        body = gate.split(f"\n  {name}:\n", 1)[1]
        # A job ends where the next two-space-indented key begins.
        lines = []
        for line in body.splitlines():
            if line.startswith("  ") and not line.startswith("   ") and line.strip():
                break
            lines.append(line)
        return "\n".join(lines)

    def test_the_job_regenerates_the_committed_schema(self, gate):
        job = self.job(gate, "openapi-drift")
        assert "python scripts/export_openapi.py" in job

    def test_the_types_are_generated_from_the_fresh_schema(self, gate):
        """Generated from the committed schema instead, the types would match
        a stale contract and pass."""
        job = self.job(gate, "openapi-drift")
        assert "npm run gen:api-types" in job
        assert job.index("python scripts/export_openapi.py") < job.index("npm run gen:api-types"), (
            "the types must be regenerated after the schema, from the fresh export"
        )

    def test_the_job_fails_on_untracked_as_well_as_modified(self, gate):
        """`git diff --exit-code` sees tracked files only: a file that was
        never committed would be regenerated and pass."""
        job = self.job(gate, "openapi-drift")
        assert "git status --porcelain -- backend/openapi.json frontend/src/api/schema.d.ts" in job
        assert "exit 1" in job

    def test_the_job_runs_on_backend_or_frontend_changes(self, gate):
        """A route change moves both files; a hand-edit of the generated types
        moves only the second. Keyed on the filter outputs, it also inherits
        the non-PR bypass that makes a dispatched run authoritative."""
        job = self.job(gate, "openapi-drift")
        assert (
            "if: needs.changes.outputs.backend == 'true'"
            " || needs.changes.outputs.frontend == 'true'" in job
        )

    def test_the_aggregate_gate_depends_on_it(self, gate):
        """Only `gate` is required on `main`. A job outside its `needs:` can
        fail on every PR and block nothing."""
        needs = self.job(gate, "gate").split("needs:", 1)[1].split("runs-on:", 1)[0]
        assert "- openapi-drift" in needs


class TestActionsRunOnNode24:
    """GitHub deprecated Node 20 for actions in 2025 and forces Node-20 actions
    onto Node 24 with a warning on every run. Each entry is the first major of
    that action whose `action.yml` declares `using: node24` (checked
    2026-10-05). The first majors were chosen over the latest ones so the bump
    changes the runtime and as little else as possible."""

    MIN_MAJOR = {
        "actions/checkout": 5,
        "actions/setup-python": 6,
        "actions/setup-node": 5,
        "aws-actions/configure-aws-credentials": 6,
        "docker/setup-buildx-action": 4,
        "docker/build-push-action": 7,
        # Checked 2026-10-08 for the D2b worker split: upload-artifact@v5 and
        # download-artifact@v6 still declare node20.
        "actions/upload-artifact": 6,
        "actions/download-artifact": 7,
        # Checked 2026-10-19 for scorecard.yml: codeql-action@v3's upload-sarif
        # declares node20, v4's node24. scorecard-action is a docker action
        # with no Node runtime; its floor is the major pinned.
        "github/codeql-action": 4,
        "ossf/scorecard-action": 2,
    }

    @pytest.mark.parametrize("path", sorted(WORKFLOWS.glob("*.yml")), ids=lambda p: p.name)
    def test_no_action_is_pinned_to_a_node20_major(self, path):
        # The ref is a commit SHA (TestEveryActionIsPinnedToACommit), so the
        # major is read from the trailing `# vN` comment. A `uses:` with no
        # version fails rather than being skipped, or this test goes vacuous.
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.lstrip().startswith("#"):
                continue
            m = re.search(r"uses:\s*([\w.-]+/[\w.-]+)\S*", line)
            if not m:
                continue
            v = re.search(r"#\s*v(\d+)\b", line[m.end():])
            assert v, f"{path.name}: no `# vN` version on: {line.strip()}"
            action, major = m.group(1), int(v.group(1))
            assert action in self.MIN_MAJOR, f"{path.name}: {action} has no Node 24 floor here"
            assert major >= self.MIN_MAJOR[action], (
                f"{path.name}: {action}@v{major} is a Node 20 major"
            )


class TestEveryActionIsPinnedToACommit:
    """A tag such as `actions/checkout@v5` is movable: its owner, or whoever
    takes over their account, can point it at new code, and the next run here
    executes that code next to `AGENT_DISPATCH_TOKEN` and the deploy role with
    no diff in this repository. A full commit SHA cannot be moved. The tag
    stays as a trailing `# vN` comment, the form Renovate's
    pinGitHubActionDigests maintains, so a reader still sees the version
    (supply-chain brief `wiki/GeneralContext/Prompts/09-supply-chain-and-trust.md`,
    deliverable 1). To bump one, resolve the new tag to its commit with
    `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (dereferencing an
    annotated tag object), or let Renovate open the PR."""

    PINNED = re.compile(r"^[\w.-]+/[\w.-]+(/[\w./-]+)?@[0-9a-f]{40}\s+#\s*v\S+$")
    DOCKER = re.compile(r"^docker://\S+@sha256:[0-9a-f]{64}(\s+#.*)?$")

    def _refs(self, path):
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            m = re.search(r"\buses:\s*(.+?)\s*$", line)
            if m:
                yield n, m.group(1).strip("'\"")

    def _pinned(self, ref):
        return ref.startswith("./") or bool(self.PINNED.match(ref) or self.DOCKER.match(ref))

    def test_the_check_tells_pinned_from_movable(self):
        sha = "a" * 40
        assert self._pinned(f"actions/checkout@{sha} # v5")
        assert self._pinned(f"github/codeql-action/init@{sha} # v3.1.0")
        assert self._pinned("./.github/actions/local")
        assert self._pinned("docker://alpine@sha256:" + "b" * 64)
        assert not self._pinned("actions/checkout@v5")
        assert not self._pinned(f"actions/checkout@{sha}")  # no version comment
        assert not self._pinned(f"actions/checkout@{sha.upper()} # v5")
        assert not self._pinned("actions/checkout@main # v5")
        assert not self._pinned("docker://alpine:3.20")

    @pytest.mark.parametrize("path", sorted(WORKFLOWS.glob("*.yml")), ids=lambda p: p.name)
    def test_every_uses_is_a_commit_sha(self, path):
        movable = [f"{path.name}:{n}: {r}" for n, r in self._refs(path) if not self._pinned(r)]
        assert not movable, "movable action refs:\n" + "\n".join(movable)


class TestNoDispatchInputReachesTheShellAsCode:
    """handoff.md §10, D2. `${{ }}` is expanded into the script text before bash
    runs, so a dispatch input of `$(curl …)` is executed, not printed. Anyone
    with `actions: write` can dispatch these workflows, a fork can name its
    branch `agent/$(…)`, and later steps of the orchestrator hold
    `AGENT_DISPATCH_TOKEN` — a person's PAT. Such values must reach the shell
    through `env:`, where they are data."""

    TAINTED = re.compile(
        r"\$\{\{\s*(github\.event\.inputs|inputs\.|steps\.|github\.event\.workflow_run"
        r"|github\.head_ref)"
    )

    def test_the_extractor_sees_block_and_inline_scripts(self):
        sample = textwrap.dedent(
            """\
            steps:
              - name: a
                run: echo ${{ steps.x.outputs.y }}
              - run: |
                  # ${{ inputs.z }}
                  echo ok
              - name: c
                env:
                  V: ${{ steps.safe.outputs.v }}
                run: echo "$V"
            """
        )
        assert run_bodies(sample) == [
            "echo ${{ steps.x.outputs.y }}",
            "# ${{ inputs.z }}\necho ok",
            'echo "$V"',
        ]

    # agent-guard.yml joined in D2b: it pasted the PR's branch name, which a
    # fork chooses, into three scripts.
    @pytest.mark.parametrize(
        "path", [WORKER, ORCHESTRATOR, GUARD_WF, JEV_SMOKE, CI_SUMMARY], ids=lambda p: p.name
    )
    def test_no_run_script_interpolates_attacker_influenced_context(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        offenders = [
            line.strip()
            for body in run_bodies(path.read_text(encoding="utf-8"))
            for line in body.splitlines()
            if self.TAINTED.search(line)
        ]
        assert not offenders, (
            f"{path.name} pastes attacker-influenced context into a script; pass it via "
            "`env:` and quote it:\n    " + "\n    ".join(offenders)
        )


class TestACraftedTaskIdFailsEarly:
    """handoff.md §10, D2. The task id names a branch, a directory under
    `.ai/tasks/`, and a value written to `$GITHUB_OUTPUT` — where a newline in
    it would forge a second output. `TASK_ID_SAFE` already exists for the
    guard; these pin that both workflows apply the same rule, and that it runs
    before the id is used for anything."""

    CRAFTED = [
        "$(touch pwned)",
        "DEMO-001; touch pwned",
        "DEMO-001\nbranch=main",
        "DEMO-001\n",
        "../../main",
        "demo-001",
        "",
    ]

    @staticmethod
    def pattern_in(body: str) -> str:
        m = re.search(r"TASK_ID_SAFE='([^']*)'", body)
        assert m, "the step must state the TASK_ID_SAFE pattern it checks against"
        return m.group(1)

    def test_the_worker_checks_the_guards_own_pattern(self, worker):
        body = run_bodies(step(worker, "Refuse a malformed task id"))[0]
        assert self.pattern_in(body) == TASK_ID_SAFE.pattern, (
            "the worker's copy of TASK_ID_SAFE has drifted from agentlib/guard.py"
        )

    def test_the_orchestrator_checks_the_guards_own_pattern(self, orchestrator):
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        assert self.pattern_in(body) == TASK_ID_SAFE.pattern, (
            "the orchestrator's copy of TASK_ID_SAFE has drifted from agentlib/guard.py"
        )

    def test_the_orchestrator_validates_before_it_writes_an_output(self, orchestrator):
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        assert body.index("TASK_ID_SAFE") < body.index("GITHUB_OUTPUT")

    @pytest.mark.parametrize("crafted", CRAFTED)
    def test_the_worker_refuses_a_crafted_id(self, worker, crafted, tmp_path):
        body = run_bodies(step(worker, "Refuse a malformed task id"))[0]
        code, _ = run_step_body(body, {"TASK_ID": crafted}, tmp_path)
        assert code != 0, f"the worker accepted {crafted!r}"
        assert not (tmp_path / "pwned").exists()

    @pytest.mark.parametrize("crafted", CRAFTED)
    def test_the_orchestrator_refuses_a_crafted_dispatch_input(
        self, orchestrator, crafted, tmp_path
    ):
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        code, outputs = run_step_body(body, {"INPUT_TASK_ID": crafted, "HEAD_BRANCH": ""}, tmp_path)
        assert code != 0, f"the orchestrator accepted {crafted!r}"
        assert outputs == "", "nothing may be written to $GITHUB_OUTPUT for a refused id"
        assert not (tmp_path / "pwned").exists()

    def test_the_orchestrator_refuses_a_crafted_branch_name(self, orchestrator, tmp_path):
        # The workflow_run path: a fork can name its PR branch anything.
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        code, outputs = run_step_body(
            body, {"INPUT_TASK_ID": "", "HEAD_BRANCH": "agent/$(touch pwned)"}, tmp_path
        )
        assert code != 0
        assert outputs == ""
        assert not (tmp_path / "pwned").exists()

    def test_a_well_formed_id_still_resolves(self, orchestrator, worker, tmp_path):
        body = run_bodies(step(orchestrator, "Resolve the task"))[0]
        code, outputs = run_step_body(
            body, {"INPUT_TASK_ID": "", "HEAD_BRANCH": "agent/DEMO-001"}, tmp_path
        )
        assert code == 0
        assert "id=DEMO-001\n" in outputs
        assert "branch=agent/DEMO-001\n" in outputs
        body = run_bodies(step(worker, "Refuse a malformed task id"))[0]
        code, _ = run_step_body(body, {"TASK_ID": "DEMO-001"}, tmp_path)
        assert code == 0


# --------------------------------------------------------------------------- D2b


def job_block(text: str, name: str) -> str:
    """One job's YAML, from its `  <name>:` key to the next job's."""
    marker = f"\n  {name}:\n"
    assert marker in text, f"no job named {name!r}"
    lines = []
    for line in text.split(marker, 1)[1].splitlines():
        if line.strip() and not line.startswith("   "):
            break  # the next two-space key, or a top-level one
        lines.append(line)
    return "\n".join(lines)


def job_names(text: str) -> list[str]:
    body = text.split("\njobs:\n", 1)[1]
    return re.findall(r"^  ([A-Za-z0-9_-]+):\s*$", body, flags=re.MULTILINE)


def steps_in(block: str) -> list[str]:
    """Every step of a job, in order, each chunk starting at its `- ` line."""
    chunks: list[list[str]] = []
    for line in block.split("    steps:\n", 1)[1].splitlines():
        if line.startswith("      - "):
            chunks.append([line])
        elif chunks:
            chunks[-1].append(line)
    return ["\n".join(c) for c in chunks]


def step_title(chunk: str) -> str:
    first = chunk.strip().removeprefix("- ").splitlines()[0]
    return first.removeprefix("name: ").strip()


def live_lines(text: str) -> list[str]:
    """Every non-comment line of every `run:` script in `text`."""
    out = []
    for body in run_bodies(text):
        for line in body.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                out.append(stripped)
    return out


def makes_patch(text: str) -> bool:
    """Does a live script line diff the index into a binary patch? Global
    options such as `--git-dir=` may sit between `git` and `diff`."""
    return any(re.search(r"^git\b.*\sdiff --cached --binary\b", line) for line in live_lines(text))


def step_runs_python(chunk: str) -> bool:
    return any(re.search(r"\bpython\b", line) for line in live_lines(chunk))


def _git(repo: Path, *args: str) -> str:
    # Never inherit GIT_*: under a hook they point at the real repository.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return subprocess.run(
        ["git", *args], cwd=repo, env=env, capture_output=True, text=True, check=True
    ).stdout


class TestModelWrittenCodeNeverRunsWithAToken:
    """handoff.md §10, D2b. D2 took the token out of the model's own process,
    but code the model *writes* still ran with one in reach. The worker's
    guard skipped everything under `.ai/` (`grep -v '^\\.ai/'`), so a model's
    edit to `.ai/bin/agentctl.py` was committed and then executed by the next
    step of the same job, beside `AGENT_DISPATCH_TOKEN`; the push ran from a
    `.git/` the model could write; the orchestrator ran the task branch's
    `agentctl` with the PAT in env; `agent-guard` imported the PR's own
    `agentlib`.

    The invariant pinned here: no code the model can write ever runs in a step
    that can reach a token. The worker is split in two. The job that runs the
    model can only read, and hands its work on as a patch; the job that holds
    the token starts from a fresh checkout, applies that patch and guards every
    path in it, with no exception for `.ai/`. Every workflow runs `agentctl`
    from a checkout of `main` beside the task, never the task branch's own,
    and refuses a branch whose `.ai/` differs from `main` by anything but this
    task's bookkeeping."""

    # --- the split -------------------------------------------------------

    def test_the_worker_has_two_jobs(self, worker):
        assert job_names(worker) == ["run-model", "land"]

    def test_the_model_job_can_only_read(self, worker):
        block = job_block(worker, "run-model")
        assert "\n    permissions:\n" in block, "the model job must declare its own permissions"
        granted = []
        for line in block.split("\n    permissions:\n", 1)[1].splitlines():
            if not line.startswith("      "):
                break
            if line.split("#", 1)[0].strip():
                granted.append(line.split("#", 1)[0].strip())
        assert granted == ["contents: read"], f"the model job is granted {granted}"

    def test_the_model_job_holds_no_secret_but_the_provider_key(self, worker):
        block = job_block(worker, "run-model")
        assert set(re.findall(r"secrets\.(\w+)", block)) == {"ANTHROPIC_API_KEY"}
        holders = [step_title(c) for c in steps_in(block) if "secrets." in c]
        assert holders == ["Invoke the agent"], holders
        assert "AGENT_DISPATCH_TOKEN" not in block
        assert "github.token" not in block

    def test_the_landing_job_waits_for_the_model_and_always_runs(self, worker):
        head = job_block(worker, "land").split("    steps:\n", 1)[0]
        assert "needs: run-model" in head
        assert "if: always()" in head, (
            "a model job that failed must still be recorded, pushed and handed back"
        )
        assert "contents: write" in head and "actions: write" in head

    def test_the_model_hands_its_work_on_as_a_patch(self, worker):
        model = job_block(worker, "run-model")
        land = job_block(worker, "land")
        assert makes_patch(model)
        assert "actions/upload-artifact@" in model
        assert "actions/download-artifact@" in land
        assert "git apply --index" in step(land, "Check the diff against the permission model")

    def test_the_model_job_commits_and_records_nothing(self, worker):
        # Anything written into the checkout after the model is staged with
        # the model's work and would land as if the model had written it.
        block = job_block(worker, "run-model")
        assert "telemetry-from-run" not in block
        assert "git commit" not in block and "git push" not in block

    def test_nothing_runs_from_the_tools_copy_after_the_model(self, worker):
        # In the model job the model can write anywhere the runner can,
        # including the tools copy beside the checkout. Once it has run,
        # nothing in that job may execute repository code.
        chunks = steps_in(job_block(worker, "run-model"))
        titles = [step_title(c) for c in chunks]
        after = chunks[titles.index("Invoke the agent") + 1 :]
        assert after, "the model job must package the work after the model"
        for chunk in after:
            for line in live_lines(chunk):
                assert "python" not in line and "$TOOLS" not in line, (
                    f"{step_title(chunk)!r} runs code after the model: {line}"
                )

    def test_the_landing_job_validates_the_task_id_first(self, worker):
        land = job_block(worker, "land")
        assert step_title(steps_in(land)[0]) == "Refuse a malformed task id"

    def test_both_jobs_check_out_without_persisting_a_token(self, worker):
        for name in ("run-model", "land"):
            block = job_block(worker, name)
            assert "ref: agent/${{ github.event.inputs.task_id }}" in block, name
            checkouts = block.split("uses: actions/checkout@")[1:]
            assert len(checkouts) == 2, name
            for chunk in checkouts:
                assert "persist-credentials: false" in chunk.split("\n      - ", 1)[0], name

    # --- the landing guard -------------------------------------------------

    def test_the_guard_has_no_exception_for_the_agent_system(self, worker):
        assert "grep -v '^\\.ai/'" not in worker
        guard = step(job_block(worker, "land"), "Check the diff against the permission model")
        assert f"{AGENTCTL} guard check" in guard

    def test_the_patch_may_not_carry_links_or_reach_into_git(self, worker):
        guard = "\n".join(
            run_bodies(
                step(job_block(worker, "land"), "Check the diff against the permission model")
            )
        )
        assert "120000" in guard, "a symlink in the patch must be refused"
        assert "160000" in guard, "a gitlink in the patch must be refused"
        assert ".git" in guard, "a patch path inside .git must be refused"
        assert guard.index("120000") < guard.index("git apply --index")

    def test_telemetry_is_written_only_after_the_guard(self, worker):
        land = job_block(worker, "land")
        assert land.index("- name: Check the diff against the permission model") < land.index(
            "telemetry-from-run"
        )

    # --- the tools copy ------------------------------------------------------

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR, GUARD_WF], ids=lambda p: p.name)
    def test_no_workflow_runs_the_checkouts_own_agentctl(self, path):
        lines = live_lines(path.read_text(encoding="utf-8"))
        offenders = [ln for ln in lines if "agentctl.py" in ln and AGENTCTL not in ln]
        assert not offenders, "agentctl must come from the tools copy:\n    " + "\n    ".join(
            offenders
        )
        assert any(AGENTCTL in ln for ln in lines)
        imports_from_checkout = [
            ln for ln in lines if re.search(r"""path\.insert\(0,\s*['"]\.ai""", ln)
        ]
        assert not imports_from_checkout, imports_from_checkout

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR, GUARD_WF], ids=lambda p: p.name)
    def test_every_python_is_isolated_from_the_checkout(self, path):
        # `python -c` and `python -` put the working directory on sys.path, so
        # a `json.py` in the task checkout would be imported. `-I` does not.
        bare = [
            ln
            for ln in live_lines(path.read_text(encoding="utf-8"))
            if re.search(r"(^|[\s(|])python(?!\s+-I\b)(\s|$)", ln)
        ]
        assert not bare, "python must run with -I:\n    " + "\n    ".join(bare)

    @pytest.mark.parametrize(
        "path,jobs",
        [(WORKER, ["run-model", "land"]), (ORCHESTRATOR, ["orchestrate"])],
        ids=["worker", "orchestrator"],
    )
    def test_the_tools_are_main_beside_the_task_checkout(self, path, jobs):
        text = path.read_text(encoding="utf-8")
        assert "TOOLS: ${{ github.workspace }}/tools" in text
        assert "AGENTCTL_DATA_ROOT: ${{ github.workspace }}/task" in text
        for name in jobs:
            block = job_block(text, name)
            checkouts = block.split("uses: actions/checkout@")[1:]
            tools = [c for c in checkouts if "path: tools" in c.split("\n      - ", 1)[0]]
            task = [c for c in checkouts if "path: task" in c.split("\n      - ", 1)[0]]
            assert len(tools) == 1 and len(task) == 1, name
            assert "ref: ${{ github.sha }}" in tools[0], name

    def test_the_model_is_invoked_from_the_tools_copy(self, worker):
        body = "\n".join(run_bodies(step(job_block(worker, "run-model"), "Invoke the agent")))
        assert 'bash "$TOOLS/.ai/bin/invoke_agent.sh"' in body

    def test_agent_guard_runs_the_base_branchs_code(self):
        text = GUARD_WF.read_text(encoding="utf-8")
        tools = [c for c in text.split("uses: actions/checkout@")[1:] if "path: tools" in c]
        assert len(tools) == 1
        assert "ref: ${{ github.event.pull_request.base.sha }}" in tools[0]
        assert "AGENTCTL_DATA_ROOT: ${{ github.workspace }}/pr" in text

    def test_agent_guard_validates_the_task_id_before_using_it(self):
        text = GUARD_WF.read_text(encoding="utf-8")
        body = run_bodies(step(text, "Derive the task id from the branch"))[0]
        assert TestACraftedTaskIdFailsEarly.pattern_in(body) == TASK_ID_SAFE.pattern

    # --- the .ai gate ----------------------------------------------------------

    @pytest.mark.parametrize(
        "path,name",
        [(WORKER, "run-model"), (WORKER, "land"), (ORCHESTRATOR, "orchestrate")],
        ids=["run-model", "land", "orchestrate"],
    )
    def test_the_gate_precedes_every_python_step(self, path, name):
        chunks = steps_in(job_block(path.read_text(encoding="utf-8"), name))
        titles = [step_title(c) for c in chunks]
        assert GATE in titles, f"{name} has no {GATE!r} step"
        first_python = next(i for i, c in enumerate(chunks) if step_runs_python(c))
        assert titles.index(GATE) < first_python, (
            f"{name} runs python ({titles[first_python]!r}) before the .ai gate"
        )

    def test_the_gate_is_one_script(self, worker, orchestrator):
        bodies = {
            run_bodies(step(job_block(text, name), GATE))[0]
            for text, name in (
                (worker, "run-model"),
                (worker, "land"),
                (orchestrator, "orchestrate"),
            )
        }
        assert len(bodies) == 1, "the .ai gate has drifted between its copies"

    @pytest.fixture
    def gate_body(self, worker) -> str:
        return run_bodies(step(job_block(worker, "run-model"), GATE))[0]

    @pytest.fixture
    def branch(self, tmp_path):
        """A repository whose `origin/main` carries the agent system, and a
        task branch cut from it. Returns a function that commits to the
        branch and returns the repository."""
        if shutil.which("git") is None:
            pytest.skip("git not available")
        repo = tmp_path
        _git(repo, "init", "-q", "-b", "main")
        _git(repo, "config", "user.email", "t@example.com")
        _git(repo, "config", "user.name", "t")
        for rel in (".ai/agentlib/guard.py", ".ai/tasks/ABC-001/task.json", "backend/app/x.py"):
            (repo / rel).parent.mkdir(parents=True, exist_ok=True)
            (repo / rel).write_text(f"base {rel}\n", encoding="utf-8")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "-m", "base")
        _git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
        _git(repo, "checkout", "-q", "-b", "agent/ABC-001")

        def commit(*paths: str) -> Path:
            for rel in paths:
                (repo / rel).parent.mkdir(parents=True, exist_ok=True)
                (repo / rel).write_text("changed\n", encoding="utf-8")
                _git(repo, "add", "--", rel)
            _git(repo, "commit", "-q", "-m", "work")
            return repo

        return commit

    def test_the_gate_passes_bookkeeping_and_ordinary_work(self, gate_body, branch):
        repo = branch(
            ".ai/tasks/ABC-001/state.json",
            ".ai/telemetry/runs/ABC-001/1-code_agent-a1.json",
            "backend/app/x.py",
        )
        code, _ = run_step_body(gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code == 0

    @pytest.mark.parametrize(
        "path",
        [
            ".ai/agentlib/x.py",
            ".ai/agentlib/guard.py",
            ".ai/tasks/OTHER-001/state.json",
            ".ai/tasks/ABC-001/task.json",
            ".ai/tasks/ABC-001/brief.md",
            ".ai/telemetry/runs/ABC-001/sub/1.json",
            ".ai/telemetry/runs/OTHER-001/1.json",
            ".ai/policy.json",
        ],
    )
    def test_the_gate_refuses_anything_else_under_ai(self, gate_body, branch, path):
        repo = branch(".ai/tasks/ABC-001/state.json", path)
        code, _ = run_step_body(gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0, f"the gate accepted a branch changing {path}"

    def test_a_rename_into_bookkeeping_is_still_seen(self, gate_body, branch):
        # With rename detection, `--name-only` prints only the destination, so
        # moving agentlib code onto a bookkeeping path would look like
        # bookkeeping alone.
        repo = branch(".ai/tasks/ABC-001/state.json")
        (repo / ".ai" / "telemetry" / "runs" / "ABC-001").mkdir(parents=True)
        _git(repo, "mv", ".ai/agentlib/guard.py", ".ai/telemetry/runs/ABC-001/x.json")
        _git(repo, "commit", "-q", "-m", "rename")
        # Rename detection must see it as one, or this proves nothing.
        assert "R100" in _git(repo, "diff", "--name-status", "-M", "origin/main...HEAD")
        code, _ = run_step_body(gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0

    def test_the_gate_fails_closed_without_main(self, gate_body, branch):
        repo = branch("backend/app/x.py")
        _git(repo, "update-ref", "-d", "refs/remotes/origin/main")
        code, _ = run_step_body(gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0, "a gate that cannot see main must refuse, not pass"

    # --- the provider CLI's own project config -------------------------------
    #
    # The CLI loads `.claude/settings*.json` (hooks run commands) and
    # `.mcp.json` (servers are processes) from the directory it is started in,
    # with the provider key in its environment. That directory is the task
    # checkout, so a branch that changed them would run code nobody reviewed.

    def test_the_model_job_refuses_changed_cli_config_before_the_model(self, worker):
        block = job_block(worker, "run-model")
        titles = [step_title(c) for c in steps_in(block)]
        assert CLI_GATE in titles
        assert titles.index(CLI_GATE) < titles.index("Invoke the agent")
        gate = step(block, CLI_GATE)
        assert "id: cliconfig" in gate and "continue-on-error: true" in gate
        invoke_head = step(block, "Invoke the agent").split("run: ", 1)[0]
        assert "steps.cliconfig.outcome == 'success'" in invoke_head
        assert "cli_config: ${{ steps.cliconfig.outcome }}" in block

    def test_a_refused_cli_config_escalates_like_a_guard_violation(self, worker):
        land = job_block(worker, "land")
        escalate = step(land, "Escalate a boundary violation")
        assert "verdict == 'refused'" in escalate.split("run: ", 1)[0]
        assert "GUARD_VIOLATION" in escalate
        assert "exit 1" in escalate

    @pytest.fixture
    def cli_gate_body(self, worker) -> str:
        return run_bodies(step(job_block(worker, "run-model"), CLI_GATE))[0]

    def test_the_cli_gate_passes_ordinary_work(self, cli_gate_body, branch):
        repo = branch("backend/app/x.py", ".ai/tasks/ABC-001/state.json")
        code, _ = run_step_body(cli_gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code == 0

    @pytest.mark.parametrize(
        "path",
        [".claude/settings.json", ".claude/settings.local.json", ".claude/x/y.md", ".mcp.json"],
    )
    def test_the_cli_gate_refuses_changed_cli_config(self, cli_gate_body, branch, path):
        repo = branch(path)
        code, _ = run_step_body(cli_gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0, f"the CLI gate accepted a branch changing {path}"

    def test_the_cli_gate_fails_closed_without_main(self, cli_gate_body, branch):
        repo = branch("backend/app/x.py")
        _git(repo, "update-ref", "-d", "refs/remotes/origin/main")
        code, _ = run_step_body(cli_gate_body, {"TASK_ID": "ABC-001"}, repo)
        assert code != 0

    # --- the model as an unprivileged user -----------------------------------
    #
    # As the runner's own user, a process the model leaves running can rewrite
    # the actions the job runs next (`_work/_actions`, e.g. upload-artifact,
    # which holds ACTIONS_RUNTIME_TOKEN and so can write the Actions cache that
    # main's other workflows read), and read the runner's environment. As a
    # separate user it can write only the checkout, and it is killed before
    # anything else in the job runs.

    def _model_steps(self, worker) -> tuple[list[str], list[str]]:
        chunks = steps_in(job_block(worker, "run-model"))
        return chunks, [step_title(c) for c in chunks]

    def test_the_model_runs_as_another_user(self, worker):
        body = "\n".join(run_bodies(step(job_block(worker, "run-model"), "Invoke the agent")))
        assert "sudo" in body and f"-u {MODEL_USER}" in body
        assert "--preserve-env=ANTHROPIC_API_KEY" in body, (
            "the key must not be put on a command line, where sudo logs it"
        )
        assert "ANTHROPIC_API_KEY=" not in body

    def test_the_user_is_made_and_the_git_dir_moved_out_before_the_model(self, worker):
        chunks, titles = self._model_steps(worker)
        setup = chunks[titles.index(UNPRIVILEGED)]
        assert "useradd" in setup and MODEL_USER in setup
        assert "mv .git" in setup, (
            "the git dir must leave the checkout the model owns, or later git commands "
            "run its hooks and config"
        )
        assert titles.index(UNPRIVILEGED) < titles.index("Invoke the agent")

    def test_the_users_processes_are_killed_before_anything_else_runs(self, worker):
        chunks, titles = self._model_steps(worker)
        invoke = titles.index("Invoke the agent")
        kill = titles.index(KILL)
        reclaim = titles.index(RECLAIM)
        package = next(i for i, c in enumerate(chunks) if makes_patch(c))
        upload = next(i for i, c in enumerate(chunks) if "actions/upload-artifact@" in c)
        assert invoke + 1 == kill, "nothing may run between the model and the kill"
        assert kill < reclaim < package < upload
        body = "\n".join(run_bodies(chunks[kill]))
        assert f"pkill -KILL -u {MODEL_USER}" in body
        assert f"pgrep -u {MODEL_USER}" in body, "the kill must be verified, not assumed"
        assert "if: always()" in chunks[kill]

    def test_the_patch_is_made_from_the_git_dir_outside_the_checkout(self, worker):
        chunks, _ = self._model_steps(worker)
        package = next(c for c in chunks if makes_patch(c))
        for line in live_lines(package):
            if line.startswith("git "):
                assert "--git-dir=" in line, f"uses whatever .git the model left: {line}"


class TestTheLandingGuardRunsAgainstARealPatch:
    """handoff.md §10, D2b. The `land` job's guard step, run for real: a
    repository on a task branch, a patch as `run-model` would hand it over,
    and agentctl from this checkout as the tools copy."""

    SPEC = {
        "schema": 1,
        "task_id": "ABC-001",
        "objective": "x",
        "acceptance_criteria": ["x"],
        "allowed_paths": ["backend/app/**"],
        "forbidden_paths": [],
        "required_context": [],
        "required_skills": [],
        "workflow_policy": {},
    }

    @pytest.fixture
    def guard_body(self, worker) -> str:
        return run_bodies(
            step(job_block(worker, "land"), "Check the diff against the permission model")
        )[0]

    @pytest.fixture
    def repo(self, tmp_path) -> Path:
        if shutil.which("git") is None:
            pytest.skip("git not available")
        repo = tmp_path / "task"
        repo.mkdir()
        _git(repo, "init", "-q", "-b", "agent/ABC-001")
        _git(repo, "config", "user.email", "t@example.com")
        _git(repo, "config", "user.name", "t")
        _git(repo, "config", "core.autocrlf", "false")
        spec = repo / ".ai" / "tasks" / "ABC-001" / "task.json"
        spec.parent.mkdir(parents=True)
        spec.write_text(json.dumps(self.SPEC), encoding="utf-8")
        (repo / "backend" / "app").mkdir(parents=True)
        # Bytes throughout: text mode on Windows writes CRLF, and the patch
        # captured in text mode would lose the CRs and no longer apply.
        (repo / "backend" / "app" / "x.py").write_bytes(b"base\n")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "-m", "base")
        return repo

    def apply(self, guard_body: str, repo: Path, patch: str) -> tuple[int, Path]:
        temp = repo.parent / "runner_temp"
        (temp / "result").mkdir(parents=True, exist_ok=True)
        (temp / "result" / "work.patch").write_bytes(patch.encode("utf-8"))
        tools = WORKFLOWS.parents[1]
        code, _ = run_step_body(
            guard_body,
            {
                "RUNNER_TEMP": temp.as_posix(),
                "TASK_ID": "ABC-001",
                "ROLE": "code_agent",
                "TOOLS": tools.as_posix(),
                "AGENTCTL_DATA_ROOT": str(repo),
            },
            repo,
        )
        return code, temp / "changed.txt"

    def diff_of(self, repo: Path, rel: str, content: str) -> str:
        target = repo / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode("utf-8"))
        _git(repo, "add", "-A")
        patch = _git(repo, "diff", "--cached", "--binary", "--no-renames")
        _git(repo, "reset", "-q", "--hard", "HEAD")
        return patch

    def test_work_inside_the_contract_passes(self, guard_body, repo):
        code, changed = self.apply(
            guard_body, repo, self.diff_of(repo, "backend/app/x.py", "new\n")
        )
        assert code == 0
        assert changed.read_text(encoding="utf-8").split() == ["backend/app/x.py"]

    def test_an_empty_patch_passes(self, guard_body, repo):
        code, changed = self.apply(guard_body, repo, "")
        assert code == 0
        assert changed.read_text(encoding="utf-8") == ""

    @pytest.mark.parametrize("rel", [".ai/agentlib/x.py", ".ai/tasks/ABC-001/state.json"])
    def test_nothing_under_ai_passes(self, guard_body, repo, rel):
        code, _ = self.apply(guard_body, repo, self.diff_of(repo, rel, "x\n"))
        assert code != 0, f"{rel} landed"

    def test_a_symlink_is_refused(self, guard_body, repo):
        patch = (
            "diff --git a/backend/app/link b/backend/app/link\n"
            "new file mode 120000\n"
            "index 0000000..1111111\n"
            "--- /dev/null\n"
            "+++ b/backend/app/link\n"
            "@@ -0,0 +1 @@\n"
            "+/etc/passwd\n"
            "\\ No newline at end of file\n"
        )
        code, _ = self.apply(guard_body, repo, patch)
        assert code != 0

    @pytest.mark.parametrize("rel", [".git/hooks/pre-push", "backend/.GIT/config"])
    def test_a_path_inside_a_git_dir_is_refused(self, guard_body, repo, rel):
        patch = (
            f"diff --git a/{rel} b/{rel}\n"
            "new file mode 100644\n"
            "--- /dev/null\n"
            f"+++ b/{rel}\n"
            "@@ -0,0 +1 @@\n"
            "+evil\n"
        )
        code, _ = self.apply(guard_body, repo, patch)
        assert code != 0
        assert not (repo / ".git" / "hooks" / "pre-push").exists()


# --------------------------------------------------------------------------- D3

TEST_AGENT_WF = WORKFLOWS / "test-agent.yml"
GITHUB_DEFAULT_JOB_TIMEOUT = 360


def step_if(chunk: str) -> str:
    """A step's `if:` expression, or "" when it has none. A folded `>-`
    block is joined into one line."""
    lines = chunk.splitlines()
    for i, line in enumerate(lines[1:], start=1):
        stripped = line.strip()
        if stripped.startswith("if:"):
            value = stripped.removeprefix("if:").strip()
            if value in (">-", ">", "|", "|-"):
                indent = len(line) - len(line.lstrip())
                folded = []
                for nxt in lines[i + 1 :]:
                    if nxt.strip() and len(nxt) - len(nxt.lstrip()) <= indent:
                        break
                    folded.append(nxt.strip())
                value = " ".join(f for f in folded if f)
            return value
        if stripped.startswith(("run:", "uses:", "with:", "env:")):
            break
    first = chunk.strip().removeprefix("- ")
    if first.startswith("if:"):
        return first.removeprefix("if:").strip()
    return ""


def titled(block: str) -> dict[str, str]:
    return {step_title(c): c for c in steps_in(block)}


def _timeouts_and_needs(text: str) -> dict[str, tuple[int, list[str]]]:
    jobs: dict[str, tuple[int, list[str]]] = {}
    for name in job_names(text):
        block = job_block(text, name)
        m = re.search(r"^    timeout-minutes:\s*(\d+)", block, flags=re.MULTILINE)
        timeout = int(m.group(1)) if m else GITHUB_DEFAULT_JOB_TIMEOUT
        needs: list[str] = []
        lines = block.splitlines()
        for i, line in enumerate(lines):
            if not line.startswith("    needs:"):
                continue
            rest = line.split(":", 1)[1].strip()
            if rest:
                needs = [n.strip() for n in rest.strip("[]").split(",") if n.strip()]
            else:
                for nxt in lines[i + 1 :]:
                    if not nxt.startswith("      - "):
                        break
                    needs.append(nxt.strip().removeprefix("- ").strip())
        jobs[name] = (timeout, needs)
    return jobs


def longest_chain_minutes(text: str) -> int:
    jobs = _timeouts_and_needs(text)

    def chain(name: str) -> int:
        timeout, needs = jobs[name]
        return timeout + max((chain(n) for n in needs), default=0)

    return max(chain(n) for n in jobs)


class TestEveryDispatchIsPersistedBeforeItIsMade:
    """handoff.md §10, D3 (the race). The orchestrator dispatched the worker,
    and CI, *before* the DISPATCH_* / CI_STARTED transition was committed —
    USERS-002's worker had about four seconds' margin before it would have
    read a state that did not yet say it was running. Now the state is
    advanced, committed AND pushed first, and only then is anything
    dispatched. A dispatch that then fails is recorded, not lost."""

    @pytest.fixture
    def orch_steps(self, orchestrator) -> tuple[list[str], list[str]]:
        chunks = steps_in(job_block(orchestrator, "orchestrate"))
        return [step_title(c) for c in chunks], chunks

    @staticmethod
    def _index(chunks: list[str], needle: str) -> int:
        hits = [i for i, c in enumerate(chunks) if any(needle in ln for ln in live_lines(c))]
        assert len(hits) == 1, f"expected exactly one step running {needle!r}, found {len(hits)}"
        return hits[0]

    @pytest.mark.parametrize("workflow", ["test-agent.yml", "agent-worker.yml"])
    def test_the_state_is_pushed_before_the_dispatch(self, orch_steps, workflow):
        titles, chunks = orch_steps
        dispatch = self._index(chunks, f"gh workflow run {workflow}")
        push = titles.index("Commit the state change")
        assert "git push" in "\n".join(live_lines(chunks[push]))
        assert push < dispatch, f"{workflow} is dispatched before the state is pushed"

    @pytest.mark.parametrize("workflow", ["test-agent.yml", "agent-worker.yml"])
    def test_the_dispatch_step_moves_no_state(self, orch_steps, workflow):
        _, chunks = orch_steps
        body = "\n".join(live_lines(chunks[self._index(chunks, f"gh workflow run {workflow}")]))
        assert "state advance" not in body, "the transition belongs before the push"

    @pytest.mark.parametrize("workflow", ["test-agent.yml", "agent-worker.yml"])
    def test_nothing_is_dispatched_unless_the_push_succeeded(self, orch_steps, workflow):
        _, chunks = orch_steps
        cond = step_if(chunks[self._index(chunks, f"gh workflow run {workflow}")])
        assert "steps.persist.outcome == 'success'" in cond, cond
        assert "steps.premove.outputs.dispatch == 'true'" in cond, cond

    def test_the_transition_is_applied_before_the_push(self, orch_steps):
        titles, chunks = orch_steps
        premove = titles.index("Advance the state before dispatching")
        body = "\n".join(live_lines(chunks[premove]))
        assert "CI_STARTED" in body and '--event "$EVENT"' in body
        assert premove < titles.index("Commit the state change")

    def test_the_state_is_committed_even_after_a_failed_action(self, orch_steps):
        titles, chunks = orch_steps
        cond = step_if(chunks[titles.index("Commit the state change")])
        assert "always()" in cond
        assert "steps.drive.outputs.drive == 'true'" in cond

    def test_a_failed_action_is_escalated_and_committed(self, orch_steps):
        titles, chunks = orch_steps
        failed = titles.index("Escalate an action that failed")
        cond = step_if(chunks[failed])
        assert cond.startswith("always()"), cond
        for sid in ("distill", "premove", "ci", "dispatch", "continue"):
            assert f"steps.{sid}.outcome == 'failure'" in cond, sid
        assert "--event ESCALATE" in "\n".join(live_lines(chunks[failed]))
        commit = titles.index("Commit the escalation")
        assert commit > failed
        assert "always()" in step_if(chunks[commit])
        assert run_bodies(chunks[commit]) == run_bodies(
            chunks[titles.index("Commit the state change")]
        ), "the two commit steps must be one script"

    def test_every_action_step_has_the_id_the_router_reads(self, orch_steps):
        titles, chunks = orch_steps
        ids = {
            "Distil the failure": "distill",
            "Advance the state before dispatching": "premove",
            "Commit the state change": "persist",
            "Run the authoritative test suite": "ci",
            "Dispatch the worker": "dispatch",
            "Continue, when the next step needs no external event": "continue",
            "Escalate an action that failed": "failed",
        }
        for title, sid in ids.items():
            assert f"\n        id: {sid}\n" in chunks[titles.index(title)] + "\n", title

    def test_an_escalating_dispatch_is_not_dispatched(self, orchestrator, tmp_path):
        # The manager's bound: DISPATCH_MANAGER past the ceiling escalates,
        # and then no worker may start.
        body = run_bodies(step(orchestrator, "Advance the state before dispatching"))[0]
        repo = Path(__file__).resolve().parents[2]
        spec = json.loads(
            (repo / ".ai" / "tasks" / "DEMO-001" / "task.json").read_text(encoding="utf-8")
        )
        spec["task_id"] = "DTHREE-001"
        task = tmp_path / ".ai" / "tasks" / "DTHREE-001"
        task.mkdir(parents=True)
        (task / "task.json").write_text(json.dumps(spec), encoding="utf-8")
        from agentlib import state as st

        def premove(manager_invocations: int) -> tuple[int, str, str]:
            s = st.new_state("DTHREE-001", branch="agent/DTHREE-001")
            s.update(state="MANAGER_REVIEW", manager_invocations=manager_invocations)
            st.save_state(task / "state.json", s)
            env = {
                "TOOLS": repo.as_posix(),
                "AGENTCTL_DATA_ROOT": tmp_path.as_posix(),
                "TASK_ID": "DTHREE-001",
                "EVENT": "DISPATCH_MANAGER",
                "KIND": "dispatch_agent",
            }
            code, out = run_step_body(body, env, tmp_path)
            return code, out, st.load_state(task / "state.json")["state"]

        code, out, now = premove(0)
        assert code == 0 and "dispatch=true" in out and now == "MANAGER_REVIEW"
        code, out, now = premove(st.MAX_MANAGER_INVOCATIONS)
        assert code == 0 and "dispatch=false" in out and now == "ESCALATED"


class TestEveryCiConclusionIsRouted:
    """handoff.md §10, D3 (S1, S2). "Apply the CI result" handled success,
    failure and timed_out, and let every other conclusion fall through as
    "nothing to apply": a cancelled run left the task in *_CI forever. The
    mapping now lives in agentlib (`ci-event`), and a result for a paused task
    is discarded with a notice naming its run rather than failing the run."""

    @pytest.fixture
    def ci_step(self, orchestrator) -> str:
        return step(orchestrator, "Apply the CI result")

    def test_no_conclusion_falls_through(self, ci_step):
        body = "\n".join(live_lines(ci_step))
        assert "nothing to apply" not in body
        assert f"{AGENTCTL} ci-event --conclusion" in body

    def test_a_paused_task_discards_the_result_visibly(self, ci_step):
        assert "--discard-if-paused" in ci_step

    def test_the_run_id_is_recorded(self, ci_step):
        assert '--ci-run-id "$RUN_ID"' in ci_step

    def test_d1_still_checks_a_real_verdict_first(self, ci_step):
        body = "\n".join(live_lines(ci_step))
        assert body.index("guard tested") < body.index("state advance")


class TestNoFailureLeavesAWorkerRunning:
    """handoff.md §10, D3 (L1, S5). `land` runs after any `run-model`
    outcome, including a cancelled one or one that died before the model ran,
    and must leave the task out of *_RUNNING every time: the routing steps
    must not inherit an implicit `success()` that a failed telemetry step
    would falsify, and a result that cannot be applied — an unusable manager
    decision, say — is recorded as AGENT_FAILED rather than left unchanged.

    Not covered, because nothing inside a run can cover it: `land` itself
    being cancelled or timing out. That is what `agentctl status`'s STALLED
    is for."""

    @pytest.fixture
    def land(self, worker) -> dict[str, str]:
        return titled(job_block(worker, "land"))

    def test_losing_a_telemetry_record_cannot_lose_the_run(self, land):
        assert "continue-on-error: true" in land["Record what the invocation cost"]

    @pytest.mark.parametrize(
        "name",
        [
            "Stop here if the provider call failed",
            "Escalate a boundary violation",
            "Commit the work",
            "Advance the workflow",
        ],
    )
    def test_routing_does_not_depend_on_earlier_steps_succeeding(self, land, name):
        assert step_if(land[name]).startswith("always() &&"), step_if(land[name])

    def test_a_result_that_cannot_be_applied_is_recorded(self, land):
        assert "\n        id: advance\n" in land["Advance the workflow"] + "\n"
        fallback = land["Record a result that could not be applied"]
        assert step_if(fallback) == "always() && steps.advance.outcome == 'failure'"
        assert "--event AGENT_FAILED" in "\n".join(live_lines(fallback))

    def test_the_fallback_runs_before_the_state_is_committed(self, worker):
        titles = [step_title(c) for c in steps_in(job_block(worker, "land"))]
        assert (
            titles.index("Advance the workflow")
            < titles.index("Record a result that could not be applied")
            < titles.index("Commit state and telemetry")
        )

    def test_every_decision_is_applied_only_from_its_running_state(self, land):
        # S9: MANAGER_RETRY is legal from ESCALATED now, for a human. A
        # manager landing after the task escalated must not reach it.
        body = "\n".join(live_lines(land["Advance the workflow"]))
        assert '--from-state "$FROM"' in body
        assert "FROM=MANAGER_REVIEW" in body

    @pytest.mark.parametrize(
        "agent,download",
        [
            ("cancelled", "success"),
            ("skipped", "failure"),
            ("failure", "success"),
            ("", "failure"),
        ],
    )
    def test_a_model_that_did_not_finish_is_an_agent_failure(
        self, worker, tmp_path, agent, download
    ):
        # S5: a cancelled `run-model`, or one that died before the model ran
        # (the agent step skipped, its outputs empty), lands as AGENT_FAILED.
        body = run_bodies(step(job_block(worker, "land"), "What did the model run amount to?"))[0]
        (tmp_path / "result").mkdir()
        (tmp_path / "result" / "work.patch").write_text("", encoding="utf-8")
        (tmp_path / "result" / "agent-result.json").write_text("{}", encoding="utf-8")
        env = {
            "CLI_CONFIG": "success" if agent else "",
            "AGENT": agent,
            "DOWNLOAD": download,
            "RUNNER_TEMP": tmp_path.as_posix(),
        }
        code, out = run_step_body(body, env, tmp_path)
        assert code == 0
        assert "verdict=failure" in out


class TestStalledMeansPastTheWorkflowsOwnTimeout:
    """handoff.md §10, D3 (detection). `agentctl status` calls a dispatch
    STALLED once it is older than the dispatched workflow can run for. Those
    numbers are copies of the workflows' own timeouts, so they are pinned to
    the YAML here."""

    def test_the_worker_limit_is_its_two_jobs(self, worker):
        from agentlib import state as st

        assert st.DISPATCH_TIMEOUT_MINUTES["agent-worker"] == longest_chain_minutes(worker)

    def test_the_ci_limit_is_test_agents_longest_chain(self):
        from agentlib import state as st

        text = TEST_AGENT_WF.read_text(encoding="utf-8")
        assert st.DISPATCH_TIMEOUT_MINUTES["test-agent"] == longest_chain_minutes(text)


# --------------------------------------------------------------------------- D4

FIXTURES = Path(__file__).resolve().parent / "fixtures"
FAKE_GH = """#!/bin/sh
echo "$*" >> "$FAKE_GH_CALLS"
[ "${FAKE_GH_EXIT:-0}" = 0 ] || exit "$FAKE_GH_EXIT"
for a in "$@"; do
  case "$a" in
    --log-failed) cat "$FAKE_GH_LOG"; exit 0 ;;
    --json) cat "$FAKE_GH_JOBS"; exit 0 ;;
  esac
done
exit 1
"""


class TestTheBaselineIsRedForTheRightReason:
    """handoff.md §10, D4. A failed baseline CI run counted as "red, as
    required" whatever had failed: an audit CVE, openapi drift, an unrelated
    broken test, a tree-scan test tripped by the new test. The code agent,
    which cannot edit tests, then spent its budget on them. Now the step that
    applies a CI result fetches the failed run's jobs and failed-job log first
    and hands both to `agentctl state advance`, which classifies a BASELINE_CI
    failure in agentlib (ciresult.baseline_verdict) before any event is
    applied. The YAML only fetches; the decision is not made here."""

    @pytest.fixture
    def ci_step(self, orchestrator) -> str:
        return step(orchestrator, "Apply the CI result")

    def test_the_log_and_jobs_are_fetched_before_any_event_is_applied(self, ci_step):
        body = "\n".join(live_lines(ci_step))
        advance = body.index("state advance")
        for fetch in ('gh run view "$RUN_ID" --log-failed', 'gh run view "$RUN_ID" --json jobs'):
            assert fetch in body, fetch
            assert body.index(fetch) < advance, f"{fetch} must run before the event is applied"

    def test_the_classifier_gets_both_files(self, ci_step):
        body = "\n".join(live_lines(ci_step))
        after = body[body.index(f"{AGENTCTL} state advance") :]
        assert '"${CI_EVIDENCE[@]}"' in after
        assert 'CI_EVIDENCE=(--ci-jobs "$JOBS" --ci-log "$LOG")' in body

    def test_only_a_failure_is_fetched_for(self, ci_step):
        body = "\n".join(live_lines(ci_step))
        assert 'if [ "$EVENT" = "CI_FAILED" ]; then' in body
        assert body.index('"$EVENT" = "CI_FAILED"') < body.index("--log-failed")

    def test_the_evidence_stays_out_of_the_task_checkout(self, ci_step):
        assert 'JOBS="$RUNNER_TEMP/' in ci_step and 'LOG="$RUNNER_TEMP/' in ci_step

    def test_the_step_can_read_the_run(self, ci_step):
        assert "GH_TOKEN: ${{ github.token }}" in ci_step
        assert "GH_REPO: ${{ github.repository }}" in ci_step

    def test_d1_and_d3_are_untouched(self, ci_step):
        body = "\n".join(live_lines(ci_step))
        assert body.index("guard tested") < body.index("--log-failed")
        assert "--discard-if-paused" in body and "--ignore-terminal" in body

    # The step itself, run against a real branch with a fake `gh`.

    @pytest.fixture
    def branch(self, tmp_path) -> dict:
        if shutil.which("git") is None:
            pytest.skip("git not available")
        repo = Path(__file__).resolve().parents[2]
        root = tmp_path / "task"
        task = root / ".ai" / "tasks" / "DFOUR-001"
        task.mkdir(parents=True)
        spec = json.loads(
            (repo / ".ai" / "tasks" / "DEMO-001" / "task.json").read_text(encoding="utf-8")
        )
        spec["task_id"] = "DFOUR-001"
        (task / "task.json").write_text(json.dumps(spec), encoding="utf-8")
        _git(root, "init", "-q")
        _git(root, "config", "user.email", "t@example.com")
        _git(root, "config", "user.name", "t")
        _git(root, "add", "-A")
        _git(root, "commit", "-q", "-m", "spec")
        new_test = root / "backend" / "tests" / "media" / "test_dev_process_media.py"
        new_test.parent.mkdir(parents=True)
        new_test.write_text("import scripts.dev_process_media\n", encoding="utf-8")
        _git(root, "add", "-A")
        _git(root, "commit", "-q", "-m", "DFOUR-001 test: the new test")
        sha = _git(root, "rev-parse", "HEAD").strip()
        from agentlib import state as st

        s = st.new_state("DFOUR-001", branch="agent/DFOUR-001")
        s["state"] = "BASELINE_CI"
        s["history"] = [
            {
                "at": "2026-10-09T02:42:11Z",
                "from": "TEST_AGENT_RUNNING",
                "to": "TESTS_COMMITTED",
                "event": "AGENT_COMMITTED",
                "note": sha,
            }
        ]
        st.save_state(task / "state.json", s)
        bindir = tmp_path / "bin"
        bindir.mkdir()
        (bindir / "gh").write_text(FAKE_GH, encoding="utf-8", newline="\n")
        (bindir / "gh").chmod(0o755)
        return {"repo": repo, "root": root, "sha": sha, "bin": bindir, "state": task / "state.json"}

    def apply(self, ci_step: str, branch: dict, tmp_path: Path, **over: str) -> tuple[int, dict]:
        from agentlib import state as st

        env = {
            "TOOLS": branch["repo"].as_posix(),
            "AGENTCTL_DATA_ROOT": branch["root"].as_posix(),
            "TASK_ID": "DFOUR-001",
            "CONCLUSION": "failure",
            "RUN_ID": "37875837267",
            "SHA": branch["sha"],
            "RUNNER_TEMP": tmp_path.as_posix(),
            "PATH": str(branch["bin"]) + os.pathsep + os.environ.get("PATH", ""),
            "FAKE_GH_CALLS": (tmp_path / "gh-calls.txt").as_posix(),
            "FAKE_GH_LOG": (FIXTURES / "media002-baseline-failed.log").as_posix(),
            "FAKE_GH_JOBS": (FIXTURES / "media002-baseline-jobs.json").as_posix(),
            **over,
        }
        body = run_bodies(ci_step)[0]
        # The data root is a git checkout; the step runs inside it, as the
        # job's default working directory is the task checkout.
        code, _ = run_step_body(f'cd "$AGENTCTL_DATA_ROOT"\n{body}', env, tmp_path)
        return code, st.load_state(branch["state"])

    def test_media002s_baseline_opens_implementation(self, ci_step, branch, tmp_path):
        code, s = self.apply(ci_step, branch, tmp_path)
        assert code == 0
        assert s["state"] == "READY_FOR_IMPLEMENTATION", s.get("escalation_reason")
        calls = (tmp_path / "gh-calls.txt").read_text(encoding="utf-8")
        assert "37875837267" in calls and "--log-failed" in calls

    def test_a_failed_audit_goes_to_the_manager(self, ci_step, branch, tmp_path):
        ran = json.loads((FIXTURES / "media002-baseline-jobs.json").read_text(encoding="utf-8"))
        for job in ran["jobs"]:
            if job["name"] == "openapi-drift":
                job["conclusion"] = "failure"
        jobs_file = tmp_path / "jobs.json"
        jobs_file.write_text(json.dumps(ran), encoding="utf-8")
        code, s = self.apply(ci_step, branch, tmp_path, FAKE_GH_JOBS=jobs_file.as_posix())
        assert code == 0
        assert s["state"] == "MANAGER_REVIEW"
        assert "openapi-drift" in s["escalation_reason"]

    def test_a_log_that_cannot_be_fetched_fails_closed(self, ci_step, branch, tmp_path):
        code, s = self.apply(ci_step, branch, tmp_path, FAKE_GH_EXIT="1")
        assert code == 0
        assert s["state"] == "MANAGER_REVIEW"

    def test_a_passing_run_fetches_nothing(self, ci_step, branch, tmp_path):
        code, s = self.apply(ci_step, branch, tmp_path, CONCLUSION="success")
        assert code == 0
        assert s["state"] == "MANAGER_REVIEW"  # green baseline: red_baseline_not_red
        assert s["escalation_reason"] == "red_baseline_not_red"
        assert not (tmp_path / "gh-calls.txt").exists()


class TestTheTestJobsAreTestAgentsOwn:
    """handoff.md §10, D4. `ciresult.TEST_JOBS` names the jobs whose failure
    can be the new test's doing, and where each one's suite runs. It is a copy
    of test-agent.yml's job names, so it is pinned to them here. A job added
    to test-agent.yml and not listed counts as a non-test job: the baseline
    then fails closed to the manager, never open to the code agent."""

    @pytest.fixture
    def gate(self) -> str:
        if not TEST_AGENT_WF.exists():
            pytest.skip("test-agent.yml not present")
        return TEST_AGENT_WF.read_text(encoding="utf-8")

    def test_every_test_job_runs_its_compose_suite(self, gate):
        from agentlib import ciresult

        assert set(ciresult.TEST_JOBS) == {"backend-test", "frontend-test"}
        for name, directory in ciresult.TEST_JOBS.items():
            assert name in job_names(gate), name
            assert f"docker compose run --rm {name}" in job_block(gate, name)
            assert directory == name.removesuffix("-test") + "/"

    def test_the_aggregate_is_the_always_running_gate(self, gate):
        from agentlib import ciresult

        assert ciresult.AGGREGATE_JOB == "gate"
        _, needs = _timeouts_and_needs(gate)["gate"]
        assert set(ciresult.TEST_JOBS) <= set(needs)
        assert "if: always()" in job_block(gate, "gate")

    def test_the_suites_run_from_those_directories(self):
        # Pytest and vitest name files relative to where they run. Both
        # images copy one directory to their working directory.
        docker = WORKFLOWS.parents[1] / "docker"
        backend = (docker / "backend.Dockerfile").read_text(encoding="utf-8")
        frontend = (docker / "frontend.Dockerfile").read_text(encoding="utf-8")
        assert "COPY backend/tests ./tests" in backend
        assert "COPY frontend/ ." in frontend


# --------------------------------------------------------------------------- D5

# Every other job test-agent.yml has: neither a test suite nor a static check,
# so a baseline it fails is never the new tests' doing.
NOT_A_CHECK = {
    "changes",
    "agent-infra-test",
    "pip-audit",
    "openapi-drift",
    "npm-audit",
    "infra-synth",
    "gate",
}


class TestTheStaticChecksGateEveryRun:
    """handoff.md §10, D5. CI never type-checked, linted or built the
    frontend and ran no ruff or mypy for the backend: `tsc` first ran in
    deploy.yml, after merge, and hand-run sessions ran the rest by hand, which
    a worker cannot. Now each is a job of test-agent.yml, in the image its
    suite already runs in, required by `gate`, and never skipped on a
    dispatched run.

    One job per tool rather than steps inside backend-test/frontend-test: the
    job name is what `gh run view --log-failed` attributes every line to, and
    what ciresult already reads (D4), so it alone says which tool's output a
    failed log holds; and a red typecheck cannot hide whether lint, or the
    suite, would have passed."""

    @pytest.fixture
    def gate(self) -> str:
        if not TEST_AGENT_WF.exists():
            pytest.skip("test-agent.yml not present")
        return TEST_AGENT_WF.read_text(encoding="utf-8")

    @pytest.mark.parametrize("name", sorted(STATIC_CHECKS))
    def test_the_check_runs_in_its_suites_image(self, gate, name):
        side, command = STATIC_CHECKS[name]
        block = job_block(gate, name)
        assert f"file: docker/{side}.Dockerfile" in block
        assert "target: test" in block
        # The tag compose runs (TestTheGateStaysAuthoritative): without it
        # compose would build its own image, uncached.
        assert f"tags: fanwire-{side}-test:latest" in block
        assert f"cache-from: type=gha,scope={side}-test" in block
        # Reads the suite's cache, never writes it: the suite's job owns it.
        assert "cache-to:" not in block
        # -T: no TTY, so no colour and no pretty-printing in the log the
        # baseline check parses. --no-deps: no database for a static check.
        assert f"docker compose run --rm -T --no-deps {command}" in "\n".join(live_lines(block))

    @pytest.mark.parametrize("name", sorted(STATIC_CHECKS))
    def test_the_check_runs_whenever_its_suite_does(self, gate, name):
        """Keyed on the same `changes` output as its suite, which is `true`
        for every event but a pull request: a dispatched run never skips it."""
        side, _ = STATIC_CHECKS[name]
        block = job_block(gate, name)
        assert "    needs: changes" in block.splitlines()
        assert f"    if: needs.changes.outputs.{side} == 'true'" in block.splitlines()
        assert f"    if: needs.changes.outputs.{side} == 'true'" in job_block(gate, f"{side}-test")

    @pytest.mark.parametrize("name", sorted(STATIC_CHECKS))
    def test_the_gate_requires_the_check(self, gate, name):
        _, needs = _timeouts_and_needs(gate)["gate"]
        assert name in needs

    def test_mypy_checks_the_application_only(self, gate):
        """A test commit only adds tests. Type-checking `tests/` would put
        every new test's import of a not-yet-written module in front of the
        red baseline as a second failure; `app` is what mypy (strict) is for."""
        lines = live_lines(job_block(gate, "backend-mypy"))
        assert [ln for ln in lines if "mypy" in ln] == [
            "docker compose run --rm -T --no-deps " + STATIC_CHECKS["backend-mypy"][1]
        ]

    def test_every_job_is_a_suite_a_check_or_neither(self, gate):
        """ciresult.STATIC_JOBS is a copy of these job names, as TEST_JOBS is
        of the suites'. A job added to test-agent.yml must be placed in one of
        the three, deliberately."""
        from agentlib import ciresult

        assert set(ciresult.STATIC_JOBS) == set(STATIC_CHECKS)
        for name, directory in ciresult.STATIC_JOBS.items():
            assert directory == STATIC_CHECKS[name][0] + "/"
        assert set(job_names(gate)) == set(ciresult.TEST_JOBS) | set(STATIC_CHECKS) | NOT_A_CHECK
        assert ciresult.LINT_JOBS == {"backend-ruff", "frontend-lint"}
        assert ciresult.LINT_JOBS <= set(ciresult.STATIC_JOBS)

    def test_the_images_carry_the_tools(self):
        """No tool is installed by the job: the test images already hold
        them, and the checks run from the directory the suites run from."""
        root = WORKFLOWS.parents[1]
        backend = (root / "docker" / "backend.Dockerfile").read_text(encoding="utf-8")
        frontend = (root / "docker" / "frontend.Dockerfile").read_text(encoding="utf-8")
        test_stage = backend.split("FROM base AS test", 1)[1].split("\nFROM ", 1)[0]
        assert "pip install --no-cache-dir .[dev]" in test_stage
        assert "COPY backend/pyproject.toml ./" in backend  # mypy's and ruff's config
        dev = (root / "backend" / "pyproject.toml").read_text(encoding="utf-8")
        dev = dev.split("dev = [", 1)[1].split("\n]", 1)[0]
        assert '"ruff' in dev and '"mypy' in dev
        assert "RUN npm ci\n" in frontend  # devDependencies included
        package = json.loads((root / "frontend" / "package.json").read_text(encoding="utf-8"))
        assert package["scripts"]["typecheck"].startswith("tsc ")
        assert package["scripts"]["lint"].startswith("eslint ")
        assert {"typescript", "eslint"} <= set(package["devDependencies"])


class TestTheJevSmokeIsDispatchOnly:
    """Prompts/04-cheap-automations.md Deliverable 0, step 4: the merge gate
    for `jev`'s seam is one real 200 with a `confidence` field, from a smoke
    job the human starts. It holds `TYPESAFE_API_KEY`, so nothing but a human's
    dispatch may start it, nothing from a branch may run in it, and it can
    write nothing (work-modes.md "Constraints every automation must keep")."""

    @pytest.fixture
    def smoke(self) -> str:
        assert JEV_SMOKE.exists(), "jev-smoke.yml is missing"
        return JEV_SMOKE.read_text(encoding="utf-8")

    def test_only_a_dispatch_starts_it(self, smoke):
        triggers = smoke.split("\non:\n", 1)[1].split("\n\n", 1)[0]
        assert "workflow_dispatch" in triggers
        for other in ("pull_request", "push", "workflow_run", "schedule", "issue"):
            assert other not in triggers, f"jev-smoke.yml must not run on {other}"

    def test_it_runs_only_on_main(self, smoke):
        """A dispatch names a ref, and that ref's `ask_jev.py` is what runs with
        the key. The job refuses any ref but `main`, so a slip in the
        dispatching command cannot hand a branch's code the key."""
        assert "if: github.ref == 'refs/heads/main'" in job_block(smoke, "smoke")

    def test_it_can_write_nothing(self, smoke):
        assert re.search(r"^permissions:\n  contents: read\n", smoke, re.MULTILINE)
        assert not re.search(r"^\s+[a-z-]+:\s*write\b", smoke, re.MULTILINE)

    def test_the_key_is_held_by_one_step_only(self, smoke):
        assert smoke.count("secrets.TYPESAFE_API_KEY") == 1
        assert "secrets." not in smoke.replace("secrets.TYPESAFE_API_KEY", "")
        assert "github.token" not in smoke
        holder = [s for s in steps_in(job_block(smoke, "smoke")) if "TYPESAFE_API_KEY" in s]
        assert len(holder) == 1 and "ask_jev.py" in holder[0]

    def test_the_checkout_keeps_no_credential(self, smoke):
        assert "actions/checkout@" in smoke
        assert smoke.count("persist-credentials: false") == smoke.count("actions/checkout@")

    def test_it_runs_the_trusted_copy_isolated_and_demands_confidence(self, smoke):
        line = next(ln for ln in live_lines(smoke) if "ask_jev.py" in ln)
        assert line.startswith("python -I ")
        body = " ".join(live_lines(smoke))
        assert "--require-confidence" in body
        assert '--summary "$GITHUB_STEP_SUMMARY"' in body
        assert ".ai/questions/smoke.json" in body


class TestRenovateNeverMergesAnything:
    """Prompts/09-supply-chain-and-trust.md deliverable 3, and philosophy.md
    §8 ("No auto-merge ... this one is load-bearing"): Renovate keeps the
    dependencies and the SHA-pinned actions current, weekly, and a human
    merges every one of its PRs. Plain JSON, so this stdlib test reads it."""

    @pytest.fixture
    def config(self) -> dict:
        assert RENOVATE.exists(), ".github/renovate.json is missing"
        return json.loads(RENOVATE.read_text(encoding="utf-8"))

    @staticmethod
    def _walk(node, path="$"):
        yield path, node
        if isinstance(node, dict):
            for key, value in node.items():
                yield from TestRenovateNeverMergesAnything._walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for i, value in enumerate(node):
                yield from TestRenovateNeverMergesAnything._walk(value, f"{path}[{i}]")

    def test_nothing_turns_automerge_on(self, config):
        """Anywhere: top level, a packageRule, a group, a lockfile setting."""
        on = [
            path
            for path, node in self._walk(config)
            if isinstance(node, dict)
            for key, value in node.items()
            if key.lower().endswith("automerge") and value is True
        ]
        assert not on, f"automerge is on at {on}"
        assert config.get("automerge") is False
        assert config.get("platformAutomerge") is False

    def test_no_preset_brings_automerge_in(self, config):
        presets = [p for p in config.get("extends", []) if "automerge" in p.lower()]
        assert all(p.endswith(":automergeDisabled") for p in presets), presets

    def test_nothing_is_proposed_before_three_days(self, config):
        """A release pulled within days (a compromised publish) never reaches
        a PR. `strict` holds the branch itself back, not just its status."""
        ages = [
            (path, node["minimumReleaseAge"])
            for path, node in self._walk(config)
            if isinstance(node, dict) and "minimumReleaseAge" in node
        ]
        assert any(path == "$" for path, _ in ages), "no top-level minimumReleaseAge"
        for path, age in ages:
            m = re.fullmatch(r"(\d+)\s*(day|days|week|weeks)", age.strip())
            assert m, f"{path}: unreadable minimumReleaseAge {age!r}"
            days = int(m.group(1)) * (7 if m.group(2).startswith("week") else 1)
            assert days >= 3, f"{path}: minimumReleaseAge {age!r} is under 3 days"
        assert config.get("internalChecksFilter") == "strict"

    def test_its_branches_are_not_agent_branches(self, config):
        """`agent/*` is the worker's namespace: the guard would hold such a
        PR against a task spec it does not have, and Renovate is not a worker."""
        prefix = config.get("branchPrefix")
        assert prefix, "branchPrefix must be stated, not left to the default"
        assert not prefix.startswith("agent/")
        for path, node in self._walk(config):
            if isinstance(node, dict) and "branchPrefix" in node:
                assert not node["branchPrefix"].startswith("agent/"), path

    def test_action_pins_stay_pinned(self, config):
        """Deliverable 1 pins every action to a full SHA; this keeps the SHA
        and its `# vN` comment current instead of loosening it to a tag."""
        assert "helpers:pinGitHubActionDigests" in config.get("extends", [])


class TestTheCiSummaryRunsMainsCopyAgainstAFailedRun:
    """Prompts/04-cheap-automations.md automation 1, and the trigger the human
    decided on 2026-10-13: `workflow_run` on `test-agent`, so the workflow and
    the code that run are `main`'s, and the failed run's log is read through
    the API, never by checking out the PR. It holds `ANTHROPIC_API_KEY`, so
    work-modes.md "Constraints every automation must keep" apply: a fork's PR
    gets nothing, nothing from a branch runs where the key is, the key is in
    one step, no event value is pasted into a script, and the job may write a
    comment and nothing else."""

    @pytest.fixture
    def wf(self) -> str:
        assert CI_SUMMARY.exists(), "ci-summary.yml is missing"
        return CI_SUMMARY.read_text(encoding="utf-8")

    def triggers(self, wf: str) -> str:
        return wf.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]

    def test_only_a_finished_test_agent_run_starts_it(self, wf):
        on = self.triggers(wf)
        assert "workflow_run:" in on
        assert re.search(r"workflows:\s*\[\s*test-agent\s*\]", on)
        assert re.search(r"types:\s*\[\s*completed\s*\]", on)
        for other in ("pull_request", "push", "workflow_dispatch", "schedule", "issue"):
            assert other not in on, f"ci-summary.yml must not run on {other}"

    def test_it_runs_only_for_a_failed_pr_run_on_this_repositorys_task_branch(self, wf):
        """Never on `main` (a push run), never for a fork, never for green."""
        cond = " ".join(job_block(wf, "summarize").split("    runs-on:", 1)[0].split())
        for clause in (
            "github.event.workflow_run.conclusion == 'failure'",
            "github.event.workflow_run.event == 'pull_request'",
            "startsWith(github.event.workflow_run.head_branch, 'agent/')",
            "github.event.workflow_run.head_repository.full_name == github.repository",
        ):
            assert clause in cond, f"the job's if: lacks {clause}"
        assert "||" not in cond

    def test_the_token_can_read_and_comment_and_nothing_else(self, wf):
        assert re.search(r"^permissions: \{\}$", wf, re.MULTILINE)
        block = job_block(wf, "summarize")
        perms = block.split("    permissions:\n", 1)[1].split("\n    runs-on", 1)[0]
        granted = dict(
            ln.strip().split(": ", 1) for ln in perms.splitlines() if ln.startswith("      ")
        )
        # actions: read is what reading a run's failed-job log needs.
        assert granted == {"contents": "read", "actions": "read", "pull-requests": "write"}

    def test_no_pr_code_is_checked_out(self, wf):
        """A `workflow_run` job checks out the default branch unless told
        otherwise; naming the run's head would hand the key a branch's code."""
        for chunk in steps_in(job_block(wf, "summarize")):
            if "actions/checkout@" in chunk:
                assert "ref:" not in chunk and "repository:" not in chunk
                assert "persist-credentials: false" in chunk
        assert "head_sha" not in "\n".join(live_lines(job_block(wf, "summarize")))

    def test_the_key_is_held_by_one_step_only_and_that_step_has_no_token(self, wf):
        assert wf.count("secrets.ANTHROPIC_API_KEY") == 1
        assert "secrets." not in wf.replace("secrets.ANTHROPIC_API_KEY", "")
        steps = steps_in(job_block(wf, "summarize"))
        holder = [s for s in steps if "ANTHROPIC_API_KEY" in s]
        assert len(holder) == 1
        assert "ci_summary.py" in holder[0]
        assert "GH_TOKEN" not in holder[0] and "github.token" not in holder[0]

    def test_python_runs_isolated_from_mains_checkout(self, wf):
        for line in live_lines(wf):
            if re.search(r"\bpython3?\b", line):
                assert line.startswith("python -I "), line

    def test_the_comment_is_updated_in_place_from_a_file(self, wf):
        """One comment per PR, found by its marker and by its author, and its
        body read from the file the script wrote, never from an expression."""
        body = "\n".join(live_lines(wf))
        assert "fanwire-ci-summary" in body
        assert "github-actions[bot]" in body
        assert "--method PATCH" in body
        assert "body=@" in body

    def test_the_comment_is_posted_only_if_the_script_wrote_one(self, wf):
        steps = titled(job_block(wf, "summarize"))
        poster = next(c for t, c in steps.items() if "gh api" in c and "PATCH" in c)
        assert "hashFiles(" in step_if(poster) or "-s " in poster


class TestTheCiSummaryIsMarkedFixedWhenCiPasses:
    """On #161 a red run's summary stayed after the fix went green. The
    `mark-fixed` job runs when `test-agent` passes on an `agent/*` PR, and
    edits the summary comment, if there is one, to say so. It calls no model
    and holds no key: it reads the bot's own comment and writes it back."""

    JOB = "mark-fixed"

    @pytest.fixture
    def wf(self) -> str:
        return CI_SUMMARY.read_text(encoding="utf-8")

    def test_it_runs_only_for_a_green_pr_run_on_this_repositorys_task_branch(self, wf):
        cond = " ".join(job_block(wf, self.JOB).split("    runs-on:", 1)[0].split())
        for clause in (
            "github.event.workflow_run.conclusion == 'success'",
            "github.event.workflow_run.event == 'pull_request'",
            "startsWith(github.event.workflow_run.head_branch, 'agent/')",
            "github.event.workflow_run.head_repository.full_name == github.repository",
        ):
            assert clause in cond, f"the job's if: lacks {clause}"
        assert "||" not in cond

    def test_the_token_can_read_and_comment_and_nothing_else(self, wf):
        block = job_block(wf, self.JOB)
        perms = block.split("    permissions:\n", 1)[1].split("\n    runs-on", 1)[0]
        granted = dict(
            ln.strip().split(": ", 1) for ln in perms.splitlines() if ln.startswith("      ")
        )
        assert granted == {"contents": "read", "pull-requests": "write"}

    def test_it_holds_no_key_and_no_secret(self, wf):
        block = job_block(wf, self.JOB)
        assert "secrets." not in block and "ANTHROPIC" not in block

    def test_the_head_sha_is_data_and_no_pr_code_is_checked_out(self, wf):
        for chunk in steps_in(job_block(wf, self.JOB)):
            if "actions/checkout@" in chunk:
                assert "ref:" not in chunk and "repository:" not in chunk
                assert "persist-credentials: false" in chunk
        for line in live_lines(job_block(wf, self.JOB)):
            if "head_sha" in line:
                assert line == "HEAD_SHA: ${{ github.event.workflow_run.head_sha }}", line

    def test_it_only_edits_the_bots_summary_and_never_creates_one(self, wf):
        body = "\n".join(live_lines(job_block(wf, self.JOB)))
        assert "fanwire-ci-summary" in body and "github-actions[bot]" in body
        assert "--method PATCH" in body and "body=@" in body
        assert "--method POST" not in body

    def test_it_runs_the_script_from_mains_copy_isolated(self, wf):
        body = "\n".join(live_lines(job_block(wf, self.JOB)))
        assert "python -I .ai/bin/ci_summary_fixed.py" in body

    def test_it_shares_the_summarys_concurrency_group(self, wf):
        """A red run and a green run on one branch must not edit the comment
        at the same time."""
        group = "group: ci-summary-${{ github.event.workflow_run.head_branch }}"
        assert group in job_block(wf, "summarize") and group in job_block(wf, self.JOB)


class TestTheCoverageCheckRunsMainsCopyAgainstAPrAsData:
    """Prompts/04-cheap-automations.md automation 2, and the trigger the human
    decided on 2026-10-13: `pull_request_target`, so the workflow file and the
    code that run are `main`'s (checked out at the base SHA), and the PR is
    checked out beside them as data that is read and never executed (`python
    -I`, every script from `$TOOLS`). It holds `ANTHROPIC_API_KEY` and
    `TYPESAFE_API_KEY`, so work-modes.md "Constraints every automation must
    keep" apply: a fork's PR gets nothing, each key is in one step and that
    step holds no GitHub token, no event value is pasted into a script, and
    the job may write a comment and nothing else."""

    JOB = "coverage"

    @pytest.fixture
    def wf(self) -> str:
        assert COVERAGE.exists(), "coverage-check.yml is missing"
        return COVERAGE.read_text(encoding="utf-8")

    def triggers(self, wf: str) -> str:
        return wf.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]

    def test_only_an_opened_or_updated_pr_against_main_starts_it(self, wf):
        on = self.triggers(wf)
        assert "pull_request_target:" in on
        assert re.search(r"types:\s*\[\s*opened,\s*synchronize,\s*reopened\s*\]", on)
        assert re.search(r"branches:\s*\[\s*main\s*\]", on)
        bare = on.replace("pull_request_target", "")
        for other in ("pull_request", "push", "workflow_run", "workflow_dispatch", "schedule"):
            assert other not in bare, f"coverage-check.yml must not run on {other}"

    def test_it_runs_only_for_this_repositorys_task_branches(self, wf):
        cond = " ".join(job_block(wf, self.JOB).split("    permissions:", 1)[0].split())
        for clause in (
            "startsWith(github.event.pull_request.head.ref, 'agent/')",
            "github.event.pull_request.head.repo.full_name == github.repository",
        ):
            assert clause in cond, f"the job's if: lacks {clause}"
        assert "||" not in cond

    def test_the_token_can_read_and_comment_and_nothing_else(self, wf):
        assert re.search(r"^permissions: \{\}$", wf, re.MULTILINE)
        block = job_block(wf, self.JOB)
        perms = block.split("    permissions:\n", 1)[1].split("\n    runs-on", 1)[0]
        granted = dict(
            ln.strip().split(": ", 1) for ln in perms.splitlines() if ln.startswith("      ")
        )
        assert granted == {"contents": "read", "pull-requests": "write"}

    def test_the_tools_are_mains_and_the_pr_is_beside_them_as_data(self, wf):
        """Two checkouts, neither keeping a credential: the base SHA at
        `tools/`, the PR's head at `pr/`. Every script runs from `$TOOLS`."""
        checkouts = [s for s in steps_in(job_block(wf, self.JOB)) if "actions/checkout@" in s]
        assert len(checkouts) == 2
        for chunk in checkouts:
            assert "persist-credentials: false" in chunk
        tools = next(c for c in checkouts if "path: tools" in c)
        # github.sha, main's tip when the event fired: the commit the workflow
        # file itself comes from. base.sha is not refreshed on a reopen, so on
        # #155 it loaded tools from before a fix the workflow already had.
        assert "ref: ${{ github.sha }}" in tools
        pr = next(c for c in checkouts if "path: pr" in c)
        assert "ref: ${{ github.event.pull_request.head.sha }}" in pr
        for line in live_lines(wf):
            if re.search(r"\bpython3?\b", line):
                assert line.startswith('python -I "$TOOLS/.ai/bin/'), line

    def test_nothing_from_the_pr_is_executed(self, wf):
        """Reading the PR's files is the whole point; running anything in it
        is what `pull_request_target` must never do."""
        body = "\n".join(live_lines(wf))
        for runner in ("npm ", "npx ", "pip ", "pytest", "make ", "docker ", "bash pr/", "sh pr/"):
            assert runner not in body, f"coverage-check.yml runs {runner.strip()}"
        assert "working-directory: pr" not in wf

    def test_each_key_is_held_by_one_step_and_that_step_has_no_token(self, wf):
        steps = steps_in(job_block(wf, self.JOB))
        rest = wf
        for secret, script in (
            ("ANTHROPIC_API_KEY", "coverage_check.py"),
            ("TYPESAFE_API_KEY", "ask_jev.py"),
        ):
            assert wf.count(f"secrets.{secret}") == 1
            rest = rest.replace(f"secrets.{secret}", "")
            (holder,) = [s for s in steps if secret in s]
            assert script in holder
            assert "GH_TOKEN" not in holder and "github.token" not in holder
        assert "secrets." not in rest
        (both,) = [s for s in steps if "ANTHROPIC_API_KEY" in s]
        assert "TYPESAFE_API_KEY" not in both

    def test_jev_is_shadow_and_never_stops_the_comment(self, wf):
        steps = titled(job_block(wf, self.JOB))
        (jev,) = [c for c in steps.values() if "ask_jev.py" in c]
        assert "continue-on-error: true" in jev
        assert ".ai/questions/coverage.json" in jev

    def test_the_task_id_is_checked_against_the_guards_pattern(self, wf):
        assert f"TASK_ID_SAFE='{TASK_ID_SAFE.pattern}'" in wf
        assert "HEAD_REF: ${{ github.event.pull_request.head.ref }}" in wf

    def test_the_comment_is_updated_in_place_from_a_file(self, wf):
        body = "\n".join(live_lines(wf))
        assert "fanwire-coverage" in body
        assert "github-actions[bot]" in body
        assert "--method PATCH" in body
        assert "body=@" in body

    def test_the_comment_is_posted_only_if_the_script_wrote_one(self, wf):
        steps = titled(job_block(wf, self.JOB))
        poster = next(c for t, c in steps.items() if "gh api" in c and "PATCH" in c)
        assert "hashFiles(" in step_if(poster) or "-s " in poster


class TestTheSpecDriftCheckIsDispatchedOnMain:
    """Prompts/04-cheap-automations.md automation 3, and the trigger the human
    decided on 2026-10-13: `workflow_dispatch` only (`-f task_id=<ID>`),
    reading `main`. A dispatch picks a ref and that ref's code runs with the
    keys, so, as `jev-smoke.yml`, the job refuses every ref but `main`. The
    task id is free text a person typed, so it is checked against the
    guard's pattern before anything uses it. It comments on the task's open
    PR if there is one, so the job may write a PR comment and nothing else."""

    JOB = "drift"

    @pytest.fixture
    def wf(self) -> str:
        assert SPEC_DRIFT.exists(), "spec-drift.yml is missing"
        return SPEC_DRIFT.read_text(encoding="utf-8")

    def triggers(self, wf: str) -> str:
        return wf.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]

    def test_a_dispatch_or_an_opened_pr_starts_it_and_nothing_else(self, wf):
        """The human's decision, 2026-10-16: also run it automatically, once
        per agent/* PR, when the PR is opened. A later push does not re-run
        it: the spec and the code it is checked against are main's."""
        on = self.triggers(wf)
        assert "workflow_dispatch:" in on and "task_id:" in on
        assert "pull_request_target:" in on
        assert re.search(r"types:\s*\[\s*opened\s*\]", on)
        assert "synchronize" not in on and "reopened" not in on
        for other in ("\n  pull_request:", "push:", "workflow_run", "schedule", "issue"):
            assert other not in on, f"spec-drift.yml must not run on {other.strip()}"

    def test_it_runs_only_on_main(self, wf):
        cond = " ".join(job_block(wf, self.JOB).split("    permissions:", 1)[0].split())
        assert "github.ref == 'refs/heads/main'" in cond

    def test_an_opened_pr_counts_only_for_this_repositorys_task_branch(self, wf):
        cond = " ".join(job_block(wf, self.JOB).split("    permissions:", 1)[0].split())
        for clause in (
            "github.event_name == 'workflow_dispatch'",
            "github.event_name == 'pull_request_target'",
            "startsWith(github.event.pull_request.head.ref, 'agent/')",
            "github.event.pull_request.head.repo.full_name == github.repository",
        ):
            assert clause in cond, f"the job's if: lacks {clause}"

    def test_one_check_per_task_whichever_event_started_it(self, wf):
        """A dispatch and an opened PR for one task share one concurrency
        group, so they cannot both create a comment."""
        group = (
            "group: spec-drift-${{ inputs.task_id && format('agent/{0}', inputs.task_id)"
            " || github.event.pull_request.head.ref }}"
        )
        assert group in job_block(wf, self.JOB)

    def test_the_token_can_read_and_comment_and_nothing_else(self, wf):
        assert re.search(r"^permissions: \{\}$", wf, re.MULTILINE)
        block = job_block(wf, self.JOB)
        perms = block.split("    permissions:\n", 1)[1].split("\n    runs-on", 1)[0]
        granted = dict(
            ln.strip().split(": ", 1) for ln in perms.splitlines() if ln.startswith("      ")
        )
        assert granted == {"contents": "read", "pull-requests": "write"}

    def test_the_checkout_is_mains_and_keeps_no_credential(self, wf):
        """No ref: on a dispatch that is main (the job refuses any other),
        and on pull_request_target it is the base branch, main, never the
        PR's head. No branch's code runs with the keys."""
        checkouts = [s for s in steps_in(job_block(wf, self.JOB)) if "actions/checkout@" in s]
        assert len(checkouts) == 1
        assert "ref:" not in checkouts[0] and "repository:" not in checkouts[0]
        assert "persist-credentials: false" in checkouts[0]

    def test_the_task_id_is_checked_and_never_pasted_into_a_script(self, wf):
        assert f"TASK_ID_SAFE='{TASK_ID_SAFE.pattern}'" in wf
        assert "${{ inputs.task_id }}" in wf or "${{ github.event.inputs.task_id }}" in wf
        # On an opened PR the id is the branch name after agent/, which a
        # branch chose: it reaches the shell through env: only.
        assert "HEAD_REF: ${{ github.event.pull_request.head.ref }}" in wf
        for body in run_bodies(wf):
            assert "inputs.task_id" not in body
            assert "github.event" not in body

    def test_each_key_is_held_by_one_step_and_that_step_has_no_token(self, wf):
        steps = steps_in(job_block(wf, self.JOB))
        rest = wf
        for secret, script in (
            ("ANTHROPIC_API_KEY", "spec_drift.py"),
            ("TYPESAFE_API_KEY", "ask_jev.py"),
        ):
            assert wf.count(f"secrets.{secret}") == 1
            rest = rest.replace(f"secrets.{secret}", "")
            (holder,) = [s for s in steps if secret in s]
            assert script in holder
            assert "GH_TOKEN" not in holder and "github.token" not in holder
        assert "secrets." not in rest

    def test_python_runs_isolated(self, wf):
        for line in live_lines(wf):
            if re.search(r"\bpython3?\b", line):
                assert line.startswith("python -I "), line

    def test_jev_is_shadow_and_never_stops_the_report(self, wf):
        steps = titled(job_block(wf, self.JOB))
        (jev,) = [c for c in steps.values() if "ask_jev.py" in c]
        assert "continue-on-error: true" in jev
        assert ".ai/questions/drift.json" in jev

    def test_the_report_is_rendered_even_when_the_model_failed(self, wf):
        """The path and link findings are free and were made before the
        call; a failed call must not hide them from the job summary."""
        steps = titled(job_block(wf, self.JOB))
        (renderer,) = [c for c in steps.values() if "spec_drift.py" in c and " render" in c]
        assert "always()" in step_if(renderer)

    def test_the_comment_goes_only_to_the_tasks_open_pr_updated_in_place(self, wf):
        body = "\n".join(live_lines(wf))
        assert "fanwire-spec-drift" in body
        assert "github-actions[bot]" in body
        assert "--method PATCH" in body and "body=@" in body
        assert "agent/$TASK_ID" in body


class TestTheScorecardIsAdvisoryAndCanOnlyUploadSarif:
    """Prompts/09-supply-chain-and-trust.md deliverable 4: OpenSSF Scorecard,
    weekly, read-only, results to the Security tab, advisory. It runs no
    branch's code and holds no secret; the one write it is given,
    `security-events: write`, is what uploading SARIF needs, and the results
    are not published (`publish_results: false`), so it needs no OIDC token.
    It fails nothing that is required: `gate` does not depend on it."""

    PATH = WORKFLOWS / "scorecard.yml"
    JOB = "analysis"

    @pytest.fixture
    def wf(self) -> str:
        assert self.PATH.exists(), "scorecard.yml is missing"
        return self.PATH.read_text(encoding="utf-8")

    def test_a_schedule_or_a_dispatch_starts_it_and_nothing_from_a_branch(self, wf):
        on = wf.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        triggers = set(re.findall(r"^  ([a-z_]+):", on, re.MULTILINE))
        assert {"schedule", "workflow_dispatch"} <= triggers
        assert triggers <= {"schedule", "workflow_dispatch", "branch_protection_rule"}, triggers
        assert re.search(r"cron:\s*['\"]\d+ \d+ \* \* \d['\"]", on), "weekly, at a fixed minute"
        assert not re.search(r"cron:\s*['\"]0 ", on), "off the hour, not on it"

    def test_the_token_can_upload_sarif_and_nothing_else(self, wf):
        assert re.search(r"^permissions: \{\}$", wf, re.MULTILINE)
        block = job_block(wf, self.JOB)
        perms = block.split("    permissions:\n", 1)[1].split("\n    runs-on", 1)[0]
        granted = dict(
            ln.strip().split(": ", 1) for ln in perms.splitlines() if ln.startswith("      ")
        )
        assert granted == {
            "contents": "read",
            "actions": "read",
            "security-events": "write",
        }
        assert "id-token" not in wf

    def test_it_holds_no_secret(self, wf):
        assert "secrets." not in wf
        assert "github.token" not in wf and "GITHUB_TOKEN" not in wf

    def test_the_checkout_keeps_no_credential(self, wf):
        checkouts = [s for s in steps_in(job_block(wf, self.JOB)) if "actions/checkout@" in s]
        assert len(checkouts) == 1
        assert "persist-credentials: false" in checkouts[0]
        assert "ref:" not in checkouts[0] and "repository:" not in checkouts[0]

    def test_results_are_not_published(self, wf):
        (scan,) = [s for s in steps_in(job_block(wf, self.JOB)) if "ossf/scorecard-action@" in s]
        assert re.search(r"^\s+publish_results: false$", scan, re.MULTILINE)
        assert "github/codeql-action/upload-sarif@" in wf

    def test_the_job_is_bounded(self, wf):
        assert re.search(r"^    timeout-minutes:\s*\d+", job_block(wf, self.JOB), re.MULTILINE)

    def test_it_is_not_part_of_the_required_gate(self, wf):
        gate = TEST_AGENT_WF.read_text(encoding="utf-8")
        _, needs = _timeouts_and_needs(gate)["gate"]
        assert self.JOB not in needs and "scorecard" not in needs
        assert "scorecard" not in gate


class TestTheWikiProposalRunsMainsCopyAfterAMerge:
    """Prompts/04-cheap-automations.md automation 4, and the trigger and
    output the human decided on 2026-10-13: `pull_request_target`, closed and
    merged, and (a) a comment on the merged PR holding a patch the human
    applies by hand. So the job writes a comment and nothing else: no
    `contents: write`, no push, no branch. A model-written diff must never
    land on a branch that is not `agent/*` (`permissions.md`), and here it
    lands on no branch at all. The tools are `main`'s, the merged commit is
    checked out beside them as data, and `ANTHROPIC_API_KEY` is in one
    token-free step."""

    JOB = "propose"

    @pytest.fixture
    def wf(self) -> str:
        assert WIKI_PROPOSAL.exists(), "wiki-proposal.yml is missing"
        return WIKI_PROPOSAL.read_text(encoding="utf-8")

    def triggers(self, wf: str) -> str:
        return wf.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]

    def test_only_a_closed_pr_against_main_starts_it(self, wf):
        on = self.triggers(wf)
        assert "pull_request_target:" in on
        assert re.search(r"types:\s*\[\s*closed\s*\]", on)
        assert re.search(r"branches:\s*\[\s*main\s*\]", on)
        bare = on.replace("pull_request_target", "")
        for other in ("pull_request", "push", "workflow_run", "workflow_dispatch", "schedule"):
            assert other not in bare, f"wiki-proposal.yml must not run on {other}"

    def test_it_runs_only_for_a_merged_task_branch_of_this_repository(self, wf):
        cond = " ".join(job_block(wf, self.JOB).split("    permissions:", 1)[0].split())
        for clause in (
            "github.event.pull_request.merged == true",
            "startsWith(github.event.pull_request.head.ref, 'agent/')",
            "github.event.pull_request.head.repo.full_name == github.repository",
        ):
            assert clause in cond, f"the job's if: lacks {clause}"
        assert "||" not in cond

    def test_the_token_can_read_and_comment_and_nothing_else(self, wf):
        assert re.search(r"^permissions: \{\}$", wf, re.MULTILINE)
        block = job_block(wf, self.JOB)
        perms = block.split("    permissions:\n", 1)[1].split("\n    runs-on", 1)[0]
        granted = dict(
            ln.strip().split(": ", 1) for ln in perms.splitlines() if ln.startswith("      ")
        )
        assert granted == {"contents": "read", "pull-requests": "write"}
        body = "\n".join(live_lines(wf))
        for verb in ("git push", "git commit", "gh pr create", "git checkout -b", "git switch"):
            assert verb not in body, f"wiki-proposal.yml must not {verb}"

    def test_the_tools_are_mains_and_the_merge_is_beside_them_as_data(self, wf):
        checkouts = [s for s in steps_in(job_block(wf, self.JOB)) if "actions/checkout@" in s]
        assert len(checkouts) == 2
        for chunk in checkouts:
            assert "persist-credentials: false" in chunk
        tools = next(c for c in checkouts if "path: tools" in c)
        # github.sha, main's tip when the merge event fired, as for coverage:
        # base.sha can predate fixes the workflow file already has.
        assert "ref: ${{ github.sha }}" in tools
        merged = next(c for c in checkouts if "path: merged" in c)
        assert "ref: ${{ github.event.pull_request.merge_commit_sha }}" in merged
        for line in live_lines(wf):
            if re.search(r"\bpython3?\b", line):
                assert line.startswith('python -I "$TOOLS/.ai/bin/'), line

    def test_nothing_from_the_merge_is_executed(self, wf):
        body = "\n".join(live_lines(wf))
        for runner in ("npm ", "npx ", "pip ", "pytest", "make ", "docker ", "bash merged/"):
            assert runner not in body, f"wiki-proposal.yml runs {runner.strip()}"
        assert "working-directory: merged" not in wf

    def test_the_key_is_held_by_one_step_only_and_that_step_has_no_token(self, wf):
        assert wf.count("secrets.ANTHROPIC_API_KEY") == 1
        assert "secrets." not in wf.replace("secrets.ANTHROPIC_API_KEY", "")
        steps = steps_in(job_block(wf, self.JOB))
        (holder,) = [s for s in steps if "ANTHROPIC_API_KEY" in s]
        assert "wiki_proposal.py" in holder
        assert "GH_TOKEN" not in holder and "github.token" not in holder

    def test_the_task_id_is_checked_against_the_guards_pattern(self, wf):
        assert f"TASK_ID_SAFE='{TASK_ID_SAFE.pattern}'" in wf
        assert "HEAD_REF: ${{ github.event.pull_request.head.ref }}" in wf

    def test_the_comment_is_updated_in_place_from_a_file(self, wf):
        body = "\n".join(live_lines(wf))
        assert "fanwire-wiki-proposal" in body
        assert "github-actions[bot]" in body
        assert "--method PATCH" in body and "body=@" in body

    def test_the_comment_is_posted_only_if_the_script_wrote_one(self, wf):
        steps = titled(job_block(wf, self.JOB))
        poster = next(c for t, c in steps.items() if "gh api" in c and "PATCH" in c)
        assert "hashFiles(" in step_if(poster) or "-s " in poster


DIRECTOR_REVIEW = WORKFLOWS / "director-review.yml"


class TestTheDirectorReviewReadsADirectorPrAsData:
    """Prompts/09-supply-chain-and-trust.md deliverable 5. A Director PR is
    reviewed by the one human who directed it and merges through the admin
    bypass, so an advisory model reads every non-`agent/*` PR of this
    repository that touches `.ai/` or `.github/` and lists safety regressions
    against philosophy §4's grades. `pull_request_target`, so the workflow
    file and the code that run are `main`'s (`github.sha` at `tools/`), and
    the PR is checked out beside them as data whose diff is read and nothing
    in it executed. It holds `ANTHROPIC_API_KEY`, so work-modes.md
    "Constraints every automation must keep" apply, and it fails nothing:
    it is not under `gate`, and its own failure is not the PR's."""

    JOB = "review"
    CHECKOUT = "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5"
    SETUP_PYTHON = "actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1 # v6"

    @pytest.fixture
    def wf(self) -> str:
        assert DIRECTOR_REVIEW.exists(), "director-review.yml is missing"
        return DIRECTOR_REVIEW.read_text(encoding="utf-8")

    def triggers(self, wf: str) -> str:
        return wf.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]

    def test_only_a_pr_against_main_touching_the_system_trees_starts_it(self, wf):
        on = self.triggers(wf)
        assert "pull_request_target:" in on
        assert re.search(r"types:\s*\[\s*opened,\s*synchronize,\s*reopened\s*\]", on)
        assert re.search(r"branches:\s*\[\s*main\s*\]", on)
        assert re.search(r'paths:\s*\[\s*"\.ai/\*\*",\s*"\.github/\*\*"\s*\]', on)
        bare = on.replace("pull_request_target", "")
        for other in ("pull_request", "push", "workflow_run", "workflow_dispatch", "schedule"):
            assert other not in bare, f"director-review.yml must not run on {other}"

    def test_it_runs_only_for_a_human_non_task_branch_of_this_repository(self, wf):
        """A fork's PR gets nothing; an `agent/*` PR is a worker's, held by
        the guard and read by the other automations; a bot's PR (Renovate)
        is not a Director's change, and the human can approve it for real."""
        cond = " ".join(job_block(wf, self.JOB).split("    permissions:", 1)[0].split())
        for clause in (
            "github.event.pull_request.head.repo.full_name == github.repository",
            "!startsWith(github.event.pull_request.head.ref, 'agent/')",
            "github.event.pull_request.user.type != 'Bot'",
        ):
            assert clause in cond, f"the job's if: lacks {clause}"
        assert "||" not in cond

    def test_the_token_can_read_and_comment_and_nothing_else(self, wf):
        assert re.search(r"^permissions: \{\}$", wf, re.MULTILINE)
        block = job_block(wf, self.JOB)
        perms = block.split("    permissions:\n", 1)[1].split("\n    runs-on", 1)[0]
        granted = dict(
            ln.strip().split(": ", 1) for ln in perms.splitlines() if ln.startswith("      ")
        )
        assert granted == {"contents": "read", "pull-requests": "write"}
        body = "\n".join(live_lines(wf))
        for verb in ("git push", "git commit", "gh pr create", "gh pr merge", "gh pr review"):
            assert verb not in body, f"director-review.yml must not {verb}"

    def test_the_job_is_bounded(self, wf):
        assert re.search(r"^    timeout-minutes:\s*\d+", job_block(wf, self.JOB), re.MULTILINE)

    def test_every_action_is_pinned_to_a_full_sha(self, wf):
        uses = [
            ln.split("uses:", 1)[1].strip()
            for ln in wf.splitlines()
            if "uses:" in ln and not ln.lstrip().startswith("#")
        ]
        assert uses and set(uses) <= {self.CHECKOUT, self.SETUP_PYTHON}

    def test_the_tools_are_mains_and_the_pr_is_beside_them_as_data(self, wf):
        checkouts = [s for s in steps_in(job_block(wf, self.JOB)) if "actions/checkout@" in s]
        assert len(checkouts) == 2
        for chunk in checkouts:
            assert "persist-credentials: false" in chunk
        tools = next(c for c in checkouts if "path: tools" in c)
        # github.sha, main's tip, as for coverage-check: base.sha is not
        # refreshed on a reopen and can predate fixes the workflow file has.
        assert "ref: ${{ github.sha }}" in tools
        pr = next(c for c in checkouts if "path: pr" in c)
        assert "ref: ${{ github.event.pull_request.head.sha }}" in pr
        for line in live_lines(wf):
            if re.search(r"\bpython3?\b", line):
                assert line.startswith('python -I "$TOOLS/.ai/bin/'), line

    def test_nothing_from_the_pr_is_executed(self, wf):
        body = "\n".join(live_lines(wf))
        for runner in ("npm ", "npx ", "pip ", "pytest", "make ", "docker ", "bash pr/", "sh pr/"):
            assert runner not in body, f"director-review.yml runs {runner.strip()}"
        assert "working-directory: pr" not in wf

    def test_the_diff_is_taken_with_no_credential_and_no_repo_driver(self, wf):
        """The diff step holds neither the key nor the token. A branch can
        set `.gitattributes`, so external diff drivers and textconv are off,
        and `--text` keeps a `-diff` attribute from hiding a change."""
        steps = titled(job_block(wf, self.JOB))
        (taker,) = [c for c in steps.values() if "git -C pr diff" in c]
        for flag in ("--no-ext-diff", "--no-textconv", "--text", "--no-renames"):
            assert flag in taker
        assert '"$BASE_SHA...$HEAD_SHA"' in taker
        assert "secrets." not in taker and "GH_TOKEN" not in taker and "github.token" not in taker

    def test_the_key_is_held_by_one_step_only_and_that_step_has_no_token(self, wf):
        assert wf.count("secrets.ANTHROPIC_API_KEY") == 1
        assert "secrets." not in wf.replace("secrets.ANTHROPIC_API_KEY", "")
        steps = steps_in(job_block(wf, self.JOB))
        (holder,) = [s for s in steps if "ANTHROPIC_API_KEY" in s]
        assert "director_review.py" in holder
        assert "GH_TOKEN" not in holder and "github.token" not in holder

    def test_no_expression_is_pasted_into_a_script(self, wf):
        """Every value, the event's and the model's, reaches a script through
        `env:` or a file (D2)."""
        for body in run_bodies(wf):
            assert "${{" not in body, body

    def test_a_failure_is_never_the_prs(self, wf):
        """Fail quiet: the call and the post may fail without failing the
        job, and nothing here is under `gate`, so a required check never
        waits on a model."""
        steps = titled(job_block(wf, self.JOB))
        (asker,) = [c for c in steps.values() if "director_review.py" in c]
        poster = next(c for c in steps.values() if "gh api" in c and "PATCH" in c)
        for chunk in (asker, poster):
            assert "continue-on-error: true" in chunk
        gate = (WORKFLOWS / "test-agent.yml").read_text(encoding="utf-8")
        assert "director" not in job_block(gate, "gate")
        assert "director-review" not in gate

    def test_the_comment_is_updated_in_place_from_a_file(self, wf):
        body = "\n".join(live_lines(wf))
        assert "fanwire-director-review" in body
        assert "github-actions[bot]" in body
        assert "--method PATCH" in body and "body=@" in body

    def test_the_comment_is_posted_only_if_the_script_wrote_one(self, wf):
        steps = titled(job_block(wf, self.JOB))
        poster = next(c for t, c in steps.items() if "gh api" in c and "PATCH" in c)
        assert "hashFiles(" in step_if(poster) or "-s " in poster

    def test_the_header_says_what_only_a_live_run_proves(self, wf):
        header = wf.split("\non:\n", 1)[0]
        assert "only a live run proves" in header
        assert "first live run" in header
