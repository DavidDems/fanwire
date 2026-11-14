"""The typed-decision contract, against the wire shape TypeSafe documents.

`wiki/GeneralContext/Architecture/work-modes.md` "Cheap automation": `jev`
answers narrow typed questions, and `Prompts/04-cheap-automations.md`
Deliverable 0 brings its seam back to `main` from #41. #41 was written before
any call had returned 200, and two of its guesses about the response were
wrong. The documented shape (docs.typesafe.ai, checked 2026-10-13):

    choice  {"type": "choice", "choice": "<option>", "confidence": c,
             "probabilities": {"<option>": p, ...}}
    score   {"type": "score", "score": 1.43, "confidence": c,
             "legend": {"0": "...", ...}, "probabilities": {"0": p, ...}}
    noul    {"type": "noul", "noul": 0.99}            <- no confidence

#41 read a `score` as the level's name and gated a `noul` on a confidence
it never gets, so both always fell back. These tests pin the real shape.

Shadow mode acts on no answer, so there are no confidence gates here: an
accessor returns what came back, or None, and the caller records it.
"""

import json

import pytest

from agentlib import decision

CHOICE = {
    "type": "choice",
    "choice": "yes",
    "confidence": 0.91,
    "probabilities": {"yes": 0.95, "no": 0.05},
}
SCORE = {
    "type": "score",
    "score": 1.43,
    "confidence": 0.4,
    "legend": {"0": "low", "1": "mid", "2": "high"},
    "probabilities": {"0": 0.07, "1": 0.43, "2": 0.5},
}
NOUL = {"type": "noul", "noul": 0.99}


def questions_doc() -> dict:
    return {
        "schema": 1,
        "_comment": "local only",
        "questions": {
            "pinned": {
                "type": "choice",
                "instructions": "Is every criterion pinned?",
                "criteria": {"yes": "all pinned", "no": "at least one is not"},
                "_why": "local only",
            },
            "grade": {
                "type": "score",
                "instructions": "How well?",
                "criteria": ["low", "mid", "high"],
            },
            "urgent": {"type": "noul", "instructions": "It is urgent"},
        },
    }


class TestReadingAChoice:
    def test_an_allowed_choice_comes_back_with_its_confidence(self):
        assert decision.choice({"pinned": CHOICE}, "pinned", {"yes", "no"}) == ("yes", 0.91)

    def test_an_option_outside_the_allowlist_is_none(self):
        """The wire is not the boundary: a mocked or wrong endpoint can send
        anything, so the caller's option set is re-checked here."""
        answer = dict(CHOICE, choice="maybe")
        assert decision.choice({"pinned": answer}, "pinned", {"yes", "no"}) == (None, 0.91)

    def test_a_missing_answer_is_none_with_zero_confidence(self):
        assert decision.choice({}, "pinned", {"yes", "no"}) == (None, 0.0)

    @pytest.mark.parametrize("raw", [None, "0.9", True, [0.9]])
    def test_an_unreadable_confidence_is_zero(self, raw):
        answer = dict(CHOICE, confidence=raw)
        assert decision.choice({"pinned": answer}, "pinned", {"yes", "no"}) == ("yes", 0.0)

    def test_confidence_is_clamped_to_the_unit_interval(self):
        answer = dict(CHOICE, confidence=1.7)
        assert decision.choice({"pinned": answer}, "pinned", {"yes", "no"})[1] == 1.0


class TestReadingAScore:
    def test_the_level_is_the_most_probable_one_not_the_rounded_score(self):
        """1.43 rounds to level 1, but the probabilities put most weight on
        level 2. The probabilities are what the model said; `score` is their
        mean."""
        assert decision.score({"grade": SCORE}, "grade", ["low", "mid", "high"]) == ("high", 0.4)

    def test_without_probabilities_the_rounded_score_names_the_level(self):
        answer = {"type": "score", "score": 1.43, "confidence": 0.4}
        assert decision.score({"grade": answer}, "grade", ["low", "mid", "high"]) == ("mid", 0.4)

    def test_a_level_index_off_the_scale_is_none(self):
        answer = {"type": "score", "score": 7, "confidence": 0.4}
        assert decision.score({"grade": answer}, "grade", ["low", "mid", "high"]) == (None, 0.4)

    def test_a_missing_answer_is_none(self):
        assert decision.score({}, "grade", ["low", "high"]) == (None, 0.0)


class TestReadingANoul:
    def test_the_probability_comes_back_as_is(self):
        assert decision.noul({"urgent": NOUL}, "urgent") == 0.99

    @pytest.mark.parametrize("raw", [None, "0.5", True, 1.5, -0.1])
    def test_anything_but_a_probability_is_none(self, raw):
        assert decision.noul({"urgent": {"type": "noul", "noul": raw}}, "urgent") is None


class TestEveryAnswerCarriesWhatItShould:
    """The merge gate (Prompts/04 Deliverable 0, step 4) is one real 200 with
    a `confidence` field. A noul is documented without one, so it is checked
    for its probability instead."""

    def test_a_complete_response_has_nothing_missing(self):
        answers = {"pinned": CHOICE, "grade": SCORE, "urgent": NOUL}
        assert decision.missing_fields(questions_doc(), answers) == []

    def test_a_choice_without_confidence_is_reported(self):
        answers = {"pinned": dict(CHOICE, confidence=None), "grade": SCORE, "urgent": NOUL}
        assert decision.missing_fields(questions_doc(), answers) == ["pinned"]

    def test_a_question_with_no_answer_is_reported(self):
        assert decision.missing_fields(questions_doc(), {"pinned": CHOICE}) == ["grade", "urgent"]

    def test_a_noul_without_a_probability_is_reported(self):
        answers = {"pinned": CHOICE, "grade": SCORE, "urgent": {"type": "noul"}}
        assert decision.missing_fields(questions_doc(), answers) == ["urgent"]


class TestQuestionsFiles:
    def test_a_valid_file_loads(self, tmp_path):
        p = tmp_path / "q.json"
        p.write_text(json.dumps(questions_doc()), encoding="utf-8")
        assert set(decision.load_questions(p)["questions"]) == {"pinned", "grade", "urgent"}

    @pytest.mark.parametrize(
        "mutate, fragment",
        [
            (lambda d: d["questions"]["pinned"].update(type="yesno"), "type"),
            (lambda d: d["questions"]["pinned"].update(instructions=""), "instructions"),
            (lambda d: d["questions"]["pinned"].update(criteria={"yes": "only one"}), "criteria"),
            (lambda d: d["questions"]["grade"].update(criteria=["one"]), "criteria"),
            (lambda d: d["questions"]["grade"].update(criteria=[str(i) for i in range(11)]), "10"),
            (lambda d: d.update(questions={}), "questions"),
        ],
    )
    def test_every_structural_problem_is_reported(self, mutate, fragment):
        doc = questions_doc()
        mutate(doc)
        problems = decision.validate_questions(doc)
        assert problems and any(fragment in p for p in problems), problems

    def test_a_malformed_file_raises(self, tmp_path):
        p = tmp_path / "q.json"
        p.write_text("{not json", encoding="utf-8")
        with pytest.raises(decision.QuestionError):
            decision.load_questions(p)

    def test_local_annotations_never_go_on_the_wire(self):
        """`_why`, `_comment` and the like are this repository's notes, not
        input to the decision."""
        wire = decision.wire_questions(questions_doc())
        assert set(wire) == {"pinned", "grade", "urgent"}
        assert "_why" not in wire["pinned"]
        assert wire["pinned"]["criteria"] == {"yes": "all pinned", "no": "at least one is not"}


class TestTheStateFitsTheContextWindow:
    """jev's context window is 32K tokens. The state is assembled from
    repository files, so it is cut here rather than refused at the far end."""

    def test_the_default_cap_leaves_room_under_32k_tokens(self):
        # ~4 characters per token is generous for English and code; the
        # questions and their instructions need room too.
        assert decision.MAX_STATE_CHARS <= 100_000

    def test_a_short_state_is_unchanged(self):
        assert decision.cap_state("abc", 10) == "abc"

    def test_a_long_state_is_cut_and_says_so(self):
        capped = decision.cap_state("x" * 500, 200)
        assert len(capped) <= 200
        assert capped.endswith(decision.TRUNCATION_NOTE)


class TestCost:
    PRICE = {"input_per_mtok": 0.042, "output_per_mtok": 0.0}

    def test_cost_is_priced_from_the_providers_usage(self):
        usage = {"input_tokens": 1_000_000, "output_tokens": 500}
        assert decision.cost_usd(usage, self.PRICE) == pytest.approx(0.042)

    def test_no_price_is_no_cost_rather_than_a_guess(self):
        assert decision.cost_usd({"input_tokens": 10, "output_tokens": 1}, None) is None

    def test_no_usage_is_no_cost(self):
        assert decision.cost_usd({}, self.PRICE) is None
