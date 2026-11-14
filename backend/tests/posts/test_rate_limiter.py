"""POSTS-002: PostCountRateLimiter, the real per-user post rate limiter.
Written before it exists.

The limiter counts the author's own rows in `posts` over two sliding
windows (one minute, one hour) in one SQL statement, measured against
Postgres's `now()` rather than Python's clock. Posts are placed in time
with `created_at = now() - make_interval(secs => N)` in the SAME transaction
the limiter then runs in, so `now()` (the transaction's start time) is the
exact same instant on both sides and the boundaries can be tested exactly.

New names are reached as `moderation.<Name>` inside each test rather than
imported at the top, so each test fails on its own missing name instead of
the whole module failing to collect.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import event, text

from app.db import Base, make_engine, make_session_factory
from app.posts import moderation
from app.posts.models import Post
from app.posts.moderation import ModerationContext, PostRejected, RateLimiter
from app.users.models import User

MINUTE = 60
HOUR = 3600


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session(engine):
    with make_session_factory(engine)() as session:
        yield session


def _make_user(session, username: str) -> User:
    user = User(cognito_sub=f"sub-{username}", username=username, date_of_birth=date(1990, 1, 1))
    session.add(user)
    session.flush()
    return user


def _place_posts(session, author_id: int, count: int, age_seconds: int) -> None:
    """`count` original posts by `author_id`, each created exactly
    `age_seconds` before the current transaction's now(). No commit: the
    limiter must run in the same transaction to see the same now()."""
    session.execute(
        text(
            "INSERT INTO posts (author_id, text, created_at) "
            "SELECT :author_id, 'post ' || g, now() - make_interval(secs => :age) "
            "FROM generate_series(1, :count) AS g"
        ),
        {"author_id": author_id, "age": age_seconds, "count": count},
    )


def _limiter(session, per_minute: int = 10, per_hour: int = 100):
    return moderation.PostCountRateLimiter(session, per_minute=per_minute, per_hour=per_hour)


# --- interface --------------------------------------------------------------


def test_post_count_rate_limiter_implements_rate_limiter(session):
    assert isinstance(_limiter(session), RateLimiter)


def test_an_author_with_no_posts_is_allowed(session):
    author = _make_user(session, "fresh")

    assert _limiter(session).is_allowed(author.id) is True


# --- the minute window ------------------------------------------------------


def test_nine_posts_in_the_last_minute_allows_one_more(session):
    author = _make_user(session, "nine")
    _place_posts(session, author.id, 9, age_seconds=5)

    assert _limiter(session).is_allowed(author.id) is True


def test_ten_posts_in_the_last_minute_is_refused(session):
    author = _make_user(session, "ten")
    _place_posts(session, author.id, 10, age_seconds=5)

    assert _limiter(session).is_allowed(author.id) is False


def test_a_post_59_seconds_old_counts_against_the_minute(session):
    author = _make_user(session, "minute_59")
    _place_posts(session, author.id, 1, age_seconds=59)

    assert _limiter(session, per_minute=1).is_allowed(author.id) is False


def test_a_post_exactly_60_seconds_old_no_longer_counts_against_the_minute(session):
    author = _make_user(session, "minute_60")
    _place_posts(session, author.id, 1, age_seconds=60)

    assert _limiter(session, per_minute=1).is_allowed(author.id) is True


def test_a_post_61_seconds_old_does_not_count_against_the_minute(session):
    author = _make_user(session, "minute_61")
    _place_posts(session, author.id, 1, age_seconds=61)

    assert _limiter(session, per_minute=1).is_allowed(author.id) is True


# --- the hour window --------------------------------------------------------


def test_99_posts_in_the_last_hour_none_in_the_last_minute_allows_one_more(session):
    author = _make_user(session, "ninety_nine")
    _place_posts(session, author.id, 99, age_seconds=2 * MINUTE)

    assert _limiter(session).is_allowed(author.id) is True


def test_100_posts_in_the_last_hour_is_refused(session):
    author = _make_user(session, "hundred")
    _place_posts(session, author.id, 100, age_seconds=2 * MINUTE)

    assert _limiter(session).is_allowed(author.id) is False


def test_a_post_3599_seconds_old_counts_against_the_hour(session):
    author = _make_user(session, "hour_3599")
    _place_posts(session, author.id, 1, age_seconds=HOUR - 1)

    assert _limiter(session, per_hour=1).is_allowed(author.id) is False


def test_a_post_3601_seconds_old_does_not_count_against_the_hour(session):
    author = _make_user(session, "hour_3601")
    _place_posts(session, author.id, 1, age_seconds=HOUR + 1)

    assert _limiter(session, per_hour=1).is_allowed(author.id) is True


def test_posts_older_than_an_hour_never_refuse(session):
    author = _make_user(session, "old_timer")
    _place_posts(session, author.id, 500, age_seconds=HOUR + 1)

    assert _limiter(session).is_allowed(author.id) is True


# --- whose posts count ------------------------------------------------------


def test_other_authors_posts_never_refuse_this_author(session):
    author = _make_user(session, "quiet")
    other = _make_user(session, "loud")
    _place_posts(session, other.id, 150, age_seconds=1)

    assert _limiter(session).is_allowed(author.id) is True
    assert _limiter(session).is_allowed(other.id) is False


@pytest.mark.parametrize("kind", ["original", "reply", "quote_repost", "plain_repost"])
def test_every_kind_of_post_counts(session, kind):
    author = _make_user(session, f"kind_{kind}")
    other = _make_user(session, f"other_{kind}")
    target = Post(author_id=other.id, text="someone else's post")
    session.add(target)
    session.flush()

    fields = {
        "original": {"text": "an original"},
        "reply": {"text": "a reply", "is_reply": True, "parent_post_id": target.id},
        "quote_repost": {"text": "a quote", "is_repost": True, "original_post_id": target.id},
        "plain_repost": {"text": None, "is_repost": True, "original_post_id": target.id},
    }[kind]
    session.add(Post(author_id=author.id, **fields))
    session.flush()

    assert _limiter(session, per_minute=1).is_allowed(author.id) is False


# --- one statement ----------------------------------------------------------


def test_one_check_issues_exactly_one_sql_statement(engine, session):
    author = _make_user(session, "counted")
    _place_posts(session, author.id, 3, age_seconds=5)
    session.flush()
    limiter = _limiter(session)

    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        limiter.is_allowed(author.id)
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    assert len(statements) == 1, statements


# --- RateLimitCheck / RateLimitExceeded -------------------------------------


def test_rate_limit_exceeded_is_a_post_rejected():
    assert issubclass(moderation.RateLimitExceeded, PostRejected)


def test_rate_limit_check_raises_rate_limit_exceeded_when_refused(session):
    author = _make_user(session, "refused")
    _place_posts(session, author.id, 1, age_seconds=1)
    check = moderation.RateLimitCheck(_limiter(session, per_minute=1))

    with pytest.raises(moderation.RateLimitExceeded):
        check.handle(ModerationContext(author_id=author.id, text="one too many"))


def test_rate_limit_check_passes_when_allowed(session):
    author = _make_user(session, "allowed")
    check = moderation.RateLimitCheck(_limiter(session))

    check.handle(ModerationContext(author_id=author.id, text="first post"))  # no raise
