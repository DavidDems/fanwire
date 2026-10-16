"""Tests for app.feed.views.assemble_post_views, per AGENTS.md TDD
workflow. Written before app/feed/views.py exists.

assemble_post_views batches every cross-module lookup (posts/media/events'
public read functions) into one call per read function per page -- no
N+1. Since EVENTS-003 it reads no live scores: PostView has no
`live_scores` field and the function takes no live-score proxy.

search/ (a later unit, per this unit's task brief) reuses this exact
function, so its signature/return shape is treated as a public contract
here, not an implementation detail.
"""

from __future__ import annotations

import inspect
from datetime import UTC, date, datetime, timedelta

import pytest

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team
from app.feed import views as feed_views
from app.feed.views import PostView, assemble_post_views
from app.media.models import Media, MediaStatus
from app.posts.models import EventMention, Post
from app.posts.service import like_post
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
        "username": "views_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


def _make_post(session, author, **overrides) -> Post:
    defaults = {"author_id": author.id, "text": "a post"}
    defaults.update(overrides)
    post = Post(**defaults)
    session.add(post)
    session.commit()
    return post


def _make_team(session, **overrides) -> Team:
    defaults = {
        "nba_team_id": 1,
        "name": "Team",
        "abbreviation": "TM",
        "conference": "Eastern",
        "division": "Atlantic",
    }
    defaults.update(overrides)
    team = Team(**defaults)
    session.add(team)
    session.commit()
    return team


def _make_game(session, home, away, **overrides) -> Game:
    defaults = {
        "nba_game_id": 5001,
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


_POST_VIEW_FIELDS = {
    "id",
    "text",
    "is_reply",
    "parent_post_id",
    "is_repost",
    "original_post_id",
    "created_at",
    "author",
    "like_count",
    "liked_by_viewer",
    "media",
    "mentioned_game_ids",
    # POSTS-001: counters, the viewer's repost flag and the reposted post.
    "reply_count",
    "repost_count",
    "reposted_by_viewer",
    "reposted_post",
}


def test_assemble_post_views_empty_posts_returns_empty_list(session_factory):
    with session_factory() as session:
        result = assemble_post_views(session, [], viewer_id=None)

        assert result == []


def test_assemble_post_views_basic_and_author_fields(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="basic_author")
        post = _make_post(session, author, text="hello feed")

        result = assemble_post_views(session, [post], viewer_id=None)

        assert len(result) == 1
        view = result[0]
        assert view.id == post.id
        assert view.text == "hello feed"
        assert view.is_reply is False
        assert view.parent_post_id is None
        assert view.is_repost is False
        assert view.original_post_id is None
        assert view.author.id == author.id
        assert view.author.username == "basic_author"
        assert view.author.profile_picture_media_id is None


def test_assemble_post_views_like_count_and_liked_by_viewer(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="like_author")
        liker = _make_user(session, username="like_viewer")
        other_liker = _make_user(session, username="like_other")
        post = _make_post(session, author, text="likeable")
        like_post(session, user_id=liker.id, post_id=post.id)
        like_post(session, user_id=other_liker.id, post_id=post.id)

        viewer_result = assemble_post_views(session, [post], viewer_id=liker.id)
        guest_result = assemble_post_views(session, [post], viewer_id=None)

        assert viewer_result[0].like_count == 2
        assert viewer_result[0].liked_by_viewer is True
        assert guest_result[0].like_count == 2
        assert guest_result[0].liked_by_viewer is False


def test_assemble_post_views_includes_only_processed_media(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="media_author")
        post = _make_post(session, author, text="has media")
        processed = Media(
            uploader_id=author.id,
            post_id=post.id,
            status=MediaStatus.PROCESSED,
            s3_key_public="pub.jpg",
            s3_key_thumbnail="thumb.jpg",
        )
        scanning = Media(uploader_id=author.id, post_id=post.id, status=MediaStatus.SCANNING)
        session.add_all([processed, scanning])
        session.commit()

        result = assemble_post_views(session, [post], viewer_id=None)

        assert [m.id for m in result[0].media] == [processed.id]
        assert result[0].media[0].s3_key_public == "pub.jpg"
        assert result[0].media[0].s3_key_thumbnail == "thumb.jpg"


def test_assemble_post_views_mentioned_game_ids(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="mention_author")
        home = _make_team(session, nba_team_id=101)
        away = _make_team(session, nba_team_id=102)
        game = _make_game(session, home, away, nba_game_id=1, date=datetime(2026, 1, 1, tzinfo=UTC))
        post = _make_post(session, author, text="mentions a game")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        result = assemble_post_views(session, [post], viewer_id=None)

        assert result[0].mentioned_game_ids == [game.id]


def test_post_view_has_no_live_scores_field():
    assert "live_scores" not in PostView.model_fields
    assert set(PostView.model_fields) == _POST_VIEW_FIELDS


def test_feed_views_module_has_no_live_score_view_or_lookup():
    assert not hasattr(feed_views, "LiveScoreView")
    assert not hasattr(feed_views, "_live_scores_for_games")


def test_assemble_post_views_takes_no_live_score_proxy():
    assert "live_scores" not in inspect.signature(assemble_post_views).parameters


def test_assemble_post_views_game_in_the_old_live_window_gets_no_live_score(session_factory):
    """A mentioned game dated an hour ago is exactly what used to trigger a
    live-score lookup; now the view is the same as for any other game."""
    with session_factory() as session:
        author = _make_user(session, username="live_author")
        home = _make_team(session, nba_team_id=201)
        away = _make_team(session, nba_team_id=202)
        recent_date = datetime.now(UTC) - timedelta(hours=1)
        game = _make_game(session, home, away, nba_game_id=9001, date=recent_date)
        post = _make_post(session, author, text="live game")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        result = assemble_post_views(session, [post], viewer_id=None)

        assert result[0].mentioned_game_ids == [game.id]
        assert set(result[0].model_dump()) == _POST_VIEW_FIELDS


def test_assemble_post_views_skips_post_with_soft_deleted_author(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="to_delete_author")
        post = _make_post(session, author, text="orphaned post")
        author.deleted_at = datetime.now(UTC)
        session.commit()

        result = assemble_post_views(session, [post], viewer_id=None)

        assert result == []
