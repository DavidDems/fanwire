"""The typed-decision contract.

A System One model guarantees its answer is inside the declared option set.
These tests assume that guarantee will be broken anyway — by a mocked
endpoint, a replayed response, a version skew, or a plain bug — and pin the
behaviour that matters: an answer this module cannot verify never reaches the
workflow, and every gate fails in the direction that costs a human a minute
rather than the direction that costs a task its retry budget.
"""

import json
from pathlib import Path

import pytest

from agentlib import decision as dec

QUESTIONS_DIR = Path(__file__).resolve().parents[1] / "questions"

CHOICE_DOC = {
    "questions": {
        "verdict": {
            "type": "choice",
            "instructions": "pick one",
            "criteria": {"yes": "affirmative", "no": "negative"},
        }
    },
    "gates": {"verdict": {"min_confidence": 0.7, "fallback": "no"}},
}


class TestParse:
    def test_reads_an_answers_mapping(self, tmp_path):
        p = tmp_path / "a.json"
        p.write_text(json.dumps({"answers": {"k": {"choice": "yes"}}}), encoding="utf-8")
        assert dec.parse(p) == {"k": {"choice": "yes"}}

    def test_accepts_a_bare_mapping_without_the_envelope(self, tmp_path):
        p = tmp_path / "a.json"
        p.write_text(json.dumps({"k": {"choice": "yes"}}), encoding="utf-8")
        assert dec.parse(p)["k"]["choice"] == "yes"

    @pytest.mark.parametrize("body", ["not json at all", "[1, 2, 3]", '"a string"'])
    def test_unreadable_content_degrades_to_empty(self, tmp_path, body):
        p = tmp_path / "a.json"
        p.write_text(body, encoding="utf-8")
        assert dec.parse(p) == {}

    def test_a_missing_file_degrades_to_empty(self, tmp_path):
        assert dec.parse(tmp_path / "nope.json") == {}


class TestChoiceGate:
    def test_a_confident_declared_option_is_used(self):
        answers = {"v": {"choice": "yes", "confidence": 0.9}}
        assert dec.choice(answers, "v", {"yes", "no"}, fallback="no") == ("yes", 0.9)

    def test_low_confidence_falls_back(self):
        answers = {"v": {"choice": "yes", "confidence": 0.4}}
        value, confidence = dec.choice(answers, "v", {"yes", "no"}, fallback="no")
        assert value == "no"
        # The real confidence is still reported, so telemetry can show how
        # close the call was rather than just that a fallback happened.
        assert confidence == 0.4

    def test_an_undeclared_option_is_refused_however_confident(self):
        """The wire is not the boundary. This module is."""
        answers = {"v": {"choice": "maybe", "confidence": 1.0}}
        assert dec.choice(answers, "v", {"yes", "no"}, fallback="no")[0] == "no"

    def test_a_missing_confidence_is_zero_not_a_default(self):
        answers = {"v": {"choice": "yes"}}
        assert dec.choice(answers, "v", {"yes", "no"}, fallback="no") == ("no", 0.0)

    @pytest.mark.parametrize("answer", [None, "yes", 42, [], {"choice": 1}])
    def test_malformed_answers_fall_back(self, answer):
        assert dec.choice({"v": answer}, "v", {"yes"}, fallback="no")[0] == "no"

    def test_confidence_is_clamped_into_range(self):
        answers = {"v": {"choice": "yes", "confidence": 4.2}}
        assert dec.choice(answers, "v", {"yes"}, fallback="no") == ("yes", 1.0)

    def test_a_boolean_confidence_is_not_a_number(self):
        """`True` is an int in Python. It is not a calibrated confidence."""
        answers = {"v": {"choice": "yes", "confidence": True}}
        assert dec.choice(answers, "v", {"yes"}, fallback="no") == ("no", 0.0)


class TestNoul:
    def test_probability_and_confidence_are_gated_separately(self):
        """A confident 0.5 means 'a genuine coin flip', not 'no idea'."""
        answers = {"v": {"noul": 0.9, "confidence": 0.95}}
        assert dec.noul(answers, "v", fallback=False) == (True, 0.95)

        # High probability, low confidence: the model is guessing.
        answers = {"v": {"noul": 0.9, "confidence": 0.2}}
        assert dec.noul(answers, "v", fallback=False)[0] is False

    def test_threshold_is_respected(self):
        answers = {"v": {"noul": 0.4, "confidence": 0.99}}
        assert dec.noul(answers, "v", fallback=True)[0] is False

    def test_a_boolean_probability_is_refused(self):
        answers = {"v": {"noul": True, "confidence": 0.99}}
        assert dec.noul(answers, "v", fallback=False)[0] is False


class TestScore:
    def test_a_level_outside_the_scale_falls_back(self):
        answers = {"v": {"score": "excellent", "confidence": 1.0}}
        scale = ("testable", "underspecified")
        assert dec.score(answers, "v", scale, fallback="underspecified")[0] == "underspecified"


class TestQuestionValidation:
    """Malformed questions must fail loudly — this half is a repository bug."""

    def test_a_valid_document_has_no_problems(self):
        assert dec.validate_questions(CHOICE_DOC) == []

    def test_an_unknown_question_type_is_caught(self):
        doc = {"questions": {"v": {"type": "vibes", "instructions": "hm"}}}
        assert any("vibes" in p for p in dec.validate_questions(doc))

    def test_a_choice_needs_at_least_two_options(self):
        doc = {"questions": {"v": {"type": "choice", "instructions": "x", "criteria": {"a": "b"}}}}
        assert any("at least 2" in p for p in dec.validate_questions(doc))

    def test_a_gate_naming_no_question_is_caught(self):
        doc = {**CHOICE_DOC, "gates": {"nonexistent": {"fallback": "no"}}}
        assert any("nonexistent" in p for p in dec.validate_questions(doc))

    def test_a_fallback_outside_the_option_set_is_caught(self):
        """The dangerous typo: only reachable on the rarely-exercised path."""
        doc = {**CHOICE_DOC, "gates": {"verdict": {"fallback": "mabye"}}}
        assert any("mabye" in p for p in dec.validate_questions(doc))

    def test_a_noul_gate_needs_a_boolean_fallback(self):
        doc = {
            "questions": {"v": {"type": "noul", "instructions": "x"}},
            "gates": {"v": {"fallback": "yes"}},
        }
        assert any("true or false" in p for p in dec.validate_questions(doc))

    @pytest.mark.parametrize("threshold", [-0.1, 1.5, "high", None])
    def test_an_out_of_range_threshold_is_caught(self, threshold):
        doc = {**CHOICE_DOC, "gates": {"verdict": {"fallback": "no", "min_confidence": threshold}}}
        assert any("min_confidence" in p for p in dec.validate_questions(doc))

    def test_load_raises_on_a_malformed_file(self, tmp_path):
        p = tmp_path / "q.json"
        p.write_text(json.dumps({"questions": {}}), encoding="utf-8")
        with pytest.raises(dec.QuestionError):
            dec.load_questions(p)


class TestCommittedQuestions:
    """Every questions file in the repository must be loadable and gated.

    `agentctl selfcheck` runs the same check, so a typo cannot reach a
    workflow step. This pins it in the suite as well, because the failure it
    prevents is silent: a bad gate only shows up on a low-confidence answer.
    """

    @pytest.mark.parametrize("path", sorted(QUESTIONS_DIR.glob("*.json")), ids=lambda p: p.name)
    def test_it_loads_and_validates(self, path):
        doc = dec.load_questions(path)
        assert doc["questions"], f"{path.name} declares no questions"

    @pytest.mark.parametrize("path", sorted(QUESTIONS_DIR.glob("*.json")), ids=lambda p: p.name)
    def test_every_question_has_a_gate(self, path):
        """An ungated question silently uses the default threshold."""
        doc = dec.load_questions(path)
        ungated = set(doc["questions"]) - set(doc.get("gates", {}))
        assert not ungated, f"{path.name}: no gate declared for {sorted(ungated)}"

    def test_the_four_expected_decision_points_exist(self):
        names = {p.stem for p in QUESTIONS_DIR.glob("*.json")}
        assert names == {"manager", "distiller", "flake", "spec-readiness"}


class TestManagerOutcome:
    def setup_method(self):
        self.doc = dec.load_questions(QUESTIONS_DIR / "manager.json")

    def _answers(self, verdict, confidence=0.95, differ=0.95):
        return {
            "decision": {"choice": verdict, "confidence": confidence},
            "retry_would_differ": {"noul": differ, "confidence": 0.9},
        }

    def test_a_confident_supported_retry_is_allowed(self):
        out = dec.manager_outcome(self.doc, self._answers("MANAGER_RETRY"))
        assert out["decision"] == "MANAGER_RETRY"
        assert out["needs_prose"] is False

    def test_a_retry_with_nothing_new_is_downgraded_to_escalate(self):
        """A model can be sure retrying is right and still point at nothing."""
        out = dec.manager_outcome(self.doc, self._answers("MANAGER_RETRY", differ=0.05))
        assert out["decision"] == "ESCALATE"
        assert out["downgraded_to_escalate"] is True
        assert "nothing that would make the next attempt differ" in out["reason"]

    def test_a_low_confidence_decision_escalates(self):
        out = dec.manager_outcome(self.doc, self._answers("MANAGER_RESCOPE", confidence=0.3))
        assert out["decision"] == "ESCALATE"
        assert out["confidence"] == 0.3

    def test_no_answer_at_all_escalates(self):
        out = dec.manager_outcome(self.doc, {})
        assert out["decision"] == "ESCALATE"
        assert out["needs_prose"] is True
        assert "no usable decision" in out["reason"]

    def test_only_escalation_asks_for_prose(self):
        for verdict in ("MANAGER_RETRY", "MANAGER_RESCOPE"):
            out = dec.manager_outcome(self.doc, self._answers(verdict))
            assert out["needs_prose"] is False, verdict
            assert out["reason"], "a templated reason is still required"

    def test_a_forged_decision_cannot_reach_the_workflow(self):
        answers = {"decision": {"choice": "MERGE_TO_MAIN", "confidence": 1.0}}
        assert dec.manager_outcome(self.doc, answers)["decision"] == "ESCALATE"


class TestFlakeOutcome:
    def setup_method(self):
        self.doc = dec.load_questions(QUESTIONS_DIR / "flake.json")

    def test_a_confident_novel_flake_earns_a_free_rerun(self):
        answers = {
            "reproducibility": {"choice": "flake", "confidence": 0.95},
            "same_failure_as_last_attempt": {"noul": 0.05, "confidence": 0.9},
        }
        assert dec.flake_outcome(self.doc, answers)["free_rerun"] is True

    def test_a_repeated_failure_is_never_a_free_rerun(self):
        """However flaky it looks, a failure that already reproduced is real."""
        answers = {
            "reproducibility": {"choice": "flake", "confidence": 0.99},
            "same_failure_as_last_attempt": {"noul": 0.99, "confidence": 0.95},
        }
        assert dec.flake_outcome(self.doc, answers)["free_rerun"] is False

    def test_the_gate_is_strict_enough_to_refuse_a_merely_likely_flake(self):
        answers = {
            "reproducibility": {"choice": "flake", "confidence": 0.75},
            "same_failure_as_last_attempt": {"noul": 0.05, "confidence": 0.9},
        }
        out = dec.flake_outcome(self.doc, answers)
        assert out["reproducibility"] == "deterministic"
        assert out["free_rerun"] is False

    def test_silence_costs_an_attempt_rather_than_looping(self):
        out = dec.flake_outcome(self.doc, {})
        assert out["reproducibility"] == "deterministic"
        assert out["free_rerun"] is False


class TestSpecOutcome:
    def setup_method(self):
        self.doc = dec.load_questions(QUESTIONS_DIR / "spec-readiness.json")

    def test_only_untestable_blocks_dispatch(self):
        answers = {"testability": {"score": "untestable", "confidence": 0.9}}
        assert dec.spec_outcome(self.doc, answers)["blocks_dispatch"] is True

    def test_underspecified_warns_but_lets_the_task_run(self):
        answers = {"testability": {"score": "underspecified", "confidence": 0.9}}
        out = dec.spec_outcome(self.doc, answers)
        assert out["blocks_dispatch"] is False
        assert out["warns"] is True

    def test_a_silent_provider_never_blocks_a_task(self):
        """A new gate that can stop every task is worse than what it prevents."""
        out = dec.spec_outcome(self.doc, {})
        assert out["blocks_dispatch"] is False
        assert out["testability"] == "underspecified"
