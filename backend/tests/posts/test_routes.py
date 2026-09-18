"""Tests for posts/ HTTP routes, per AGENTS.md TDD workflow. Written before
app/posts/routes.py and app/posts/schemas.py exist.

Router isn't wired into app.main yet in this test -- a throwaway local
FastAPI() app includes just the posts router, same pattern as
backend/tests/users/test_routes.py and backend/tests/media/test_routes.py.
Overrides get_current_user/get_session/get_event_bus/get_moderation_chain
(the facade itself is built from the real get_publish_post_facade wired
against those overrides, so this also exercises the real DI wiring, not
just the route handlers in isolation).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.events.models import Game, Team
from app.media.models import Media, MediaStatus
from app.posts.dependencies import get_moderation_chain
from app.posts.models import EventMention, Post, Report
from app.posts.moderation import ModerationCheck, ModerationContext, PostRejected
from app.posts.routes import router
from app.posts.service import like_post, report_post
from app.users.dependencies import get_current_user
from app.users.models import User


class NeverRejects(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


class AlwaysRejects(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        raise PostRejected("always rejects")


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


@pytest.fixture()
def app(session_factory):
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_event_bus] = lambda: PostEventBus(InMemoryEventPublisher())
    app.dependency_overrides[get_moderation_chain] = lambda: NeverRejects()
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-{id(overrides)}-{overrides.get('username', 'u')}",
        "username": "routes_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _seed_game(session, **overrides) -> Game:
    home = Team(
        api_sports_team_id=301,
        name="Miami Heat",
        abbreviation="MIA",
        conference="Eastern",
        division="Southeast",
    )
    away = Team(
        api_sports_team_id=302,
        name="Golden State Warriors",
        abbreviation="GSW",
        conference="Western",
        division="Pacific",
    )
    session.add_all([home, away])
    session.commit()

    defaults = {
        "api_sports_game_id": 888,
        "home_team_id": home.id,
        "away_team_id": away.id,
        "date": datetime(2026, 1, 1, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 110,
        "away_score": 108,
    }
    defaults.update(overrides)
    game = Game(**defaults)
    session.add(game)
    session.commit()
    return game


# --- POST /posts ------------------------------------------------------------


def test_create_plain_post_succeeds(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-plain", username="plain_author")
        author_id = author.id
    _as_user(app, author)

    response = client.post("/posts", json={"text": "hello world"})

    assert response.status_code == 201
    body = response.json()
    assert body["author_id"] == author_id
    assert body["text"] == "hello world"
    assert body["is_reply"] is False
    assert body["is_repost"] is False
    assert body["reported"] is False
    assert "id" in body
    assert "created_at" in body


def test_create_reply_succeeds(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-reply-author", username="reply_author")
        parent_author = _make_user(
            session, cognito_sub="sub-reply-parent", username="reply_parent_author"
        )
        parent = Post(author_id=parent_author.id, text="parent post")
        session.add(parent)
        session.commit()
        parent_id = parent.id
    _as_user(app, author)

    response = client.post(
        "/posts", json={"text": "a reply", "is_reply": True, "parent_post_id": parent_id}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["is_reply"] is True
    assert body["parent_post_id"] == parent_id


def test_create_plain_repost_succeeds(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-repost-author", username="repost_author")
        original_author = _make_user(
            session, cognito_sub="sub-repost-orig", username="repost_orig_author"
        )
        original = Post(author_id=original_author.id, text="original post")
        session.add(original)
        session.commit()
        original_id = original.id
    _as_user(app, author)

    response = client.post(
        "/posts", json={"is_repost": True, "original_post_id": original_id}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["is_repost"] is True
    assert body["original_post_id"] == original_id
    assert body["text"] is None


def test_create_quote_repost_succeeds(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-quote-author", username="quote_author")
        original_author = _make_user(
            session, cognito_sub="sub-quote-orig", username="quote_orig_author"
        )
        original = Post(author_id=original_author.id, text="original post to quote")
        session.add(original)
        session.commit()
        original_id = original.id
    _as_user(app, author)

    response = client.post(
        "/posts",
        json={"text": "quoting this!", "is_repost": True, "original_post_id": original_id},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["is_repost"] is True
    assert body["text"] == "quoting this!"


def test_create_post_with_game_mention_resolves_event_mention(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-mention", username="mention_author")
        game = _seed_game(session)
        game_id = game.id
    _as_user(app, author)

    response = client.post("/posts", json={"text": f"what a game #GameId{game_id}"})

    assert response.status_code == 201
    post_id = response.json()["id"]
    with session_factory() as session:
        mention = session.query(EventMention).filter(EventMention.post_id == post_id).first()
        assert mention is not None
        assert mention.game_id == game_id


def test_create_post_with_processed_media_attaches_it(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-media", username="media_author")
        media = Media(uploader_id=author.id, status=MediaStatus.PROCESSED)
        session.add(media)
        session.commit()
        media_id = media.id
    _as_user(app, author)

    response = client.post(
        "/posts", json={"text": "check this out", "media_ids": [media_id]}
    )

    assert response.status_code == 201
    post_id = response.json()["id"]
    with session_factory() as session:
        fetched_media = session.get(Media, media_id)
        assert fetched_media.post_id == post_id


def test_create_post_moderation_rejection_returns_400(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-mod", username="mod_author")
    _as_user(app, author)
    app.dependency_overrides[get_moderation_chain] = lambda: AlwaysRejects()

    response = client.post("/posts", json={"text": "whatever"})

    assert response.status_code == 400
    assert response.json()["detail"] == "always rejects"


def test_create_post_with_nonexistent_media_returns_404(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-media-404", username="media_404_author")
    _as_user(app, author)

    response = client.post("/posts", json={"text": "bad media", "media_ids": [999999]})

    assert response.status_code == 404


def test_create_post_with_unprocessed_media_returns_409(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-media-409", username="media_409_author")
        media = Media(uploader_id=author.id, status=MediaStatus.UPLOADED)
        session.add(media)
        session.commit()
        media_id = media.id
    _as_user(app, author)

    response = client.post(
        "/posts", json={"text": "unprocessed media", "media_ids": [media_id]}
    )

    assert response.status_code == 409


def test_create_post_reply_true_without_parent_post_id_returns_400(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-bad-reply", username="bad_reply_author")
    _as_user(app, author)

    response = client.post("/posts", json={"text": "a reply with no parent", "is_reply": True})

    assert response.status_code == 400


# --- GET /posts/{post_id} ----------------------------------------------------


def test_get_post_returns_200_for_existing_post(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-get", username="get_author")
        post = Post(author_id=author.id, text="gettable post")
        session.add(post)
        session.commit()
        post_id = post.id

    response = client.get(f"/posts/{post_id}")

    assert response.status_code == 200
    assert response.json()["id"] == post_id
    assert response.json()["text"] == "gettable post"


def test_get_post_returns_404_for_missing_post(client):
    response = client.get("/posts/999999")

    assert response.status_code == 404


# --- GET /posts/{post_id}/replies -------------------------------------------


def test_list_replies_returns_empty_list_for_post_with_no_replies(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-noreplies", username="no_replies_author")
        post = Post(author_id=author.id, text="lonely post")
        session.add(post)
        session.commit()
        post_id = post.id

    response = client.get(f"/posts/{post_id}/replies")

    assert response.status_code == 200
    assert response.json() == []


def test_list_replies_returns_empty_list_for_nonexistent_post(client):
    response = client.get("/posts/999999/replies")

    assert response.status_code == 200
    assert response.json() == []


def test_list_replies_returns_direct_replies_ordered_oldest_first(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-threaded", username="threaded_author")
        parent = Post(author_id=author.id, text="thread root")
        session.add(parent)
        session.commit()

        base = datetime(2026, 1, 1, tzinfo=UTC)
        newer = Post(
            author_id=author.id,
            text="newer reply",
            is_reply=True,
            parent_post_id=parent.id,
            created_at=base + timedelta(minutes=5),
        )
        older = Post(
            author_id=author.id,
            text="older reply",
            is_reply=True,
            parent_post_id=parent.id,
            created_at=base,
        )
        # A reply to a *different* post must never show up here.
        other_parent = Post(author_id=author.id, text="a different thread root")
        session.add_all([newer, older, other_parent])
        session.commit()
        unrelated_reply = Post(
            author_id=author.id,
            text="unrelated reply",
            is_reply=True,
            parent_post_id=other_parent.id,
        )
        session.add(unrelated_reply)
        session.commit()
        parent_id = parent.id

    response = client.get(f"/posts/{parent_id}/replies")

    assert response.status_code == 200
    body = response.json()
    assert [r["text"] for r in body] == ["older reply", "newer reply"]


# --- POST/DELETE /posts/{post_id}/like ---------------------------------------


def test_like_post_succeeds(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-like-author", username="like_author")
        liker = _make_user(session, cognito_sub="sub-liker", username="liker")
        post = Post(author_id=author.id, text="likeable post")
        session.add(post)
        session.commit()
        post_id = post.id
    _as_user(app, liker)

    response = client.post(f"/posts/{post_id}/like")

    assert response.status_code == 204


def test_like_post_duplicate_returns_409(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-dup-like-author", username="dup_like_author")
        liker = _make_user(session, cognito_sub="sub-dup-liker", username="dup_liker")
        post = Post(author_id=author.id, text="likeable post")
        session.add(post)
        session.commit()
        like_post(session, user_id=liker.id, post_id=post.id)
        post_id = post.id
    _as_user(app, liker)

    response = client.post(f"/posts/{post_id}/like")

    assert response.status_code == 409


def test_unlike_post_succeeds(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-unlike-author", username="unlike_author")
        liker = _make_user(session, cognito_sub="sub-unliker", username="unliker")
        post = Post(author_id=author.id, text="unlikeable post")
        session.add(post)
        session.commit()
        like_post(session, user_id=liker.id, post_id=post.id)
        post_id = post.id
    _as_user(app, liker)

    response = client.delete(f"/posts/{post_id}/like")

    assert response.status_code == 204


def test_unlike_post_when_not_liked_returns_404(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(
            session, cognito_sub="sub-notliked-author", username="notliked_author"
        )
        liker = _make_user(session, cognito_sub="sub-notliker", username="notliker")
        post = Post(author_id=author.id, text="never liked post")
        session.add(post)
        session.commit()
        post_id = post.id
    _as_user(app, liker)

    response = client.delete(f"/posts/{post_id}/like")

    assert response.status_code == 404


# --- POST /posts/{post_id}/report --------------------------------------------


def test_report_post_first_time_returns_204_and_creates_row(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-report-author", username="report_author")
        reporter = _make_user(session, cognito_sub="sub-reporter", username="reporter")
        post = Post(author_id=author.id, text="reportable post")
        session.add(post)
        session.commit()
        post_id = post.id
    _as_user(app, reporter)

    response = client.post(f"/posts/{post_id}/report")

    assert response.status_code == 204
    with session_factory() as session:
        reports = (
            session.query(Report)
            .filter(Report.post_id == post_id, Report.reporter_id == reporter.id)
            .all()
        )
        assert len(reports) == 1


def test_report_post_duplicate_returns_204_and_creates_no_second_row(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(
            session, cognito_sub="sub-dup-report-author", username="dup_report_author"
        )
        reporter = _make_user(session, cognito_sub="sub-dup-reporter", username="dup_reporter")
        post = Post(author_id=author.id, text="reportable post")
        session.add(post)
        session.commit()
        report_post(session, PostEventBus(InMemoryEventPublisher()), post_id=post.id, reporter_id=reporter.id)
        post_id = post.id
    _as_user(app, reporter)

    response = client.post(f"/posts/{post_id}/report")

    assert response.status_code == 204
    with session_factory() as session:
        reports = (
            session.query(Report)
            .filter(Report.post_id == post_id, Report.reporter_id == reporter.id)
            .all()
        )
        assert len(reports) == 1


def test_report_post_nonexistent_returns_404(app, client, session_factory):
    with session_factory() as session:
        reporter = _make_user(
            session, cognito_sub="sub-report-404", username="report_404_reporter"
        )
    _as_user(app, reporter)

    response = client.post("/posts/999999/report")

    assert response.status_code == 404
