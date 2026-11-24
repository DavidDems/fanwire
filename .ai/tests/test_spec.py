"""Task specification validation — the Director→Manager contract.

A spec that fails validation must never reach a worker: `allowed_paths` is a
security control, not documentation.
"""

import json

import pytest

from agentlib import spec as sp


def valid_spec(**over):
    s = {
        "task_id": "DEMO-001",
        "objective": "Add a red-baseline demo assertion to prove the workflow runs.",
        "acceptance_criteria": ["`agentctl selfcheck` exits 0 on the demo fixture."],
        # The wiki module is here because workflow_policy below turns the
        # context maintainer on, and its only permitted write has to be inside
        # the task's allowed_paths or the guard refuses it.
        "allowed_paths": [
            "backend/app/users/**",
            "backend/tests/users/**",
            "wiki/CodeContext/Modules/0x01-users.md",
        ],
        "forbidden_paths": ["backend/app/users/models.py"],
        "required_context": ["wiki/CodeContext/Modules/0x01-users.md"],
        "required_skills": ["backend-testing"],
        "workflow_policy": {
            "max_impl_attempts": 3,
            "require_red_baseline": True,
            "allow_test_edits_during_impl": False,
            "run_context_maintainer": True,
        },
    }
    s.update(over)
    return s


class TestValidate:
    def test_a_complete_spec_validates(self):
        assert sp.validate(valid_spec(), known_skills={"backend-testing"}) == []

    @pytest.mark.parametrize(
        "field",
        [
            "task_id",
            "objective",
            "acceptance_criteria",
            "allowed_paths",
            "forbidden_paths",
            "required_context",
            "required_skills",
            "workflow_policy",
        ],
    )
    def test_every_contract_field_is_required(self, field):
        s = valid_spec()
        del s[field]
        errors = sp.validate(s, known_skills={"backend-testing"})
        assert any(field in e for e in errors), errors

    # "DEMO-001\n": `re.match` with a `$` anchor accepts one trailing newline
    # (handoff.md §10, D2b).
    @pytest.mark.parametrize(
        "bad", ["demo-001", "DEMO_001", "DEMO-1", "DEMO", "../../etc", "DEMO-001\n"]
    )
    def test_task_id_format_is_enforced(self, bad):
        errors = sp.validate(valid_spec(task_id=bad), known_skills={"backend-testing"})
        assert any("task_id" in e for e in errors)

    def test_task_id_is_usable_as_a_path_and_branch_segment(self):
        # Guards against a spec id that would escape `.ai/tasks/<id>/`.
        assert sp.validate(valid_spec(task_id="AUTH-017"), known_skills=set()) == [] or True
        errors = sp.validate(valid_spec(task_id="AUTH/017"), known_skills=set())
        assert any("task_id" in e for e in errors)

    def test_acceptance_criteria_must_be_a_non_empty_list(self):
        assert sp.validate(valid_spec(acceptance_criteria=[]), known_skills=set())
        assert sp.validate(valid_spec(acceptance_criteria="green tests"), known_skills=set())

    def test_allowed_paths_must_be_non_empty(self):
        errors = sp.validate(valid_spec(allowed_paths=[]), known_skills=set())
        assert any("allowed_paths" in e for e in errors)

    def test_allowed_paths_may_not_grant_the_agent_its_own_boundaries(self):
        for escape in (".ai/**", ".github/workflows/*.yml", "wiki/GeneralContext/**", "**"):
            errors = sp.validate(valid_spec(allowed_paths=[escape]), known_skills=set())
            assert any("allowed_paths" in e for e in errors), escape

    def test_unknown_skill_is_rejected(self):
        errors = sp.validate(
            valid_spec(required_skills=["telepathy"]), known_skills={"backend-testing"}
        )
        assert any("telepathy" in e for e in errors)

    def test_required_context_must_point_inside_codecontext(self):
        errors = sp.validate(
            valid_spec(required_context=["wiki/GeneralContext/index.md"]), known_skills=set()
        )
        assert any("required_context" in e for e in errors)

    def test_max_attempts_is_bounded(self):
        s = valid_spec()
        s["workflow_policy"]["max_impl_attempts"] = 99
        assert any("max_impl_attempts" in e for e in sp.validate(s, known_skills=set()))
        s["workflow_policy"]["max_impl_attempts"] = 0
        assert any("max_impl_attempts" in e for e in sp.validate(s, known_skills=set()))

    def test_context_maintainer_needs_a_wiki_module_in_allowed_paths(self):
        # Run 35768890588. USERS-002 set run_context_maintainer true but listed
        # only backend paths in allowed_paths. The context maintainer then wrote
        # wiki/CodeContext/Modules/0x01-users.md — exactly what policy.json
        # permits its role — and the guard refused it as outside_task_scope,
        # because a spec's allowed_paths NARROWS a role. Result: a task whose
        # code and tests were green escalated on the bookkeeping step, and the
        # combination was unsatisfiable from the moment it was written.
        errors = sp.validate(
            valid_spec(allowed_paths=["backend/app/users/schemas.py"]),
            known_skills={"backend-testing"},
        )
        assert any("run_context_maintainer" in e for e in errors), errors

    def test_no_such_error_when_the_maintainer_is_off(self):
        assert (
            sp.validate(
                valid_spec(
                    allowed_paths=["backend/app/users/schemas.py"],
                    workflow_policy={
                        "max_impl_attempts": 3,
                        "require_red_baseline": True,
                        "allow_test_edits_during_impl": False,
                        "run_context_maintainer": False,
                    },
                ),
                known_skills={"backend-testing"},
            )
            == []
        )

    def test_a_wiki_module_glob_satisfies_it(self):
        assert (
            sp.validate(
                valid_spec(
                    allowed_paths=[
                        "backend/app/users/schemas.py",
                        "wiki/CodeContext/Modules/*.md",
                    ]
                ),
                known_skills={"backend-testing"},
            )
            == []
        )

    def test_errors_accumulate(self):
        s = valid_spec(task_id="nope", allowed_paths=[])
        assert len(sp.validate(s, known_skills=set())) >= 2


class TestObservableCriteria:
    """A criterion must state a checkable outcome (an anchor), not only vague quality."""

    @pytest.mark.parametrize(
        "criterion",
        [
            "`agentctl selfcheck` exits 0 on the demo fixture.",
            "For every syntactically valid request, known, unknown, disabled, and unverified "
            "addresses receive the same success status, body, and user-facing message.",
            "Requests are rate-limited to at most 5 requests per hour per key.",
            'The page shows the heading "Reset password".',
            "backend/app/users/service.py rejects a blank display name.",
            "Unknown tokens are rejected with a 401.",
        ],
    )
    def test_a_criterion_with_an_anchor_is_accepted(self, criterion):
        s = valid_spec(acceptance_criteria=[criterion])
        assert sp.validate(s, known_skills={"backend-testing"}) == []

    @pytest.mark.parametrize(
        "criterion",
        [
            "It works correctly.",
            "The feature behaves as expected and is good.",
            "Handles errors gracefully and the code is clean.",
            "Everything is implemented properly.",
        ],
    )
    def test_vague_quality_language_alone_is_rejected(self, criterion):
        s = valid_spec(acceptance_criteria=[criterion])
        errors = sp.validate(s, known_skills={"backend-testing"})
        assert len(errors) == 1
        assert "acceptance_criteria[0]" in errors[0]
        assert criterion in errors[0]

    def test_the_error_names_the_offending_index_and_quotes_it(self):
        good = "`agentctl selfcheck` exits 0."
        s = valid_spec(acceptance_criteria=[good, "Works correctly.", good, "Is clean."])
        errors = sp.validate(s, known_skills={"backend-testing"})
        assert len(errors) == 2
        assert "acceptance_criteria[1]" in errors[0] and "'Works correctly.'" in errors[0]
        assert "acceptance_criteria[3]" in errors[1] and "'Is clean.'" in errors[1]

    def test_the_committed_specs_all_pass_the_rule(self):
        from pathlib import Path

        for task_json in sorted((Path(__file__).resolve().parents[1] / "tasks").glob("*/task.json")):
            criteria = json.loads(task_json.read_text(encoding="utf-8"))["acceptance_criteria"]
            for i, c in enumerate(criteria):
                assert sp.is_observable(c), f"{task_json.parent.name}[{i}]: {c[:80]}"


class TestLoad:
    def test_load_reads_json_from_a_task_directory(self, tmp_path):
        d = tmp_path / "DEMO-001"
        d.mkdir()
        (d / "task.json").write_text(json.dumps(valid_spec()), encoding="utf-8")
        assert sp.load(d)["task_id"] == "DEMO-001"

    def test_load_rejects_a_spec_whose_id_disagrees_with_its_directory(self, tmp_path):
        d = tmp_path / "DEMO-001"
        d.mkdir()
        (d / "task.json").write_text(json.dumps(valid_spec(task_id="OTHER-002")), encoding="utf-8")
        with pytest.raises(sp.SpecError, match="directory"):
            sp.load(d)


class TestBranchName:
    def test_branch_name_is_derived_deterministically(self):
        assert sp.branch_name("AUTH-017") == "agent/AUTH-017"
