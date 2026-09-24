"""Round-trip tests for the posts/ models against a real Postgres, per
AGENTS.md TDD workflow. Written before app/posts/models.py exists.

See wiki/CodeContext/Modules/0x03-posts.md for the Post/PostLike/
EventMention/Report schema.
"""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team
from app.posts.models import EventMention, Post, PostLike, Report
from app.users.models import User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(**overrides):
    defaults = {
        "cognito_sub": "sub-1",
        "username": "alice",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    return User(**defaults)


def _make_game(**overrides):
    home = Team(
        api_sports_team_id=overrides.pop("home_api_sports_team_id", 101),
        name="Boston Celtics",
        abbreviation="BOS",
        conference="Eastern",
        division="Atlantic",
    )
    away = Team(
        api_sports_team_id=overrides.pop("away_api_sports_team_id", 102),
        name="Los Angeles Lakers",
        abbreviation="LAL",
        conference="Western",
        division="Pacific",
    )
    return home, away, overrides


def test_post_round_trip(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        post = Post(author_id=author.id, text="hello world")
        session.add(post)
        session.commit()

        fetched = session.scalar(select(Post).where(Post.id == post.id))
        assert fetched is not None
        assert fetched.text == "hello world"
        assert fetched.author_id == author.id
        assert fetched.is_reply is False
        assert fetched.parent_post_id is None
        assert fetched.is_repost is False
        assert fetched.original_post_id is None
        assert fetched.reported is False
        assert fetched.created_at is not None


def test_reply_persists_with_parent_post_id(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        original = Post(author_id=author.id, text="original")
        session.add(original)
        session.commit()

        reply = Post(
            author_id=author.id,
            text="a reply",
            is_reply=True,
            parent_post_id=original.id,
        )
        session.add(reply)
        session.commit()

        fetched = session.scalar(select(Post).where(Post.id == reply.id))
        assert fetched.is_reply is True
        assert fetched.parent_post_id == original.id


def test_reply_without_parent_post_id_violates_check_constraint(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        session.add(Post(author_id=author.id, text="bad reply", is_reply=True))
        with pytest.raises(IntegrityError):
            session.commit()


def test_plain_repost_persists_with_empty_text(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        original = Post(author_id=author.id, text="original")
        session.add(original)
        session.commit()

        repost = Post(
            author_id=author.id,
            text=None,
            is_repost=True,
            original_post_id=original.id,
        )
        session.add(repost)
        session.commit()

        fetched = session.scalar(select(Post).where(Post.id == repost.id))
        assert fetched.is_repost is True
        assert fetched.original_post_id == original.id
        assert fetched.text is None


def test_quote_repost_persists_with_non_empty_text(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        original = Post(author_id=author.id, text="original")
        session.add(original)
        session.commit()

        quote_repost = Post(
            author_id=author.id,
            text="my commentary",
            is_repost=True,
            original_post_id=original.id,
        )
        session.add(quote_repost)
        session.commit()

        fetched = session.scalar(select(Post).where(Post.id == quote_repost.id))
        assert fetched.is_repost is True
        assert fetched.original_post_id == original.id
        assert fetched.text == "my commentary"


def test_repost_without_original_post_id_violates_check_constraint(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        session.add(Post(author_id=author.id, text=None, is_repost=True))
        with pytest.raises(IntegrityError):
            session.commit()


def test_post_reported_defaults_to_false(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        post = Post(author_id=author.id, text="not reported yet")
        session.add(post)
        session.commit()

        fetched = session.scalar(select(Post).where(Post.id == post.id))
        assert fetched.reported is False


def test_post_like_round_trip(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-author", username="author_user")
        liker = _make_user(cognito_sub="sub-liker", username="liker_user")
        session.add_all([author, liker])
        session.commit()

        post = Post(author_id=author.id, text="likeable")
        session.add(post)
        session.commit()

        like = PostLike(user_id=liker.id, post_id=post.id)
        session.add(like)
        session.commit()

        fetched = session.scalar(
            select(PostLike).where(PostLike.user_id == liker.id, PostLike.post_id == post.id)
        )
        assert fetched is not None
        assert fetched.created_at is not None


def test_post_like_composite_uniqueness(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-author2", username="author_user2")
        liker = _make_user(cognito_sub="sub-liker2", username="liker_user2")
        session.add_all([author, liker])
        session.commit()

        post = Post(author_id=author.id, text="likeable twice")
        session.add(post)
        session.commit()

        session.add(PostLike(user_id=liker.id, post_id=post.id))
        session.commit()

        session.add(PostLike(user_id=liker.id, post_id=post.id))
        with pytest.raises(IntegrityError):
            session.commit()


def test_event_mention_round_trip(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        home, away, _ = _make_game()
        session.add_all([home, away])
        session.commit()

        game = Game(
            api_sports_game_id=555,
            home_team_id=home.id,
            away_team_id=away.id,
            date=datetime(2026, 1, 1, tzinfo=UTC),
            season="2025-26",
            home_score=100,
            away_score=98,
        )
        session.add(game)
        session.commit()

        post = Post(author_id=author.id, text="check out $BOS vs $LAL")
        session.add(post)
        session.commit()

        mention = EventMention(post_id=post.id, game_id=game.id, raw_token="$BOS")
        session.add(mention)
        session.commit()

        fetched = session.scalar(select(EventMention).where(EventMention.post_id == post.id))
        assert fetched is not None
        assert fetched.game_id == game.id
        assert fetched.raw_token == "$BOS"
        assert fetched.created_at is not None


def test_event_mention_requires_existing_game(session_factory):
    with session_factory() as session:
        author = _make_user()
        session.add(author)
        session.commit()

        post = Post(author_id=author.id, text="mentions a fake game")
        session.add(post)
        session.commit()

        session.add(EventMention(post_id=post.id, game_id=999_999, raw_token="#GameId999999"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_report_round_trip(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-author3", username="author_user3")
        reporter = _make_user(cognito_sub="sub-reporter", username="reporter_user")
        session.add_all([author, reporter])
        session.commit()

        post = Post(author_id=author.id, text="reportable")
        session.add(post)
        session.commit()

        report = Report(post_id=post.id, reporter_id=reporter.id)
        session.add(report)
        session.commit()

        fetched = session.scalar(select(Report).where(Report.post_id == post.id))
        assert fetched is not None
        assert fetched.reporter_id == reporter.id
        assert fetched.created_at is not None


def test_report_uniqueness_per_post_and_reporter(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-author4", username="author_user4")
        reporter = _make_user(cognito_sub="sub-reporter2", username="reporter_user2")
        session.add_all([author, reporter])
        session.commit()

        post = Post(author_id=author.id, text="reportable twice")
        session.add(post)
        session.commit()

        session.add(Report(post_id=post.id, reporter_id=reporter.id))
        session.commit()

        session.add(Report(post_id=post.id, reporter_id=reporter.id))
        with pytest.raises(IntegrityError):
            session.commit()
