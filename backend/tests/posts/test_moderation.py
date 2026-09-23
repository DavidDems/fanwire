"""Tests for app.posts.moderation — pre-publish moderation chain (Chain of
Responsibility, per wiki/CodeContext/Standards/gof-patterns.md), per
AGENTS.md TDD workflow. Written before app/posts/moderation.py exists.

Fixed order: ProfanityFilter -> SpamScoreCheck -> RateLimitCheck ->
DuplicateContentCheck (per wiki/CodeContext/Standards/gof-patterns.md).
This is NOT the excluded moderation/ module
(wiki/CodeContext/Modules/0x03-posts.md is explicit that doesn't exist for
v1) -- this is pre-publish validation only, owned by (and only ever
invoked from) PublishPostFacade, a later unit not built here.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db import Base, make_engine, make_session_factory
from app.posts.models import Post
from app.posts.moderation import (
    DuplicateContentCheck,
    FakeRateLimiter,
    FakeSpamScorer,
    ModerationCheck,
    ModerationContext,
    PostRejected,
    ProfanityFilter,
    RateLimitCheck,
    SpamScoreCheck,
)
from app.users.models import User

# --- ProfanityFilter ---


def test_profanity_filter_rejects_whole_word_banned_match():
    check = ProfanityFilter(banned_words=frozenset({"badword"}))
    context = ModerationContext(author_id=1, text="this is a badword in text")

    with pytest.raises(PostRejected):
        check.check(context)


def test_profanity_filter_is_case_insensitive():
    check = ProfanityFilter(banned_words=frozenset({"badword"}))
    context = ModerationContext(author_id=1, text="this is a BadWord in text")

    with pytest.raises(PostRejected):
        check.check(context)


def test_profanity_filter_does_not_match_substring_within_another_word():
    # "class" should not trip a banned "ass" -- whole-word match only.
    check = ProfanityFilter(banned_words=frozenset({"ass"}))
    context = ModerationContext(author_id=1, text="I'm taking a class today")

    check.check(context)  # does not raise


def test_profanity_filter_passes_clean_text():
    check = ProfanityFilter(banned_words=frozenset({"badword"}))
    context = ModerationContext(author_id=1, text="perfectly clean text")

    check.check(context)  # does not raise


def test_profanity_filter_passes_none_text():
    check = ProfanityFilter(banned_words=frozenset({"badword"}))
    context = ModerationContext(author_id=1, text=None)

    check.check(context)  # does not raise


# --- SpamScoreCheck ---


def test_spam_score_check_rejects_when_score_meets_threshold():
    check = SpamScoreCheck(scorer=FakeSpamScorer(0.9), threshold=0.8)
    context = ModerationContext(author_id=1, text="buy now buy now buy now")

    with pytest.raises(PostRejected):
        check.check(context)


def test_spam_score_check_passes_when_score_below_threshold():
    check = SpamScoreCheck(scorer=FakeSpamScorer(0.1), threshold=0.8)
    context = ModerationContext(author_id=1, text="hello friends")

    check.check(context)  # does not raise


def test_spam_score_check_rejects_at_exact_threshold_boundary():
    check = SpamScoreCheck(scorer=FakeSpamScorer(0.8), threshold=0.8)
    context = ModerationContext(author_id=1, text="borderline")

    with pytest.raises(PostRejected):
        check.check(context)


# --- RateLimitCheck ---


def test_rate_limit_check_rejects_when_not_allowed():
    check = RateLimitCheck(rate_limiter=FakeRateLimiter(False))
    context = ModerationContext(author_id=1, text="hello")

    with pytest.raises(PostRejected):
        check.check(context)


def test_rate_limit_check_passes_when_allowed():
    check = RateLimitCheck(rate_limiter=FakeRateLimiter(True))
    context = ModerationContext(author_id=1, text="hello")

    check.check(context)  # does not raise


def test_fake_rate_limiter_supports_per_author_verdicts():
    limiter = FakeRateLimiter({1: True, 2: False})

    assert limiter.is_allowed(1) is True
    assert limiter.is_allowed(2) is False


# --- Chain wiring ---


def test_set_next_returns_the_argument_for_fluent_chaining():
    a = ProfanityFilter(banned_words=frozenset())
    b = SpamScoreCheck(scorer=FakeSpamScorer(0.0), threshold=1.0)

    result = a.set_next(b)

    assert result is b


def test_chain_halts_at_first_rejecting_link_and_never_reaches_later_links():
    class AlwaysRejects(ModerationCheck):
        def __init__(self, reason: str) -> None:
            self.reason_raised = reason
            self.was_called = False

        def check(self, context: ModerationContext) -> None:
            self.was_called = True
            raise PostRejected(self.reason_raised)

    first = AlwaysRejects("first link rejected")
    second = AlwaysRejects("second link rejected")
    first.set_next(second)

    with pytest.raises(PostRejected) as exc_info:
        first.handle(ModerationContext(author_id=1, text="whatever"))

    assert exc_info.value.reason == "first link rejected"
    assert first.was_called is True
    assert second.was_called is False


def test_full_chain_passes_through_cleanly_when_nothing_rejects():
    profanity = ProfanityFilter(banned_words=frozenset({"badword"}))
    spam = SpamScoreCheck(scorer=FakeSpamScorer(0.0), threshold=0.8)
    rate_limit = RateLimitCheck(rate_limiter=FakeRateLimiter(True))

    class NeverRejects(ModerationCheck):
        def __init__(self) -> None:
            self.was_called = False

        def check(self, context: ModerationContext) -> None:
            self.was_called = True

    last = NeverRejects()
    profanity.set_next(spam).set_next(rate_limit).set_next(last)

    profanity.handle(ModerationContext(author_id=1, text="a totally clean post"))

    assert last.was_called is True


def test_full_chain_raises_first_rejection_reason_not_a_later_one():
    profanity = ProfanityFilter(banned_words=frozenset({"badword"}))
    spam = SpamScoreCheck(scorer=FakeSpamScorer(0.99), threshold=0.8)
    rate_limit = RateLimitCheck(rate_limiter=FakeRateLimiter(False))
    profanity.set_next(spam).set_next(rate_limit)

    with pytest.raises(PostRejected) as exc_info:
        profanity.handle(ModerationContext(author_id=1, text="clean but spammy text"))

    # spam (first offender in chain order) wins, rate_limit never runs
    assert "spam" in exc_info.value.reason.lower() or exc_info.value.reason != ""


# --- DuplicateContentCheck: real Postgres session ---


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(**overrides) -> User:
    defaults = {
        "cognito_sub": "sub-mod-1",
        "username": "mod_user_1",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    return User(**defaults)


def test_duplicate_content_check_rejects_exact_duplicate_from_same_author(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        session.add(Post(author_id=author.id, text="the exact same text"))
        session.commit()

        check = DuplicateContentCheck(session=session)
        context = ModerationContext(author_id=author.id, text="the exact same text")

        with pytest.raises(PostRejected):
            check.check(context)


def test_duplicate_content_check_passes_when_no_existing_match(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-mod-2", username="mod_user_2")
        session.add(author)
        session.commit()

        session.add(Post(author_id=author.id, text="some other text"))
        session.commit()

        check = DuplicateContentCheck(session=session)
        context = ModerationContext(author_id=author.id, text="brand new text")

        check.check(context)  # does not raise


def test_duplicate_content_check_passes_when_same_text_from_different_author(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-mod-3", username="mod_user_3")
        other_author = _make_user(cognito_sub="sub-mod-4", username="mod_user_4")
        session.add_all([author, other_author])
        session.commit()

        session.add(Post(author_id=author.id, text="shared text"))
        session.commit()

        check = DuplicateContentCheck(session=session)
        context = ModerationContext(author_id=other_author.id, text="shared text")

        check.check(context)  # does not raise


def test_duplicate_content_check_never_trips_on_empty_text_repost(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-mod-5", username="mod_user_5")
        session.add(author)
        session.commit()

        original = Post(author_id=author.id, text="original post")
        session.add(original)
        session.commit()

        # Two plain (null-text) reposts by the same author -- must never
        # collide with each other via DuplicateContentCheck.
        session.add(
            Post(author_id=author.id, text=None, is_repost=True, original_post_id=original.id)
        )
        session.commit()

        check = DuplicateContentCheck(session=session)
        context = ModerationContext(author_id=author.id, text=None)

        check.check(context)  # does not raise
