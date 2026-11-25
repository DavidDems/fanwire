"""POSTS-010: ReportCountRateLimiter, the per-user limit on reports, and
report_post's use of it. Written before either exists.

Same shape as tests/posts/test_rate_limiter.py (POSTS-002): the limiter
counts the reporter's own rows in `reports` over two sliding windows (one
minute, one hour) in one SQL statement, measured against Postgres's `now()`.
Reports are placed in time with `created_at = now() - make_interval(secs =>
N)` in the SAME transaction the limiter then runs in, so `now()` is the
exact same instant on both sides and the boundaries can be tested exactly.

New names are reached as `moderation.<Name>` / `service.<Name>` inside each
test rather than imported at the top, so each test fails on its own missing
name instead of the whole module failing to collect.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import event, func, select, text

from app.db import Base, make_engine, make_session_factory
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.posts import moderation, service
from app.posts.facade import PostNotFoundError
from app.posts.models import Post, Report
from app.posts.moderation import FakeRateLimiter, RateLimiter
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


def _place_reports(session, reporter_id: int, count: int, age_seconds: int) -> None:
    """`count` reports by `reporter_id`, each on its own fresh post (one
    report per user per post), each created exactly `age_seconds` before the
    current transaction's now(). No commit: the limiter must run in the same
    transaction to see the same now()."""
    author = _make_user(session, f"author_{reporter_id}_{age_seconds}_{count}")
    session.execute(
        text(
            "WITH reported AS ("
            "  INSERT INTO posts (author_id, text) "
            "  SELECT :author_id, 'reported post ' || g FROM generate_series(1, :count) AS g "
            "  RETURNING id"
            ") "
            "INSERT INTO reports (post_id, reporter_id, created_at) "
            "SELECT reported.id, :reporter_id, now() - make_interval(secs => :age) FROM reported"
        ),
        {"author_id": author.id, "reporter_id": reporter_id, "age": age_seconds, "count": count},
    )


def _limiter(session, per_minute: int = 5, per_hour: int = 10):
    return moderation.ReportCountRateLimiter(session, per_minute=per_minute, per_hour=per_hour)


# --- interface --------------------------------------------------------------


def test_report_count_rate_limiter_implements_rate_limiter(session):
    assert isinstance(_limiter(session), RateLimiter)


def test_a_user_with_no_reports_is_allowed(session):
    reporter = _make_user(session, "fresh")

    assert _limiter(session).is_allowed(reporter.id) is True


# --- the minute window ------------------------------------------------------


def test_four_reports_in_the_last_minute_allows_one_more(session):
    reporter = _make_user(session, "four")
    _place_reports(session, reporter.id, 4, age_seconds=5)

    assert _limiter(session).is_allowed(reporter.id) is True


def test_five_reports_in_the_last_minute_is_refused(session):
    reporter = _make_user(session, "five")
    _place_reports(session, reporter.id, 5, age_seconds=5)

    assert _limiter(session).is_allowed(reporter.id) is False


def test_a_report_59_seconds_old_counts_against_the_minute(session):
    reporter = _make_user(session, "minute_59")
    _place_reports(session, reporter.id, 1, age_seconds=59)

    assert _limiter(session, per_minute=1).is_allowed(reporter.id) is False


def test_a_report_exactly_60_seconds_old_no_longer_counts_against_the_minute(session):
    reporter = _make_user(session, "minute_60")
    _place_reports(session, reporter.id, 1, age_seconds=60)

    assert _limiter(session, per_minute=1).is_allowed(reporter.id) is True


def test_a_report_61_seconds_old_does_not_count_against_the_minute(session):
    reporter = _make_user(session, "minute_61")
    _place_reports(session, reporter.id, 1, age_seconds=61)

    assert _limiter(session, per_minute=1).is_allowed(reporter.id) is True


# --- the hour window --------------------------------------------------------


def test_nine_reports_in_the_last_hour_none_in_the_last_minute_allows_one_more(session):
    reporter = _make_user(session, "nine")
    _place_reports(session, reporter.id, 9, age_seconds=2 * MINUTE)

    assert _limiter(session).is_allowed(reporter.id) is True


def test_ten_reports_in_the_last_hour_is_refused(session):
    reporter = _make_user(session, "ten")
    _place_reports(session, reporter.id, 10, age_seconds=2 * MINUTE)

    assert _limiter(session).is_allowed(reporter.id) is False


def test_a_report_3599_seconds_old_counts_against_the_hour(session):
    reporter = _make_user(session, "hour_3599")
    _place_reports(session, reporter.id, 1, age_seconds=HOUR - 1)

    assert _limiter(session, per_hour=1).is_allowed(reporter.id) is False


def test_a_report_exactly_3600_seconds_old_no_longer_counts_against_the_hour(session):
    reporter = _make_user(session, "hour_3600")
    _place_reports(session, reporter.id, 1, age_seconds=HOUR)

    assert _limiter(session, per_hour=1).is_allowed(reporter.id) is True


def test_reports_older_than_an_hour_never_refuse(session):
    reporter = _make_user(session, "old_timer")
    _place_reports(session, reporter.id, 50, age_seconds=HOUR + 1)

    assert _limiter(session).is_allowed(reporter.id) is True


# --- whose reports count ----------------------------------------------------


def test_other_users_reports_never_refuse_this_user(session):
    reporter = _make_user(session, "quiet")
    other = _make_user(session, "loud")
    _place_reports(session, other.id, 20, age_seconds=1)

    assert _limiter(session).is_allowed(reporter.id) is True
    assert _limiter(session).is_allowed(other.id) is False


# --- one statement ----------------------------------------------------------


def test_one_check_issues_exactly_one_sql_statement(engine, session):
    reporter = _make_user(session, "counted")
    _place_reports(session, reporter.id, 3, age_seconds=5)
    session.flush()
    limiter = _limiter(session)

    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        limiter.is_allowed(reporter.id)
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    assert len(statements) == 1, statements


# --- report_post with a limiter ---------------------------------------------


def _seed_post(session, author: User) -> Post:
    post = Post(author_id=author.id, text="reportable")
    session.add(post)
    session.commit()
    return post


def _report_count(session, reporter_id: int) -> int:
    return session.scalar(
        select(func.count()).select_from(Report).where(Report.reporter_id == reporter_id)
    )


def test_report_post_refused_by_the_limiter_raises_and_writes_nothing(session):
    author = _make_user(session, "refused_author")
    reporter = _make_user(session, "refused_reporter")
    post = _seed_post(session, author)
    publisher = InMemoryEventPublisher()

    with pytest.raises(service.ReportRateLimitExceeded):
        service.report_post(
            session,
            PostEventBus(publisher),
            post_id=post.id,
            reporter_id=reporter.id,
            rate_limiter=FakeRateLimiter(False),
        )

    session.rollback()
    assert _report_count(session, reporter.id) == 0
    assert session.get(Post, post.id).reported is False
    assert publisher.published == []


def test_report_post_at_the_real_limit_raises(session):
    author = _make_user(session, "limit_author")
    reporter = _make_user(session, "limit_reporter")
    post = _seed_post(session, author)
    _place_reports(session, reporter.id, 1, age_seconds=1)
    session.commit()
    publisher = InMemoryEventPublisher()

    with pytest.raises(service.ReportRateLimitExceeded):
        service.report_post(
            session,
            PostEventBus(publisher),
            post_id=post.id,
            reporter_id=reporter.id,
            rate_limiter=_limiter(session, per_minute=1),
        )

    session.rollback()
    assert _report_count(session, reporter.id) == 1
    assert session.get(Post, post.id).reported is False
    assert publisher.published == []


def test_report_post_repeat_at_the_limit_is_still_a_no_op(session):
    author = _make_user(session, "repeat_author")
    reporter = _make_user(session, "repeat_reporter")
    post = _seed_post(session, author)
    bus = PostEventBus(InMemoryEventPublisher())
    service.report_post(
        session, bus, post_id=post.id, reporter_id=reporter.id, rate_limiter=FakeRateLimiter(True)
    )

    result = service.report_post(
        session, bus, post_id=post.id, reporter_id=reporter.id, rate_limiter=FakeRateLimiter(False)
    )

    assert result is None
    assert _report_count(session, reporter.id) == 1


def test_report_post_unknown_post_at_the_limit_raises_not_found(session):
    reporter = _make_user(session, "unknown_reporter")
    session.commit()

    with pytest.raises(PostNotFoundError):
        service.report_post(
            session,
            PostEventBus(InMemoryEventPublisher()),
            post_id=999_999,
            reporter_id=reporter.id,
            rate_limiter=FakeRateLimiter(False),
        )


def test_report_post_below_the_limit_creates_the_report(session):
    author = _make_user(session, "below_author")
    reporter = _make_user(session, "below_reporter")
    post = _seed_post(session, author)
    publisher = InMemoryEventPublisher()

    result = service.report_post(
        session,
        PostEventBus(publisher),
        post_id=post.id,
        reporter_id=reporter.id,
        rate_limiter=_limiter(session),
    )

    assert result is not None
    assert _report_count(session, reporter.id) == 1
    assert session.get(Post, post.id).reported is True
    assert [e.name for e in publisher.published] == [service.POST_REPORTED]
