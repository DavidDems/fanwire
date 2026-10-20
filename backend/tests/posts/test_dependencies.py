"""Tests for app.posts.dependencies — get_moderation_chain/
get_publish_post_facade, per AGENTS.md TDD workflow. Written before
app/posts/dependencies.py exists.

get_moderation_chain assembles the fixed-order chain ProfanityFilter ->
SpamScoreCheck -> RateLimitCheck -> DuplicateContentCheck (per
app.posts.moderation's own docstring). ProfanityFilter's banned-word set
comes from Settings.moderation_banned_words (comma-separated). Since
POSTS-003, SpamScoreCheck is wired against the real HeuristicSpamScorer,
its threshold and new-account age from Settings (spam_score_threshold /
spam_new_account_hours) and the author's account age from
app.users.service.account_created_at on the request's session. Since
POSTS-002, RateLimitCheck is wired against the real PostCountRateLimiter
with the limits from Settings (post_rate_limit_per_minute /
post_rate_limit_per_hour). The chain holds no fake anywhere: FakeSpamScorer
and FakeRateLimiter are test doubles only. DuplicateContentCheck, the rate
limiter and the account age are DB-backed, so this is exercised against a
real Postgres (testcontainers), same pattern as
tests/posts/test_moderation.py.

Test users are created with created_at = now(), so every one is a "new
account" to the spam scorer until _backdate moves its creation back.
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


def _backdate(session, user: User, hours: int) -> None:
    session.execute(
        text("UPDATE users SET created_at = now() - make_interval(hours => :hours) WHERE id = :id"),
        {"hours": hours, "id": user.id},
    )
    session.commit()


def test_get_moderation_chain_refuses_a_new_account_posting_a_link(session_factory):
    with session_factory() as session:
        author = _make_user(session)
        chain = get_moderation_chain(session=session, settings=_settings())

        with pytest.raises(PostRejected, match="spam"):
            chain.handle(
                ModerationContext(author_id=author.id, text="watch https://example.com/clip")
            )


def test_get_moderation_chain_accepts_an_established_accounts_single_link(session_factory):
    with session_factory() as session:
        author = _make_user(session)
        _backdate(session, author, hours=48)
        chain = get_moderation_chain(session=session, settings=_settings())

        chain.handle(
            ModerationContext(author_id=author.id, text="watch https://example.com/clip")
        )  # no raise


def test_get_moderation_chain_refuses_three_links_from_an_established_account(session_factory):
    with session_factory() as session:
        author = _make_user(session)
        _backdate(session, author, hours=48)
        chain = get_moderation_chain(session=session, settings=_settings())

        with pytest.raises(PostRejected, match="spam"):
            chain.handle(
                ModerationContext(
                    author_id=author.id,
                    text="https://a.example/1 https://b.example/2 www.c.example/3",
                )
            )


def test_get_moderation_chain_accepts_a_new_accounts_post_without_a_link(session_factory):
    with session_factory() as session:
        author = _make_user(session)
        chain = get_moderation_chain(session=session, settings=_settings())

        chain.handle(ModerationContext(author_id=author.id, text="LETS GO" + "O" * 30))  # no raise


def test_get_moderation_chain_takes_the_spam_threshold_from_settings(session_factory):
    with session_factory() as session:
        established = _make_user(session)
        _backdate(session, established, hours=48)
        new = _make_user(session, cognito_sub="sub-mod-dep-new", username="mod_dep_new")

        strict = get_moderation_chain(session=session, settings=_settings(spam_score_threshold=0.3))
        with pytest.raises(PostRejected, match="spam"):
            strict.handle(
                ModerationContext(author_id=established.id, text="see https://example.com/a")
            )

        lenient = get_moderation_chain(session=session, settings=_settings(spam_score_threshold=1))
        lenient.handle(
            ModerationContext(author_id=new.id, text="see https://example.com/b")
        )  # no raise: a new account's single link scores 0.8


def test_get_moderation_chain_takes_the_new_account_age_from_settings(session_factory):
    with session_factory() as session:
        author = _make_user(session)
        _backdate(session, author, hours=48)

        longer = get_moderation_chain(
            session=session, settings=_settings(spam_new_account_hours=72)
        )
        with pytest.raises(PostRejected, match="spam"):
            longer.handle(ModerationContext(author_id=author.id, text="see https://example.com/a"))

        recent = _make_user(session, cognito_sub="sub-mod-dep-2h", username="mod_dep_2h")
        _backdate(session, recent, hours=2)
        shorter = get_moderation_chain(
            session=session, settings=_settings(spam_new_account_hours=1)
        )
        shorter.handle(
            ModerationContext(author_id=recent.id, text="see https://example.com/b")
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


def _is_fake(value: object) -> bool:
    return any(cls.__name__.startswith("Fake") for cls in type(value).__mro__)


def test_get_moderation_chain_holds_no_fake_anywhere(session_factory):
    with session_factory() as session:
        chain = get_moderation_chain(session=session, settings=_settings())

        links = _links(chain)
        assert not [link for link in links if _is_fake(link)]
        held = [value for link in links for value in vars(link).values()]
        assert held, "the links hold their collaborators as instance attributes"
        assert not [value for value in held if _is_fake(value)]


def test_get_moderation_chain_wires_the_heuristic_spam_scorer(session_factory):
    with session_factory() as session:
        chain = get_moderation_chain(session=session, settings=_settings())

        [spam_check] = [link for link in _links(chain) if isinstance(link, SpamScoreCheck)]
        scorers = [v for v in vars(spam_check).values() if isinstance(v, moderation.SpamScorer)]
        assert [type(v) for v in scorers] == [moderation.HeuristicSpamScorer]


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
