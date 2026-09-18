"""Tests for app.posts.facade — PublishPostFacade, the single entry point
for creating a post per wiki/CodeContext/Modules/0x00-architecture.md
"Connection rule", per AGENTS.md TDD workflow. Written before
app/posts/facade.py exists.

Sequence under test: moderation chain -> confirm attached Media is
Processed -> persist Post -> attach Media -> resolve #GameId mentions ->
commit -> fan-out on PostEventBus (PostCreated always, PostMentionedEvent
only when at least one mention resolved).
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.events.models import Game, Team
from app.media.models import Media, MediaStatus
from app.posts.facade import (
    POST_CREATED,
    POST_MENTIONED,
    CreatePostRequest,
    MediaNotFoundError,
    MediaNotProcessedError,
    PublishPostFacade,
)
from app.posts.models import EventMention, Post
from app.posts.moderation import (
    ModerationCheck,
    ModerationContext,
    PostRejected,
)
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


class NeverRejects(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


class AlwaysRejects(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        raise PostRejected("always rejects")


def _make_user(**overrides) -> User:
    defaults = {
        "cognito_sub": "sub-facade-1",
        "username": "facade_author",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    return User(**defaults)


def _seed_game(session, **overrides) -> Game:
    home = Team(
        api_sports_team_id=201,
        name="Boston Celtics",
        abbreviation="BOS",
        conference="Eastern",
        division="Atlantic",
    )
    away = Team(
        api_sports_team_id=202,
        name="Los Angeles Lakers",
        abbreviation="LAL",
        conference="Western",
        division="Pacific",
    )
    session.add_all([home, away])
    session.commit()

    defaults = {
        "api_sports_game_id": 777,
        "home_team_id": home.id,
        "away_team_id": away.id,
        "date": datetime(2026, 1, 1, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 100,
        "away_score": 98,
    }
    defaults.update(overrides)
    game = Game(**defaults)
    session.add(game)
    session.commit()
    return game


def test_publish_plain_post_persists_and_fires_post_created(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        facade = PublishPostFacade(
            session=session, moderation_chain=NeverRejects(), event_bus=bus
        )

        request = CreatePostRequest(author_id=author.id, text="hello world")
        post = facade.publish(request)

        assert post.id is not None
        fetched = session.scalar(select(Post).where(Post.id == post.id))
        assert fetched is not None
        assert fetched.text == "hello world"

        event_names = [e.name for e in publisher.published]
        assert event_names == [POST_CREATED]
        created_event = publisher.published[0]
        assert created_event.detail["post_id"] == post.id
        assert created_event.detail["author_id"] == author.id


def test_publish_with_resolvable_mention_creates_event_mention_and_fires_both_events(
    session_factory,
):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()
        game = _seed_game(session)

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        facade = PublishPostFacade(
            session=session, moderation_chain=NeverRejects(), event_bus=bus
        )

        request = CreatePostRequest(
            author_id=author.id, text=f"great game #GameId{game.id}"
        )
        post = facade.publish(request)

        mention = session.scalar(
            select(EventMention).where(EventMention.post_id == post.id)
        )
        assert mention is not None
        assert mention.game_id == game.id
        assert mention.raw_token == f"#GameId{game.id}"

        event_names = [e.name for e in publisher.published]
        assert event_names == [POST_CREATED, POST_MENTIONED]
        mentioned_event = publisher.published[1]
        assert mentioned_event.detail["post_id"] == post.id
        assert mentioned_event.detail["game_ids"] == [game.id]


def test_publish_with_unresolvable_mention_creates_no_event_mention_and_only_fires_post_created(
    session_factory,
):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        facade = PublishPostFacade(
            session=session, moderation_chain=NeverRejects(), event_bus=bus
        )

        request = CreatePostRequest(
            author_id=author.id, text="unknown game #GameId999999"
        )
        post = facade.publish(request)

        assert post.id is not None
        mentions = session.scalars(
            select(EventMention).where(EventMention.post_id == post.id)
        ).all()
        assert mentions == []

        event_names = [e.name for e in publisher.published]
        assert event_names == [POST_CREATED]


def test_publish_with_processed_media_attaches_it(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        media = Media(uploader_id=author.id, status=MediaStatus.PROCESSED)
        session.add(media)
        session.commit()

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        facade = PublishPostFacade(
            session=session, moderation_chain=NeverRejects(), event_bus=bus
        )

        request = CreatePostRequest(
            author_id=author.id, text="post with image", media_ids=[media.id]
        )
        post = facade.publish(request)

        fetched_media = session.scalar(select(Media).where(Media.id == media.id))
        assert fetched_media.post_id == post.id


def test_publish_with_non_processed_media_raises_and_persists_nothing(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        media = Media(uploader_id=author.id, status=MediaStatus.UPLOADED)
        session.add(media)
        session.commit()

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        facade = PublishPostFacade(
            session=session, moderation_chain=NeverRejects(), event_bus=bus
        )

        request = CreatePostRequest(
            author_id=author.id, text="post with unprocessed image", media_ids=[media.id]
        )

        with pytest.raises(MediaNotProcessedError):
            facade.publish(request)

        assert session.scalar(select(Post).where(Post.author_id == author.id)) is None
        assert publisher.published == []


def test_publish_with_nonexistent_media_id_raises_media_not_found(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        facade = PublishPostFacade(
            session=session, moderation_chain=NeverRejects(), event_bus=bus
        )

        request = CreatePostRequest(
            author_id=author.id, text="post with bogus media", media_ids=[999_999]
        )

        with pytest.raises(MediaNotFoundError):
            facade.publish(request)

        assert session.scalar(select(Post).where(Post.author_id == author.id)) is None
        assert publisher.published == []


def test_publish_moderation_rejection_raises_and_persists_nothing(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        facade = PublishPostFacade(
            session=session, moderation_chain=AlwaysRejects(), event_bus=bus
        )

        request = CreatePostRequest(author_id=author.id, text="whatever")

        with pytest.raises(PostRejected):
            facade.publish(request)

        assert session.scalar(select(Post).where(Post.author_id == author.id)) is None
        assert publisher.published == []
