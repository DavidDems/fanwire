"""Deterministic CI-log distillation.

Extracting *which* tests failed and *what kind* of failure it was is parsing,
not reasoning — a script does it, so no model is billed for it. A model is only
ever asked to add prose interpretation on top (see `.ai/docs/architecture.md`,
"Distiller: script first, model second").
"""

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
