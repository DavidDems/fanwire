"""Tests for app.posts.dependencies — get_moderation_chain/
get_publish_post_facade, per AGENTS.md TDD workflow. Written before
app/posts/dependencies.py exists.

get_moderation_chain assembles the fixed-order chain ProfanityFilter ->
SpamScoreCheck -> RateLimitCheck -> DuplicateContentCheck (per
app.posts.moderation's own docstring). ProfanityFilter's banned-word set
comes from Settings.moderation_banned_words (comma-separated). No real
SpamScorer/RateLimiter adapter exists yet, so SpamScoreCheck/RateLimitCheck
are wired against FakeSpamScorer(score=0.0)/FakeRateLimiter(allowed=True) as
the PRODUCTION default (same precedent as app.dependencies.get_event_bus's
InMemoryEventPublisher default) — neither can reject anything today.
DuplicateContentCheck is the one fully real, DB-backed check alongside
ProfanityFilter, so this is exercised against a real Postgres
(testcontainers), same pattern as tests/posts/test_moderation.py.
"""

from __future__ import annotations

from datetime import date

import pytest
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus
from app.eventbus import PostEventBus
from app.posts.dependencies import get_moderation_chain, get_publish_post_facade
from app.posts.facade import PublishPostFacade
from app.posts.models import Post
from app.posts.moderation import ModerationContext, PostRejected
from app.settings import Settings
from app.users.models import User


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


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


def test_get_moderation_chain_default_spam_and_rate_limit_never_reject(session_factory):
    # No real SpamScorer/RateLimiter adapter exists yet -- production
    # default is FakeSpamScorer(0.0)/FakeRateLimiter(True), so neither
    # link can reject regardless of content/author.
    with session_factory() as session:
        chain = get_moderation_chain(session=session, settings=_settings())

        chain.handle(
            ModerationContext(author_id=999, text="buy buy buy click now free money")
        )  # no raise


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

        facade = get_publish_post_facade(
            session=session, moderation_chain=chain, event_bus=bus
        )

        assert isinstance(facade, PublishPostFacade)
        assert isinstance(bus, PostEventBus)
