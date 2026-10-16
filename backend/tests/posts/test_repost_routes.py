"""POSTS-001: POST /posts/{post_id}/repost and DELETE /posts/{post_id}/repost,
the one-click repost toggle. Written before either route exists.

Same harness as tests/posts/test_routes.py: a throwaway FastAPI() with just
the posts router, get_session/get_event_bus/get_moderation_chain overridden,
and the facade built from the real get_publish_post_facade wiring -- so a
repost going "through the same publish path as POST /posts" is observable
here as the moderation chain running and PostCreated being published.

The concurrency test uses two real threads, each with its own TestClient and
its own database session, against the suite's real Postgres; see its
docstring for how it forces the race deterministically.
"""

from __future__ import annotations

import threading
from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.events.models import Game, Team
from app.media.models import Media
from app.posts.dependencies import get_moderation_chain
from app.posts.facade import POST_CREATED
from app.posts.models import EventMention, Post, PostLike, Report
from app.posts.moderation import ModerationCheck, ModerationContext
from app.posts.routes import router
from app.users.auth import FakeTokenVerifier
from app.users.dependencies import get_current_user, get_token_verifier
from app.users.models import User


class RecordingModeration(ModerationCheck):
    """Never rejects; records every context it sees, so a test can tell the
    moderation chain ran (i.e. the repost went through PublishPostFacade)."""

    def __init__(self) -> None:
        self.seen: list[ModerationContext] = []

    def check(self, context: ModerationContext) -> None:
        self.seen.append(context)


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def publisher():
    return InMemoryEventPublisher()


@pytest.fixture()
def moderation():
    return RecordingModeration()


@pytest.fixture()
def app(session_factory, publisher, moderation):
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_event_bus] = lambda: PostEventBus(publisher)
    app.dependency_overrides[get_moderation_chain] = lambda: moderation
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _make_user(session, username: str) -> User:
    user = User(cognito_sub=f"sub-{username}", username=username, date_of_birth=date(1990, 1, 1))
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


def _plain_repost(session, author, original) -> Post:
    return _make_post(session, author, text=None, is_repost=True, original_post_id=original.id)


def _quote_repost(session, author, original, text="a quote") -> Post:
    return _make_post(session, author, text=text, is_repost=True, original_post_id=original.id)


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _as_anonymous(app) -> None:
    """The real get_current_user chain with no Authorization header; the
    verifier is faked only so building it needs no Cognito settings."""
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(None)


def _reposts_by(session, user_id: int, original_id: int, *, plain_only: bool = True) -> list[Post]:
    stmt = select(Post).where(
        Post.author_id == user_id,
        Post.is_repost.is_(True),
        Post.original_post_id == original_id,
    )
    if plain_only:
        stmt = stmt.where(Post.text.is_(None))
    return list(session.scalars(stmt.order_by(Post.id)).all())


def _created_events(publisher) -> list[dict]:
    return [e.detail for e in publisher.published if e.name == POST_CREATED]


@pytest.fixture()
def people(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rp_author")
        viewer = _make_user(session, "rp_viewer")
        other = _make_user(session, "rp_other")
        original = _make_post(session, author, text="worth sharing")
    return {"author": author, "viewer": viewer, "other": other, "original": original}


# ------------------------------------------------------- POST /posts/{id}/repost


def test_repost_creates_a_plain_repost_and_answers_201(app, client, session_factory, people):
    viewer, original = people["viewer"], people["original"]
    _as_user(app, viewer)

    response = client.post(f"/posts/{original.id}/repost")

    assert response.status_code == 201
    body = response.json()
    assert body["author_id"] == viewer.id
    assert body["is_repost"] is True
    assert body["original_post_id"] == original.id
    assert body["text"] is None
    assert body["is_reply"] is False
    with session_factory() as session:
        [row] = _reposts_by(session, viewer.id, original.id)
        assert row.id == body["id"]
        attached = session.scalars(select(Media).where(Media.post_id == row.id)).all()
        assert attached == []


def test_repost_goes_through_the_publish_path(app, client, publisher, moderation, people):
    viewer, original = people["viewer"], people["original"]
    _as_user(app, viewer)

    response = client.post(f"/posts/{original.id}/repost")

    assert response.status_code == 201
    new_id = response.json()["id"]
    [created] = _created_events(publisher)
    assert created["post_id"] == new_id
    assert created["author_id"] == viewer.id
    assert len(moderation.seen) == 1
    assert moderation.seen[0].author_id == viewer.id
    assert moderation.seen[0].text is None


def test_second_repost_creates_nothing_and_answers_200_with_the_existing_one(
    app, client, session_factory, publisher, people
):
    viewer, original = people["viewer"], people["original"]
    _as_user(app, viewer)

    first = client.post(f"/posts/{original.id}/repost")
    second = client.post(f"/posts/{original.id}/repost")

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["original_post_id"] == original.id
    with session_factory() as session:
        assert len(_reposts_by(session, viewer.id, original.id)) == 1
    assert len(_created_events(publisher)) == 1


def test_an_existing_plain_repost_made_through_compose_counts_as_already_reposted(
    app, client, session_factory, people
):
    viewer, original = people["viewer"], people["original"]
    with session_factory() as session:
        existing = _plain_repost(session, viewer, original)
    _as_user(app, viewer)

    response = client.post(f"/posts/{original.id}/repost")

    assert response.status_code == 200
    assert response.json()["id"] == existing.id


def test_a_quote_repost_does_not_count_as_already_reposted(app, client, session_factory, people):
    viewer, original = people["viewer"], people["original"]
    with session_factory() as session:
        quote = _quote_repost(session, viewer, original, "my take")
    _as_user(app, viewer)

    response = client.post(f"/posts/{original.id}/repost")

    assert response.status_code == 201
    assert response.json()["id"] != quote.id
    assert response.json()["text"] is None


def test_another_users_repost_does_not_count_as_the_viewers(app, client, session_factory, people):
    viewer, other, original = people["viewer"], people["other"], people["original"]
    with session_factory() as session:
        _plain_repost(session, other, original)
    _as_user(app, viewer)

    response = client.post(f"/posts/{original.id}/repost")

    assert response.status_code == 201
    assert response.json()["author_id"] == viewer.id


def test_reposting_a_plain_repost_reposts_its_original(app, client, session_factory, people):
    viewer, other, original = people["viewer"], people["other"], people["original"]
    with session_factory() as session:
        others_repost = _plain_repost(session, other, original)
    _as_user(app, viewer)

    response = client.post(f"/posts/{others_repost.id}/repost")

    assert response.status_code == 201
    assert response.json()["original_post_id"] == original.id
    with session_factory() as session:
        assert len(_reposts_by(session, viewer.id, original.id)) == 1
        assert _reposts_by(session, viewer.id, others_repost.id) == []


def test_reposting_a_plain_repost_when_the_original_is_already_reposted_answers_200(
    app, client, session_factory, people
):
    viewer, other, original = people["viewer"], people["other"], people["original"]
    with session_factory() as session:
        mine = _plain_repost(session, viewer, original)
        others_repost = _plain_repost(session, other, original)
    _as_user(app, viewer)

    response = client.post(f"/posts/{others_repost.id}/repost")

    assert response.status_code == 200
    assert response.json()["id"] == mine.id


def test_reposting_a_quote_repost_reposts_the_quote_itself(app, client, session_factory, people):
    viewer, other, original = people["viewer"], people["other"], people["original"]
    with session_factory() as session:
        quote = _quote_repost(session, other, original, "a quote with content")
    _as_user(app, viewer)

    response = client.post(f"/posts/{quote.id}/repost")

    assert response.status_code == 201
    assert response.json()["original_post_id"] == quote.id
    assert response.json()["text"] is None


def test_repost_of_an_unknown_post_is_404(app, client, session_factory, publisher, people):
    _as_user(app, people["viewer"])

    response = client.post("/posts/999999/repost")

    assert response.status_code == 404
    assert _created_events(publisher) == []
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Post)) == 1


def test_repost_anonymous_is_401(app, client, session_factory, people):
    _as_anonymous(app)

    response = client.post(f"/posts/{people['original'].id}/repost")

    assert response.status_code == 401
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Post)) == 1


class BarrierModeration(ModerationCheck):
    """Holds each publish inside the moderation chain until the other
    request reaches the same point, or until `timeout` passes.

    Without a lock around "does the viewer already have a plain repost? if
    not, publish one", both requests pass the existence check, both reach
    this barrier, it releases them together and both insert: two reposts.
    With a lock taken before the existence check, the second request blocks
    on the lock and never reaches the barrier; the first waits out the
    timeout, commits and releases the lock, and the second then sees the
    existing repost. So the test is deterministic either way, and costs one
    timeout when the implementation is correct."""

    def __init__(self, timeout: float) -> None:
        self._barrier = threading.Barrier(2, timeout=timeout)

    def check(self, context: ModerationContext) -> None:
        try:
            self._barrier.wait()
        except threading.BrokenBarrierError:
            pass


def test_two_concurrent_reposts_by_the_same_user_create_one(app, session_factory, people):
    viewer, original = people["viewer"], people["original"]
    _as_user(app, viewer)
    # One shared instance: both requests must meet at the same barrier.
    shared = BarrierModeration(timeout=3.0)
    app.dependency_overrides[get_moderation_chain] = lambda: shared

    start = threading.Barrier(2)
    results: list[tuple[int, dict]] = []
    errors: list[BaseException] = []

    def _call() -> None:
        try:
            client = TestClient(app)
            start.wait(timeout=10)
            response = client.post(f"/posts/{original.id}/repost")
            results.append((response.status_code, response.json()))
        except BaseException as exc:  # noqa: BLE001 -- surfaced below, not swallowed
            errors.append(exc)

    threads = [threading.Thread(target=_call) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert errors == []
    assert sorted(status for status, _ in results) == [200, 201]
    assert results[0][1]["id"] == results[1][1]["id"]
    with session_factory() as session:
        assert len(_reposts_by(session, viewer.id, original.id)) == 1


# ----------------------------------------------------- DELETE /posts/{id}/repost


def _seed_game(session) -> Game:
    home = Team(
        nba_team_id=401, name="Home", abbreviation="HOM", conference="Eastern", division="Atlantic"
    )
    away = Team(
        nba_team_id=402, name="Away", abbreviation="AWY", conference="Western", division="Pacific"
    )
    session.add_all([home, away])
    session.commit()
    game = Game(
        nba_game_id=4401,
        home_team_id=home.id,
        away_team_id=away.id,
        date=datetime(2026, 1, 1, tzinfo=UTC),
        season="2025-26",
        home_score=1,
        away_score=0,
    )
    session.add(game)
    session.commit()
    return game


def test_unrepost_removes_the_plain_repost_and_its_likes_reports_and_mentions(
    app, client, session_factory, people
):
    viewer, other, original = people["viewer"], people["other"], people["original"]
    with session_factory() as session:
        repost = _plain_repost(session, viewer, original)
        game = _seed_game(session)
        session.add_all(
            [
                PostLike(user_id=other.id, post_id=repost.id),
                PostLike(user_id=viewer.id, post_id=repost.id),
                Report(post_id=repost.id, reporter_id=other.id),
                EventMention(post_id=repost.id, game_id=game.id, raw_token="#GameId"),
                # Rows on the original are not touched.
                PostLike(user_id=other.id, post_id=original.id),
                Report(post_id=original.id, reporter_id=other.id),
                EventMention(post_id=original.id, game_id=game.id, raw_token="#GameId"),
            ]
        )
        session.commit()
        repost_id = repost.id
    _as_user(app, viewer)

    response = client.delete(f"/posts/{original.id}/repost")

    assert response.status_code == 204
    with session_factory() as session:
        assert session.get(Post, repost_id) is None
        assert session.get(Post, original.id) is not None
        for model in (PostLike, Report, EventMention):
            assert session.scalars(select(model).where(model.post_id == repost_id)).all() == []
            assert (
                len(session.scalars(select(model).where(model.post_id == original.id)).all()) == 1
            )


def test_unrepost_removes_every_plain_repost_the_viewer_has_of_the_post(
    app, client, session_factory, people
):
    viewer, original = people["viewer"], people["original"]
    with session_factory() as session:
        # /compose never prevented duplicates, so existing data can hold several.
        _plain_repost(session, viewer, original)
        _plain_repost(session, viewer, original)
    _as_user(app, viewer)

    response = client.delete(f"/posts/{original.id}/repost")

    assert response.status_code == 204
    with session_factory() as session:
        assert _reposts_by(session, viewer.id, original.id) == []


def test_unrepost_with_nothing_to_remove_answers_204(app, client, session_factory, people):
    _as_user(app, people["viewer"])

    response = client.delete(f"/posts/{people['original'].id}/repost")

    assert response.status_code == 204
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Post)) == 1


def test_unrepost_never_removes_a_quote_repost_or_another_users_repost(
    app, client, session_factory, people
):
    viewer, other, original = people["viewer"], people["other"], people["original"]
    with session_factory() as session:
        _plain_repost(session, viewer, original)
        quote = _quote_repost(session, viewer, original, "keep my quote")
        others = _plain_repost(session, other, original)
        others_quote = _quote_repost(session, other, original, "keep theirs")
        kept = [quote.id, others.id, others_quote.id]
    _as_user(app, viewer)

    response = client.delete(f"/posts/{original.id}/repost")

    assert response.status_code == 204
    with session_factory() as session:
        assert _reposts_by(session, viewer.id, original.id) == []
        for post_id in kept:
            assert session.get(Post, post_id) is not None


def test_unrepost_answers_409_and_removes_nothing_when_a_plain_repost_has_a_reply(
    app, client, session_factory, people
):
    viewer, other, original = people["viewer"], people["other"], people["original"]
    with session_factory() as session:
        bare = _plain_repost(session, viewer, original)
        replied = _plain_repost(session, viewer, original)
        _make_post(
            session, other, text="replying to a repost", is_reply=True, parent_post_id=replied.id
        )
        session.add(PostLike(user_id=other.id, post_id=bare.id))
        session.commit()
        bare_id, replied_id = bare.id, replied.id
    _as_user(app, viewer)

    response = client.delete(f"/posts/{original.id}/repost")

    assert response.status_code == 409
    with session_factory() as session:
        assert session.get(Post, bare_id) is not None
        assert session.get(Post, replied_id) is not None
        assert session.scalars(select(PostLike).where(PostLike.post_id == bare_id)).all() != []


def test_unrepost_anonymous_is_401(app, client, session_factory, people):
    with session_factory() as session:
        repost = _plain_repost(session, people["viewer"], people["original"])
    _as_anonymous(app)

    response = client.delete(f"/posts/{people['original'].id}/repost")

    assert response.status_code == 401
    with session_factory() as session:
        assert session.get(Post, repost.id) is not None


def test_repost_then_unrepost_then_repost_again(app, client, session_factory, people):
    viewer, original = people["viewer"], people["original"]
    _as_user(app, viewer)

    assert client.post(f"/posts/{original.id}/repost").status_code == 201
    assert client.delete(f"/posts/{original.id}/repost").status_code == 204
    again = client.post(f"/posts/{original.id}/repost")

    assert again.status_code == 201
    with session_factory() as session:
        [row] = _reposts_by(session, viewer.id, original.id)
        assert row.id == again.json()["id"]


# --------------------------------------------------- POST /posts is unchanged


def test_compose_plain_repost_still_works(app, client, publisher, people):
    viewer, original = people["viewer"], people["original"]
    _as_user(app, viewer)

    response = client.post("/posts", json={"is_repost": True, "original_post_id": original.id})

    assert response.status_code == 201
    assert response.json()["is_repost"] is True
    assert response.json()["original_post_id"] == original.id
    assert response.json()["text"] is None
    assert [e["post_id"] for e in _created_events(publisher)] == [response.json()["id"]]


def test_compose_quote_repost_still_works_alongside_a_plain_repost(
    app, client, session_factory, people
):
    viewer, original = people["viewer"], people["original"]
    _as_user(app, viewer)

    plain = client.post(f"/posts/{original.id}/repost")
    quote = client.post(
        "/posts",
        json={"text": "quote after repost", "is_repost": True, "original_post_id": original.id},
    )

    assert plain.status_code == 201
    assert quote.status_code == 201
    assert quote.json()["text"] == "quote after repost"
    assert quote.json()["original_post_id"] == original.id
    with session_factory() as session:
        assert len(_reposts_by(session, viewer.id, original.id, plain_only=False)) == 2
