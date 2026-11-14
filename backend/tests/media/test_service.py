"""Tests for app.media.service -- the public read interface feed/ (a later
unit, per wiki/CodeContext/Modules/0x06-feed.md) calls instead of querying
app.media.models directly (0x00-architecture.md Connection rule). Written
before app/media/service.py exists, per AGENTS.md TDD workflow.

processed_media_for_posts: batch lookup keyed by post id, Processed status
only -- feed/ never shows a still-scanning or rejected upload.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db import Base, make_engine, make_session_factory
from app.media.models import Media, MediaStatus
from app.media.service import MediaView, processed_media_for_posts
from app.posts.models import Post
from app.users.models import User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-{overrides.get('username', 'u')}",
        "username": "media_svc_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


def _make_post(session, author) -> Post:
    post = Post(author_id=author.id, text="a post with media")
    session.add(post)
    session.commit()
    return post


def test_processed_media_for_posts_returns_only_processed_media(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="pmfp_author")
        post = _make_post(session, author)

        processed = Media(
            uploader_id=author.id,
            post_id=post.id,
            status=MediaStatus.PROCESSED,
            s3_key_public="public/1.jpg",
            s3_key_thumbnail="thumb/1.jpg",
        )
        scanning = Media(uploader_id=author.id, post_id=post.id, status=MediaStatus.SCANNING)
        session.add_all([processed, scanning])
        session.commit()

        result = processed_media_for_posts(session, [post.id])

        assert result[post.id] == [
            MediaView(
                id=processed.id,
                s3_key_public="public/1.jpg",
                s3_key_thumbnail="thumb/1.jpg",
            )
        ]


def test_processed_media_for_posts_groups_by_post(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="pmfp_multi_author")
        post1 = _make_post(session, author)
        post2 = _make_post(session, author)

        media1 = Media(uploader_id=author.id, post_id=post1.id, status=MediaStatus.PROCESSED)
        media2a = Media(uploader_id=author.id, post_id=post2.id, status=MediaStatus.PROCESSED)
        media2b = Media(uploader_id=author.id, post_id=post2.id, status=MediaStatus.PROCESSED)
        session.add_all([media1, media2a, media2b])
        session.commit()

        result = processed_media_for_posts(session, [post1.id, post2.id])

        assert [m.id for m in result[post1.id]] == [media1.id]
        assert {m.id for m in result[post2.id]} == {media2a.id, media2b.id}


def test_processed_media_for_posts_post_with_no_media_is_absent(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="pmfp_none_author")
        post = _make_post(session, author)

        result = processed_media_for_posts(session, [post.id])

        assert post.id not in result


def test_processed_media_for_posts_empty_post_ids_returns_empty_dict(session_factory):
    with session_factory() as session:
        assert processed_media_for_posts(session, []) == {}
