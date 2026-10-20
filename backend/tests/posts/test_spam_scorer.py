"""POSTS-003: HeuristicSpamScorer, the deterministic spam scorer that
replaces FakeSpamScorer(0.0) as SpamScoreCheck's production scorer. Written
before the scorer exists.

The score is the sum of three parts, capped at 1.0:

- links: 1 link 0.3, 2 links 0.5, 3 or more 0.8. A link is a
  case-insensitive `http://`, `https://` or `www.` followed by
  non-whitespace; a bare domain such as example.com is not one.
- a run of 20 or more of the same non-whitespace character: 0.5.
- an author account younger than the new-account age posting at least one
  link: 0.5. An unknown author (account_created_at -> None) is treated as a
  new account.

Null or empty text scores 0.0. The scorer takes the whole ModerationContext
(SpamScorer.score's signature widened from the text alone), its account age
from an injected `account_created_at(user_id)` and its clock from an
injected `now()`, so these tests need no database and fix "now".
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest

from app.posts import moderation
from app.posts.moderation import (
    FakeSpamScorer,
    ModerationContext,
    PostRejected,
    SpamScoreCheck,
    SpamScorer,
)

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
DAY = timedelta(hours=24)
ESTABLISHED = timedelta(days=30)

LINK_1 = "https://example.com/clip"
LINK_2 = "http://example.org/two"
LINK_3 = "www.example.net/three"


def _scorer(
    account_age: timedelta | None = ESTABLISHED,
    *,
    new_account_age: timedelta = DAY,
    now: Callable[[], datetime] = lambda: NOW,
):
    """A scorer whose every author is `account_age` old at NOW (or unknown,
    for None)."""
    created_at = None if account_age is None else NOW - account_age
    return moderation.HeuristicSpamScorer(
        account_created_at=lambda user_id: created_at,
        now=now,
        new_account_age=new_account_age,
    )


def _score(text: str | None, account_age: timedelta | None = ESTABLISHED, **kwargs) -> float:
    return _scorer(account_age, **kwargs).score(ModerationContext(author_id=1, text=text))


# --- the interface ------------------------------------------------------------


def test_heuristic_spam_scorer_is_a_spam_scorer():
    assert isinstance(_scorer(), SpamScorer)


def test_heuristic_spam_scorer_takes_keyword_arguments_only():
    with pytest.raises(TypeError):
        moderation.HeuristicSpamScorer(lambda user_id: NOW, lambda: NOW, DAY)  # type: ignore[misc]


def test_fake_spam_scorer_takes_the_whole_context():
    scorer = FakeSpamScorer(0.42)

    assert scorer.score(ModerationContext(author_id=7, text="anything")) == 0.42


def test_spam_score_check_passes_the_whole_context_to_the_scorer():
    seen: list[ModerationContext] = []

    class RecordingScorer(SpamScorer):
        def score(self, context: ModerationContext) -> float:
            seen.append(context)
            return 0.0

    context = ModerationContext(author_id=7, text="hello")
    SpamScoreCheck(scorer=RecordingScorer(), threshold=0.8).check(context)

    assert seen == [context]


# --- empty text ---------------------------------------------------------------


@pytest.mark.parametrize("text", [None, ""])
def test_null_or_empty_text_scores_zero(text):
    assert _score(text) == 0.0


@pytest.mark.parametrize("text", [None, ""])
def test_null_or_empty_text_scores_zero_even_for_a_new_account(text):
    assert _score(text, account_age=timedelta(minutes=1)) == 0.0
    assert _score(text, account_age=None) == 0.0


def test_ordinary_text_scores_zero():
    assert _score("what a game last night, the bench came through") == 0.0


# --- links ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (f"watch this {LINK_1}", 0.3),
        (f"{LINK_1} and {LINK_2}", 0.5),
        (f"{LINK_1} {LINK_2} {LINK_3}", 0.8),
        (f"{LINK_1} {LINK_2} {LINK_3} https://a.example/4 http://b.example/5", 0.8),
    ],
)
def test_links_score_by_count(text, expected):
    assert _score(text) == pytest.approx(expected)


@pytest.mark.parametrize("link", ["http://example.com", "https://example.com", "www.example.com"])
def test_each_link_form_counts_as_a_link(link):
    assert _score(f"see {link} now") == pytest.approx(0.3)


@pytest.mark.parametrize("link", ["HTTPS://EXAMPLE.COM/X", "Http://example.com", "WWW.Example.com"])
def test_links_are_matched_case_insensitively(link):
    assert _score(f"see {link} now") == pytest.approx(0.3)


def test_a_bare_domain_is_not_a_link():
    assert _score("go to example.com for the clip") == 0.0


def test_a_scheme_followed_by_whitespace_is_not_a_link():
    assert _score("typed http:// and then nothing") == 0.0


def test_a_url_with_both_a_scheme_and_www_is_one_link():
    assert _score("https://www.example.com/clip") == pytest.approx(0.3)


# --- repeated characters ----------------------------------------------------------


def test_a_run_of_twenty_of_the_same_character_scores_half():
    assert _score("LETS G" + "O" * 20) == pytest.approx(0.5)


def test_a_run_of_nineteen_scores_nothing():
    assert _score("LETS G" + "O" * 19) == 0.0


def test_a_run_of_punctuation_counts():
    assert _score("what a dunk" + "!" * 25) == pytest.approx(0.5)


@pytest.mark.parametrize("whitespace", [" ", "\n", "\t"])
def test_a_run_of_whitespace_does_not_count(whitespace):
    assert _score("first line" + whitespace * 30 + "second line") == 0.0


def test_several_runs_still_score_half():
    assert _score("A" * 20 + " and " + "B" * 20) == pytest.approx(0.5)


def test_a_run_alone_never_refuses_at_the_default_threshold():
    check = SpamScoreCheck(scorer=_scorer(account_age=timedelta(minutes=1)), threshold=0.8)

    check.check(ModerationContext(author_id=1, text="LETS G" + "O" * 40))  # no raise


# --- new account posting a link ---------------------------------------------------


def test_a_new_account_posting_a_link_adds_half():
    assert _score(f"watch {LINK_1}", account_age=timedelta(hours=23)) == pytest.approx(0.8)


def test_a_new_account_without_a_link_scores_nothing():
    assert _score("my first post here", account_age=timedelta(hours=23)) == 0.0


def test_an_account_older_than_the_new_account_age_is_established():
    assert _score(f"watch {LINK_1}", account_age=timedelta(hours=25)) == pytest.approx(0.3)


def test_an_account_exactly_the_new_account_age_is_no_longer_new():
    assert _score(f"watch {LINK_1}", account_age=DAY) == pytest.approx(0.3)


def test_an_unknown_author_is_treated_as_a_new_account():
    assert _score(f"watch {LINK_1}", account_age=None) == pytest.approx(0.8)


def test_an_unknown_author_without_a_link_scores_nothing():
    assert _score("hello", account_age=None) == 0.0


def test_the_new_account_age_is_the_injected_one():
    assert _score(
        f"watch {LINK_1}", account_age=timedelta(hours=2), new_account_age=timedelta(hours=1)
    ) == pytest.approx(0.3)
    assert _score(
        f"watch {LINK_1}", account_age=timedelta(hours=48), new_account_age=timedelta(hours=72)
    ) == pytest.approx(0.8)


def test_the_account_age_is_measured_against_the_injected_clock():
    created_at = NOW - timedelta(hours=23)
    clock = {"now": NOW}
    scorer = moderation.HeuristicSpamScorer(
        account_created_at=lambda user_id: created_at,
        now=lambda: clock["now"],
        new_account_age=DAY,
    )
    context = ModerationContext(author_id=1, text=f"watch {LINK_1}")

    assert scorer.score(context) == pytest.approx(0.8)
    clock["now"] = NOW + timedelta(hours=2)
    assert scorer.score(context) == pytest.approx(0.3)


def test_the_account_age_is_looked_up_for_the_contexts_author():
    created = {1: NOW - timedelta(hours=1), 2: NOW - ESTABLISHED}
    scorer = moderation.HeuristicSpamScorer(
        account_created_at=lambda user_id: created.get(user_id),
        now=lambda: NOW,
        new_account_age=DAY,
    )

    assert scorer.score(ModerationContext(author_id=1, text=LINK_1)) == pytest.approx(0.8)
    assert scorer.score(ModerationContext(author_id=2, text=LINK_1)) == pytest.approx(0.3)
    assert scorer.score(ModerationContext(author_id=3, text=LINK_1)) == pytest.approx(0.8)


# --- the sum and its cap ------------------------------------------------------------


def test_the_parts_add_up():
    text = f"{LINK_1} " + "Z" * 20
    assert _score(text) == pytest.approx(0.8)
    assert _score(f"{LINK_1} {LINK_2} " + "Z" * 20) == pytest.approx(1.0)


def test_the_sum_is_capped_at_one():
    text = f"{LINK_1} {LINK_2} {LINK_3} " + "Z" * 30
    assert _score(text, account_age=timedelta(minutes=5)) == pytest.approx(1.0)
    assert _score(text, account_age=None) <= 1.0


# --- the acceptance examples at the default threshold 0.8 ----------------------------

_REFUSED, _ACCEPTED = True, False


@pytest.mark.parametrize(
    ("text", "account_age", "refused", "score"),
    [
        (f"{LINK_1} {LINK_2}", ESTABLISHED, _ACCEPTED, 0.5),
        (f"{LINK_1} {LINK_2} {LINK_3}", ESTABLISHED, _REFUSED, 0.8),
        (f"{LINK_1} " + "O" * 20, ESTABLISHED, _REFUSED, 0.8),
        (f"{LINK_1} " + "O" * 19, ESTABLISHED, _ACCEPTED, 0.3),
        (f"watch {LINK_1}", timedelta(hours=25), _ACCEPTED, 0.3),
        (f"watch {LINK_1}", timedelta(hours=23), _REFUSED, 0.8),
        ("my first post, no link", timedelta(hours=23), _ACCEPTED, 0.0),
    ],
    ids=[
        "established-2-links",
        "established-3-links",
        "established-link-and-20-run",
        "established-link-and-19-run",
        "25h-account-1-link",
        "23h-account-1-link",
        "23h-account-no-link",
    ],
)
def test_acceptance_examples_at_the_default_threshold(text, account_age, refused, score):
    scorer = _scorer(account_age)
    context = ModerationContext(author_id=1, text=text)
    check = SpamScoreCheck(scorer=scorer, threshold=0.8)

    assert scorer.score(context) == pytest.approx(score)
    if refused:
        with pytest.raises(PostRejected, match="spam"):
            check.check(context)
    else:
        check.check(context)  # no raise
