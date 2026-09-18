"""Tests for app.feed.views.assemble_post_views, per AGENTS.md TDD
workflow. Written before app/feed/views.py exists.

assemble_post_views batches every cross-module lookup (posts/media/events'
public read functions) into one call per read function per page -- no
N+1 -- and folds live scores in only for mentioned games whose `date`
falls within the last 4 hours (Game has no status column; this is a
documented heuristic, not derived from real game state). A proxy that
raises or returns None must never fail the whole call -- that post's
`live_scores` is simply empty.

search/ (a later unit, per this unit's task brief) reuses this exact
function, so its signature/return shape is treated as a public contract
here, not an implementation detail.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.interfaces import NormalizedLiveScore, SportsDataSource
from app.events.models import Game, Team
from app.events.proxy import CachedEventProxy, InMemoryLiveScoreCache
from app.feed.views import assemble_post_views
from app.media.models import Media, MediaStatus
from app.posts.models import EventMention, Post
from app.posts.service import like_post
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
        "api_sports_team_id": 1,
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
        "api_sports_game_id": 5001,
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


class _FixedScoreSource(SportsDataSource):
    def __init__(self, score: NormalizedLiveScore | None) -> None:
        self._score = score

    def fetch_teams(self):
        return []

    def fetch_games(self, *, since=None):
        return []

    def fetch_live_score(self, api_sports_game_id: int):
        return self._score


class _RaisingSource(SportsDataSource):
    def fetch_teams(self):
        return []

    def fetch_games(self, *, since=None):
        return []

    def fetch_live_score(self, api_sports_game_id: int):
        raise RuntimeError("vendor is down")


def test_assemble_post_views_empty_posts_returns_empty_list(session_factory):
    with session_factory() as session:
        result = assemble_post_views(session, [], viewer_id=None, live_scores=None)

        assert result == []


def test_assemble_post_views_basic_and_author_fields(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="basic_author")
        post = _make_post(session, author, text="hello feed")

        result = assemble_post_views(session, [post], viewer_id=None, live_scores=None)

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

        viewer_result = assemble_post_views(
            session, [post], viewer_id=liker.id, live_scores=None
        )
        guest_result = assemble_post_views(session, [post], viewer_id=None, live_scores=None)

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

        result = assemble_post_views(session, [post], viewer_id=None, live_scores=None)

        assert [m.id for m in result[0].media] == [processed.id]
        assert result[0].media[0].s3_key_public == "pub.jpg"
        assert result[0].media[0].s3_key_thumbnail == "thumb.jpg"


def test_assemble_post_views_mentioned_game_ids(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="mention_author")
        home = _make_team(session, api_sports_team_id=101)
        away = _make_team(session, api_sports_team_id=102)
        game = _make_game(
            session, home, away, api_sports_game_id=1, date=datetime(2026, 1, 1, tzinfo=UTC)
        )
        post = _make_post(session, author, text="mentions a game")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        result = assemble_post_views(session, [post], viewer_id=None, live_scores=None)

        assert result[0].mentioned_game_ids == [game.id]
        assert result[0].live_scores == []  # no proxy given


def test_assemble_post_views_live_score_within_window(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="live_author")
        home = _make_team(session, api_sports_team_id=201)
        away = _make_team(session, api_sports_team_id=202)
        recent_date = datetime.now(UTC) - timedelta(hours=1)
        game = _make_game(
            session, home, away, api_sports_game_id=9001, date=recent_date
        )
        post = _make_post(session, author, text="live game")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        score = NormalizedLiveScore(
            api_sports_game_id=9001, home_score=50, away_score=48, status="in_progress"
        )
        proxy = CachedEventProxy(_FixedScoreSource(score), InMemoryLiveScoreCache())

        result = assemble_post_views(session, [post], viewer_id=None, live_scores=proxy)

        assert len(result[0].live_scores) == 1
        live = result[0].live_scores[0]
        assert live.game_id == game.id
        assert live.home_score == 50
        assert live.away_score == 48
        assert live.status == "in_progress"


def test_assemble_post_views_live_score_outside_window_is_omitted(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="stale_author")
        home = _make_team(session, api_sports_team_id=301)
        away = _make_team(session, api_sports_team_id=302)
        stale_date = datetime.now(UTC) - timedelta(hours=5)
        game = _make_game(session, home, away, api_sports_game_id=9002, date=stale_date)
        post = _make_post(session, author, text="old game")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        score = NormalizedLiveScore(
            api_sports_game_id=9002, home_score=10, away_score=9, status="final"
        )
        proxy = CachedEventProxy(_FixedScoreSource(score), InMemoryLiveScoreCache())

        result = assemble_post_views(session, [post], viewer_id=None, live_scores=proxy)

        assert result[0].live_scores == []


def test_assemble_post_views_future_game_is_omitted(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="future_author")
        home = _make_team(session, api_sports_team_id=401)
        away = _make_team(session, api_sports_team_id=402)
        future_date = datetime.now(UTC) + timedelta(hours=2)
        game = _make_game(session, home, away, api_sports_game_id=9003, date=future_date)
        post = _make_post(session, author, text="upcoming game")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        score = NormalizedLiveScore(
            api_sports_game_id=9003, home_score=0, away_score=0, status="scheduled"
        )
        proxy = CachedEventProxy(_FixedScoreSource(score), InMemoryLiveScoreCache())

        result = assemble_post_views(session, [post], viewer_id=None, live_scores=proxy)

        assert result[0].live_scores == []


def test_assemble_post_views_proxy_none_is_never_a_failure(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="none_proxy_author")
        home = _make_team(session, api_sports_team_id=501)
        away = _make_team(session, api_sports_team_id=502)
        game = _make_game(
            session,
            home,
            away,
            api_sports_game_id=9004,
            date=datetime.now(UTC) - timedelta(hours=1),
        )
        post = _make_post(session, author, text="game but no proxy")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        result = assemble_post_views(session, [post], viewer_id=None, live_scores=None)

        assert result[0].live_scores == []


def test_assemble_post_views_proxy_raising_never_fails_the_request(session_factory, caplog):
    with session_factory() as session:
        author = _make_user(session, username="raising_author")
        home = _make_team(session, api_sports_team_id=601)
        away = _make_team(session, api_sports_team_id=602)
        game = _make_game(
            session,
            home,
            away,
            api_sports_game_id=9005,
            date=datetime.now(UTC) - timedelta(hours=1),
        )
        post = _make_post(session, author, text="proxy explodes")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        proxy = CachedEventProxy(_RaisingSource(), InMemoryLiveScoreCache())

        with caplog.at_level("WARNING"):
            result = assemble_post_views(session, [post], viewer_id=None, live_scores=proxy)

        assert result[0].live_scores == []
        assert len(caplog.records) >= 1


def test_assemble_post_views_skips_post_with_soft_deleted_author(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="to_delete_author")
        post = _make_post(session, author, text="orphaned post")
        author.deleted_at = datetime.now(UTC)
        session.commit()

        result = assemble_post_views(session, [post], viewer_id=None, live_scores=None)

        assert result == []
