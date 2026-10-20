"""Tests for app.posts.dependencies — get_moderation_chain/
get_publish_post_facade, per AGENTS.md TDD workflow. Written before
app/posts/dependencies.py exists.

get_moderation_chain assembles the fixed-order chain ProfanityFilter ->
SpamScoreCheck -> RateLimitCheck -> DuplicateContentCheck (per
app.posts.moderation's own docstring). ProfanityFilter's banned-word set
comes from Settings.moderation_banned_words (comma-separated). No real
SpamScorer adapter exists yet, so SpamScoreCheck is wired against
FakeSpamScorer(score=0.0) as the PRODUCTION default until POSTS-003 (same
precedent as app.dependencies.get_event_bus's InMemoryEventPublisher
default) -- it can reject nothing today. Since POSTS-002, RateLimitCheck is
wired against the real PostCountRateLimiter with the limits from Settings
(post_rate_limit_per_minute / post_rate_limit_per_hour); FakeRateLimiter is
a test double only and must never appear in the chain. DuplicateContentCheck
and the rate limiter are DB-backed, so this is exercised against a real
Postgres (testcontainers), same pattern as tests/posts/test_moderation.py.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import text

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus
from app.eventbus import PostEventBus
from app.posts import moderation
from app.posts.dependencies import get_moderation_chain, get_publish_post_facade
from app.posts.facade import PublishPostFacade
from app.posts.models import Post
from app.posts.moderation import (
    DuplicateContentCheck,
    FakeRateLimiter,
    ModerationContext,
    PostRejected,
    ProfanityFilter,
    RateLimitCheck,
    RateLimiter,
    SpamScoreCheck,
)
from app.settings import Settings
from app.users.models import User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _settings(**overrides) -> Settings:
    values = {"database_url": "postgresql+psycopg://u:p@host:5432/db", **overrides}
    return Settings(**values)


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": "sub-mod-dep",
        "username": "mod_dep_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


# --- get_moderation_chain -------------------------------------------------


def test_get_moderation_chain_rejects_a_configured_banned_word(session_factory):
    with session_factory() as session:
        chain = get_moderation_chain(
            session=session, settings=_settings(moderation_banned_words="badword")
        )

        with pytest.raises(PostRejected, match="banned word"):
            chain.handle(ModerationContext(author_id=1, text="this has a badword in it"))


def test_get_moderation_chain_banned_words_parsing_is_comma_separated_case_insensitive(
    session_factory,
):
    with session_factory() as session:
        chain = get_moderation_chain(
            session=session,
            settings=_settings(moderation_banned_words="Foo, BAR,  baz "),
        )

        with pytest.raises(PostRejected, match="banned word"):
            chain.handle(ModerationContext(author_id=1, text="say bar to me"))


def test_get_moderation_chain_allows_ordinary_text_by_default(session_factory):
    with session_factory() as session:
        chain = get_moderation_chain(session=session, settings=_settings())

        chain.handle(ModerationContext(author_id=1, text="a perfectly normal post"))  # no raise


def test_get_moderation_chain_default_spam_never_rejects(session_factory):
    # No real SpamScorer adapter exists yet (POSTS-003) -- production
    # default is FakeSpamScorer(0.0), so spammy text from an author with no
    # posts passes.
    with session_factory() as session:
        author = _make_user(session)
        chain = get_moderation_chain(session=session, settings=_settings())

        chain.handle(
            ModerationContext(author_id=author.id, text="buy buy buy click now free money")
        )  # no raise


def _links(chain) -> list:
    links = []
    link = chain
    while link is not None:
        links.append(link)
        link = link._next
    return links


def test_get_moderation_chain_builds_the_fixed_order(session_factory):
    with session_factory() as session:
        chain = get_moderation_chain(session=session, settings=_settings())

        assert [type(link) for link in _links(chain)] == [
            ProfanityFilter,
            SpamScoreCheck,
            RateLimitCheck,
            DuplicateContentCheck,
        ]


def test_get_moderation_chain_wires_the_real_rate_limiter_not_the_fake(session_factory):
    with session_factory() as session:
        chain = get_moderation_chain(session=session, settings=_settings())

        held = [value for link in _links(chain) for value in vars(link).values()]
        assert not any(isinstance(value, FakeRateLimiter) for value in held)
        [rate_check] = [link for link in _links(chain) if isinstance(link, RateLimitCheck)]
        limiters = [v for v in vars(rate_check).values() if isinstance(v, RateLimiter)]
        assert [type(v) for v in limiters] == [moderation.PostCountRateLimiter]


def _place_posts(session, author_id: int, count: int, age_seconds: int = 5) -> None:
    session.execute(
        text(
            "INSERT INTO posts (author_id, text, created_at) "
            "SELECT :author_id, 'post ' || g, now() - make_interval(secs => :age) "
            "FROM generate_series(1, :count) AS g"
        ),
        {"author_id": author_id, "age": age_seconds, "count": count},
    )


def test_get_moderation_chain_default_limits_allow_a_tenth_post_in_a_minute(session_factory):
    with session_factory() as session:
        author = _make_user(session)
        _place_posts(session, author.id, 9)
        chain = get_moderation_chain(session=session, settings=_settings())

        chain.handle(ModerationContext(author_id=author.id, text="number ten"))  # no raise


def test_get_moderation_chain_default_limits_refuse_an_eleventh_post_in_a_minute(
    session_factory,
):
    with session_factory() as session:
        author = _make_user(session)
        _place_posts(session, author.id, 10)
        chain = get_moderation_chain(session=session, settings=_settings())

        with pytest.raises(moderation.RateLimitExceeded):
            chain.handle(ModerationContext(author_id=author.id, text="number eleven"))


def test_get_moderation_chain_default_limits_refuse_the_hundred_and_first_post_in_an_hour(
    session_factory,
):
    with session_factory() as session:
        author = _make_user(session)
        _place_posts(session, author.id, 100, age_seconds=120)
        chain = get_moderation_chain(session=session, settings=_settings())

        with pytest.raises(moderation.RateLimitExceeded):
            chain.handle(ModerationContext(author_id=author.id, text="one hundred and one"))


def test_get_moderation_chain_takes_the_limits_from_settings(session_factory):
    with session_factory() as session:
        author = _make_user(session)
        _place_posts(session, author.id, 2)
        chain = get_moderation_chain(
            session=session,
            settings=_settings(post_rate_limit_per_minute=2, post_rate_limit_per_hour=1000),
        )

        with pytest.raises(moderation.RateLimitExceeded):
            chain.handle(ModerationContext(author_id=author.id, text="third in a minute"))


def test_get_moderation_chain_still_enforces_duplicate_content(session_factory):
    with session_factory() as session:
        author = _make_user(session)
        session.add(Post(author_id=author.id, text="repeated text"))
        session.commit()

        chain = get_moderation_chain(session=session, settings=_settings())

        with pytest.raises(PostRejected, match="duplicate"):
            chain.handle(ModerationContext(author_id=author.id, text="repeated text"))


# --- get_publish_post_facade ----------------------------------------------


def test_get_publish_post_facade_wires_a_working_facade(session_factory):
    with session_factory() as session:
        chain = get_moderation_chain(session=session, settings=_settings())
        bus = get_event_bus()
        get_event_bus.cache_clear()

        facade = get_publish_post_facade(session=session, moderation_chain=chain, event_bus=bus)

        assert isinstance(facade, PublishPostFacade)
        assert isinstance(bus, PostEventBus)
