"""Deterministic CI-log distillation.

Extracting *which* tests failed and *what kind* of failure it was is parsing,
not reasoning — a script does it, so no model is billed for it. A model is only
ever asked to add prose interpretation on top (see `.ai/docs/architecture.md`,
"Distiller: script first, model second").
"""

import json
from pathlib import Path

import pytest

from agentlib import ciresult

PYTEST_LOG = """
=================================== FAILURES ===================================
____________________ test_refresh_token_reuse_is_rejected ______________________
    def test_refresh_token_reuse_is_rejected(client):
>       assert response.status_code == 401
E       assert 200 == 401
backend/tests/users/test_auth.py:88: AssertionError
_________________________ test_profile_picture_resize __________________________
E       TypeError: resize() missing 1 required positional argument: 'size'
backend/app/media/pipeline.py:141: TypeError
=========================== short test summary info ============================
FAILED backend/tests/users/test_auth.py::test_refresh_token_reuse_is_rejected - assert 200 == 401
FAILED backend/tests/media/test_pipeline.py::test_profile_picture_resize - TypeError: resize() missing 1 required positional argument
========================= 2 failed, 418 passed in 31.02s =========================
"""

COLLECTION_ERROR_LOG = """
=================================== ERRORS ====================================
_______________ ERROR collecting backend/tests/users/test_new.py _______________
ImportError while importing test module 'backend/tests/users/test_new.py'.
E   ModuleNotFoundError: No module named 'app.users.tokens'
=========================== short test summary info ============================
ERROR backend/tests/users/test_new.py
============================== 1 error in 0.40s ================================
"""

JEST_LOG = """
 FAIL  src/components/Feed.test.tsx
  ● Feed › renders an empty state

    expect(element).toBeInTheDocument()

      at Object.<anonymous> (src/components/Feed.test.tsx:24:31)

Tests:       1 failed, 12 passed, 13 total
"""


class TestPytestParsing:
    def test_extracts_every_failed_test_id(self):
        r = ciresult.distill(PYTEST_LOG, ci_status="failure", task_id="DEMO-001", attempt=2)
        names = [f["test"] for f in r["failures"]]
        assert "backend/tests/users/test_auth.py::test_refresh_token_reuse_is_rejected" in names
        assert "backend/tests/media/test_pipeline.py::test_profile_picture_resize" in names

    def test_classifies_an_assertion_failure(self):
        r = ciresult.distill(PYTEST_LOG, ci_status="failure", task_id="DEMO-001", attempt=1)
        by_name = {f["test"]: f for f in r["failures"]}
        auth = by_name["backend/tests/users/test_auth.py::test_refresh_token_reuse_is_rejected"]
        assert auth["category"] == "assertion_failure"

    def test_classifies_an_exception_failure(self):
        r = ciresult.distill(PYTEST_LOG, ci_status="failure", task_id="DEMO-001", attempt=1)
        by_name = {f["test"]: f for f in r["failures"]}
        media = by_name["backend/tests/media/test_pipeline.py::test_profile_picture_resize"]
        assert media["category"] == "exception"

    def test_reports_relevant_files(self):
        r = ciresult.distill(PYTEST_LOG, ci_status="failure", task_id="DEMO-001", attempt=1)
        assert "backend/tests/users/test_auth.py" in r["relevant_files"]
        assert "backend/app/media/pipeline.py" in r["relevant_files"]

    def test_counts_are_carried_through(self):
        r = ciresult.distill(PYTEST_LOG, ci_status="failure", task_id="DEMO-001", attempt=1)
        assert r["failed_count"] == 2


class TestOriginClassification:
    def test_assertion_failures_read_as_implementation_problems(self):
        r = ciresult.distill(PYTEST_LOG, ci_status="failure", task_id="D-001", attempt=1)
        assert r["origin"] == "implementation"

    def test_import_and_collection_errors_read_as_test_problems(self):
        r = ciresult.distill(COLLECTION_ERROR_LOG, ci_status="failure", task_id="D-001", attempt=1)
        assert r["origin"] == "test"
        assert r["failures"][0]["category"] == "collection_error"

    def test_runner_level_breakage_reads_as_infrastructure(self):
        log = "docker: Error response from daemon: pull access denied for fanwire-backend"
        r = ciresult.distill(log, ci_status="failure", task_id="D-001", attempt=1)
        assert r["origin"] == "infrastructure"

    def test_unparseable_failure_is_ambiguous_not_guessed(self):
        r = ciresult.distill(
            "something went wrong", ci_status="failure", task_id="D-001", attempt=1
        )
        assert r["origin"] == "ambiguous"
        assert r["failures"] == []


class TestJestParsing:
    def test_extracts_a_jest_failure(self):
        r = ciresult.distill(JEST_LOG, ci_status="failure", task_id="D-001", attempt=1)
        assert r["failures"][0]["test"] == "Feed › renders an empty state"
        assert "src/components/Feed.test.tsx" in r["relevant_files"]


class TestSchema:
    def test_output_is_the_documented_shape(self):
        r = ciresult.distill(PYTEST_LOG, ci_status="failure", task_id="AUTH-017", attempt=2)
        assert r["task_id"] == "AUTH-017"
        assert r["attempt"] == 2
        assert r["status"] == "failed"
        assert r["schema"] == ciresult.SCHEMA_VERSION
        for f in r["failures"]:
            assert set(f) == {"test", "category", "summary", "file"}

    def test_a_passing_run_distils_to_an_empty_result(self):
        r = ciresult.distill("", ci_status="success", task_id="D-001", attempt=1)
        assert r["status"] == "passed"
        assert r["failures"] == []
        assert r["origin"] is None

    def test_output_is_bounded_so_it_cannot_flood_a_prompt(self):
        flood = "\n".join(
            f"FAILED backend/tests/t.py::test_{i} - assert 0 == 1" for i in range(500)
        )
        r = ciresult.distill(flood, ci_status="failure", task_id="D-001", attempt=1)
        assert len(r["failures"]) <= ciresult.MAX_FAILURES
        assert r["truncated"] is True
        assert r["failed_count"] == 500


# --------------------------------------------------------------------------- D4

FIXTURES = Path(__file__).resolve().parent / "fixtures"
MEDIA002_TEST = "backend/tests/media/test_dev_process_media.py"
BADGE_TEST = "frontend/src/components/Badge.test.tsx"


def gh_log(job: str, *lines: str) -> str:
    """Lines as `gh run view --log-failed` prints them: job, step, timestamp."""
    return "".join(f"{job}\tRun the suite\t2026-10-09T02:43:32.7442492Z {ln}\n" for ln in lines)


def jobs(**conclusions: str) -> dict:
    """`gh run view --json jobs` for every job test-agent.yml has; the named
    ones (underscores for dashes) get the given conclusion, the rest pass."""
    names = (
        "changes",
        "backend-test",
        "frontend-test",
        "agent-infra-test",
        "pip-audit",
        "openapi-drift",
        "npm-audit",
        "infra-synth",
        "gate",
    )
    given = {k.replace("_", "-"): v for k, v in conclusions.items()}
    return {
        "jobs": [
            {"name": n, "status": "completed", "conclusion": given.get(n, "success")} for n in names
        ]
    }


PYTEST_FAILED = (
    "=========================== short test summary info ============================",
    "FAILED tests/media/test_dev_process_media.py::test_refuses_production - assert 1 == 0",
    "FAILED tests/media/test_dev_process_media.py::test_processes_pending - KeyError: 'x'",
    "========================= 2 failed, 509 passed in 31.02s =========================",
)

VITEST_SUITE_FAILED = (
    "> fanwire-frontend@0.0.0 test",
    "> vitest run",
    " RUN  v4.1.11 /app",
    " ❯ src/components/Badge.test.tsx (0 test)",
    "⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯",
    " FAIL  src/components/Badge.test.tsx [ src/components/Badge.test.tsx ]",
    (
        'Error: Failed to resolve import "./Badge" from "src/components/Badge.test.tsx".'
        " Does the file exist?"
    ),
    "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
    " Test Files  1 failed | 52 passed (53)",
    "      Tests  410 passed (410)",
)

VITEST_TEST_FAILED = (
    "⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯",
    " FAIL  src/components/Badge.test.tsx > Badge > renders the label",
    "AssertionError: expected null to be truthy",
    " FAIL  src/test/tree-scan.test.ts > every component has a test",
    "AssertionError: expected [ 'Badge' ] to deeply equal []",
    " Test Files  2 failed | 51 passed (53)",
    "      Tests  2 failed | 408 passed (410)",
)


def media002() -> tuple[str, dict]:
    """The first real task's baseline, CI run 37875837267: only backend-test
    and gate failed, on an ImportError in the new test file itself. The log is
    the run's real `--log-failed` output with the image pull trimmed out."""
    log = (FIXTURES / "media002-baseline-failed.log").read_text(encoding="utf-8")
    ran = json.loads((FIXTURES / "media002-baseline-jobs.json").read_text(encoding="utf-8"))
    return log, ran


class TestBaselineRedForTheRightReason:
    """handoff.md §10, D4. The red baseline used to accept red for any reason:
    dispatched CI runs every suite, so a CVE in `pip-audit`, `openapi-drift`,
    an unrelated broken test, or a tree-scan test tripped by the new test all
    counted as "red, as required" -- and then the code agent, which cannot edit
    tests, spent its budget on them. Now the baseline is red for the right
    reason only when every failed job is a test job (the aggregate `gate`
    aside) and every failing test is in a file the test commit changed.
    Anything else, including a log nothing could be read from, is not."""

    def test_media002s_collection_error_is_red_for_the_right_reason(self):
        log, ran = media002()
        v = ciresult.baseline_verdict(log, ran, {MEDIA002_TEST})
        assert v["right_reason"] is True, v["reason"]
        assert v["failures"] == [{"job": "backend-test", "file": MEDIA002_TEST}]

    def test_the_same_red_is_wrong_if_the_test_commit_did_not_touch_that_file(self):
        log, ran = media002()
        v = ciresult.baseline_verdict(log, ran, {"backend/tests/media/test_other.py"})
        assert v["right_reason"] is False
        assert MEDIA002_TEST in v["reason"]

    @pytest.mark.parametrize("job", ["pip-audit", "openapi-drift", "npm-audit", "infra-synth"])
    def test_a_non_test_job_failing_is_the_wrong_reason(self, job):
        log, _ = media002()
        ran = jobs(backend_test="failure", gate="failure", **{job.replace("-", "_"): "failure"})
        v = ciresult.baseline_verdict(log, ran, {MEDIA002_TEST})
        assert v["right_reason"] is False
        assert job in v["reason"]

    def test_the_agent_suite_is_not_a_test_job(self):
        # A test agent cannot write `.ai/`; that suite failing is never the
        # new test's doing.
        log, _ = media002()
        ran = jobs(backend_test="failure", agent_infra_test="failure", gate="failure")
        v = ciresult.baseline_verdict(log, ran, {MEDIA002_TEST})
        assert v["right_reason"] is False
        assert "agent-infra-test" in v["reason"]

    def test_a_failure_in_a_file_the_test_commit_did_not_touch_is_the_wrong_reason(self):
        # The tree-scan shape: the new test trips a different test file.
        log = gh_log(
            "backend-test",
            "=========================== short test summary info ============================",
            "FAILED tests/media/test_dev_process_media.py::test_a - assert 1 == 0",
            "FAILED tests/test_tree_scan.py::test_every_module_documented - assert False",
            "========================= 2 failed, 509 passed in 31.02s =========================",
        )
        v = ciresult.baseline_verdict(
            log, jobs(backend_test="failure", gate="failure"), {MEDIA002_TEST}
        )
        assert v["right_reason"] is False
        assert "backend/tests/test_tree_scan.py" in v["reason"]

    def test_assertion_failures_in_the_test_commits_file_are_the_right_reason(self):
        log = gh_log("backend-test", *PYTEST_FAILED)
        v = ciresult.baseline_verdict(
            log, jobs(backend_test="failure", gate="failure"), {MEDIA002_TEST}
        )
        assert v["right_reason"] is True, v["reason"]

    def test_more_failures_counted_than_named_is_the_wrong_reason(self):
        # A truncated log: the tally says three, the summary names two.
        lines = (*PYTEST_FAILED[:-1], "============= 3 failed, 508 passed in 31.02s =============")
        v = ciresult.baseline_verdict(
            gh_log("backend-test", *lines),
            jobs(backend_test="failure", gate="failure"),
            {MEDIA002_TEST},
        )
        assert v["right_reason"] is False

    @pytest.mark.parametrize(
        "log",
        [
            "",
            gh_log("backend-test", "something went wrong"),
            gh_log("backend-test", "ImportError while loading conftest '/var/task/tests/x.py'."),
            # Not `gh run view --log-failed` output: nothing to attribute to a job.
            "\n".join(PYTEST_FAILED),
        ],
        ids=["empty", "no-summary", "conftest-crash", "unattributed"],
    )
    def test_a_log_nothing_can_be_read_from_is_the_wrong_reason(self, log):
        v = ciresult.baseline_verdict(
            log, jobs(backend_test="failure", gate="failure"), {MEDIA002_TEST}
        )
        assert v["right_reason"] is False
        assert v["reason"]

    @pytest.mark.parametrize("ran", [None, {}, {"jobs": []}, {"jobs": "x"}, [], "x"])
    def test_no_readable_job_list_is_the_wrong_reason(self, ran):
        log, _ = media002()
        v = ciresult.baseline_verdict(log, ran, {MEDIA002_TEST})
        assert v["right_reason"] is False

    def test_the_gate_failing_alone_is_the_wrong_reason(self):
        v = ciresult.baseline_verdict("", jobs(gate="failure"), {MEDIA002_TEST})
        assert v["right_reason"] is False

    @pytest.mark.parametrize("conclusion", ["cancelled", "timed_out", "skipped"])
    def test_a_test_job_that_did_not_fail_outright_is_not_red(self, conclusion):
        log, _ = media002()
        v = ciresult.baseline_verdict(
            log, jobs(backend_test=conclusion, gate="failure"), {MEDIA002_TEST}
        )
        assert v["right_reason"] is False

    def test_no_test_commit_files_is_the_wrong_reason(self):
        log, ran = media002()
        assert ciresult.baseline_verdict(log, ran, set())["right_reason"] is False

    def test_a_vitest_suite_that_cannot_import_is_the_right_reason(self):
        log = gh_log("frontend-test", *VITEST_SUITE_FAILED)
        v = ciresult.baseline_verdict(
            log, jobs(frontend_test="failure", gate="failure"), {BADGE_TEST}
        )
        assert v["right_reason"] is True, v["reason"]
        assert v["failures"] == [{"job": "frontend-test", "file": BADGE_TEST}]

    def test_a_vitest_failure_outside_the_test_commit_is_the_wrong_reason(self):
        log = gh_log("frontend-test", *VITEST_TEST_FAILED)
        v = ciresult.baseline_verdict(
            log, jobs(frontend_test="failure", gate="failure"), {BADGE_TEST}
        )
        assert v["right_reason"] is False
        assert "frontend/src/test/tree-scan.test.ts" in v["reason"]

    def test_vitest_unhandled_errors_are_the_wrong_reason(self):
        # Vitest cannot say which file an unhandled error came from.
        lines = (*VITEST_SUITE_FAILED, "      Errors  1 error")
        v = ciresult.baseline_verdict(
            gh_log("frontend-test", *lines),
            jobs(frontend_test="failure", gate="failure"),
            {BADGE_TEST},
        )
        assert v["right_reason"] is False

    def test_both_suites_red_in_the_test_commits_files_is_the_right_reason(self):
        log = gh_log("backend-test", *PYTEST_FAILED) + gh_log("frontend-test", *VITEST_SUITE_FAILED)
        v = ciresult.baseline_verdict(
            log,
            jobs(backend_test="failure", frontend_test="failure", gate="failure"),
            {MEDIA002_TEST, BADGE_TEST},
        )
        assert v["right_reason"] is True, v["reason"]

    def test_a_suite_red_in_the_wrong_job_is_not_counted(self):
        # A pytest summary inside the gate's log names no test job's failure.
        log = gh_log("gate", *PYTEST_FAILED)
        v = ciresult.baseline_verdict(
            log, jobs(backend_test="failure", gate="failure"), {MEDIA002_TEST}
        )
        assert v["right_reason"] is False

    def test_the_reason_is_bounded(self):
        lines = [f"FAILED tests/t{i}.py::test_x - assert 0" for i in range(300)]
        log = gh_log("backend-test", *lines, "=== 300 failed in 1.00s ===")
        v = ciresult.baseline_verdict(log, jobs(backend_test="failure"), {MEDIA002_TEST})
        assert v["right_reason"] is False
        assert len(v["reason"]) <= ciresult.MAX_REASON_CHARS


class TestDistillReadsTheRealLogFormat:
    """handoff.md §10, D4, found on the way. `gh run view --log-failed`
    prefixes every line with the job, the step and a timestamp, so distil's
    line-anchored patterns matched nothing in a real log and every real
    failure distilled to `ambiguous`."""

    def test_media002s_log_distils_to_a_collection_error(self):
        log, _ = media002()
        r = ciresult.distill(log, ci_status="failure", task_id="MEDIA-002", attempt=0)
        assert r["origin"] == "test"
        assert r["failures"][0]["file"] == "tests/media/test_dev_process_media.py"
