"""Structural invariants of the agent workflows.

Plain text checks, no YAML parser — `.ai/` stays stdlib-only. These pin
properties that unit tests cannot see because they live in workflow YAML, and
every one of them is here because it broke a live run.
"""

from pathlib import Path

import pytest

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
WORKER = WORKFLOWS / "agent-worker.yml"
ORCHESTRATOR = WORKFLOWS / "agent-orchestrator.yml"


@pytest.fixture
def worker() -> str:
    if not WORKER.exists():
        pytest.skip("agent-worker.yml not present")
    return WORKER.read_text(encoding="utf-8")


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


class TestNoWorkflowCanMerge:
    """Nothing in the system may merge its own work."""

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR])
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

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR])
    def test_no_workflow_approves_a_pull_request(self, path):
        if not path.exists():
            pytest.skip(f"{path.name} not present")
        text = path.read_text(encoding="utf-8")
        assert "gh pr review" not in text
        assert "--approve" not in text


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


class TestEveryJobIsBounded:
    """A run with no `timeout-minutes` inherits GitHub's 6-hour default. The
    orchestrator holds its task's concurrency group for as long as it runs, and
    GitHub keeps only one pending run per group — so one hung orchestrator
    drops transitions and stalls the task for the rest of the day."""

    @pytest.mark.parametrize("path", [WORKER, ORCHESTRATOR])
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
