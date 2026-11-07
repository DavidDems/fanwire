"""USERS-008 deletion service and read-side acceptance contracts.

The public service boundary proposed here is
`app.account_deletion.delete_account_data(session, *, cognito_sub, s3_client,
cognito_client, user_pool_id, quarantine_bucket, public_bucket)`. The route should call it
after identity-path/recent-auth checks. It owns the single DB transaction and
calls AdminDeleteUser only after that transaction commits.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.events.models import Game, Team
from app.main import app as main_app
from app.media.models import Media, MediaStatus
from app.notifications.models import (
    Notification,
    NotificationPreference,
    NotificationType,
)
from app.posts.dependencies import get_moderation_chain
from app.posts.models import EventMention, Post, PostLike, Report
from app.posts.moderation import ModerationCheck, ModerationContext
from app.users.models import Follow, User
from app.users.service import create_user

TOKEN = {"Authorization": "Bearer unchanged-token"}


class _PassThrough(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


class _S3:
    def __init__(self, calls: list[tuple], fail: bool = False, fail_bucket: str | None = None):
        self.calls = calls
        self.fail = fail
        self.fail_bucket = fail_bucket

    def delete_objects(self, *, Bucket: str, Delete: dict) -> dict:
        self.calls.append(("s3", Bucket, tuple(sorted(x["Key"] for x in Delete["Objects"]))))
        if self.fail or Bucket == self.fail_bucket:
            raise RuntimeError("s3 failure")
        return {"Deleted": Delete["Objects"]}


class _Cognito:
    def __init__(self, calls: list[tuple], fail: bool = False, email: str | None = None):
        self.calls = calls
        self.fail = fail
        self.email = email

    def admin_get_user(self, *, UserPoolId: str, Username: str) -> dict:
        attributes = [] if self.email is None else [{"Name": "email", "Value": self.email}]
        return {"UserAttributes": attributes}

    def admin_delete_user(self, *, UserPoolId: str, Username: str) -> dict:
        self.calls.append(("cognito", UserPoolId, Username))
        if self.fail:
            raise RuntimeError("cognito failure")
        return {}


@pytest.fixture()
def factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _account(session, suffix: str) -> User:
    return create_user(
        session,
        cognito_sub=f"sub-users-008-{suffix}",
        username=f"users_008_{suffix}",
        date_of_birth=date(1990, 1, 1),
    )


def _game(session) -> Game:
    home = Team(nba_team_id=80801, name="Home 808", abbreviation="H08", conference="East", division="East")
    away = Team(nba_team_id=80802, name="Away 808", abbreviation="A08", conference="West", division="West")
    session.add_all([home, away])
    session.flush()
    game = Game(
        nba_game_id=80801,
        home_team_id=home.id,
        away_team_id=away.id,
        date=datetime(2026, 1, 1, tzinfo=UTC),
        season="2025-26",
        home_score=1,
        away_score=0,
    )
    session.add(game)
    session.flush()
    return game


def _service():
    from app.account_deletion import delete_account_data

    return delete_account_data


def _delete(
    factory, sub: str, s3: _S3, cognito: _Cognito, calls: list[tuple], *, fail_db: bool = False
) -> None:
    session = factory()
    event.listen(session, "after_commit", lambda _: calls.append(("db_commit",)))
    if fail_db:
        def _fail_before_commit(_session) -> None:
            raise RuntimeError("database failure")

        event.listen(session, "before_commit", _fail_before_commit)
    try:
        _service()(
            session,
            cognito_sub=sub,
            s3_client=s3,
            cognito_client=cognito,
            user_pool_id="pool-test",
            quarantine_bucket="quarantine-test",
            public_bucket="public-test",
        )
    finally:
        session.close()


def test_s3_database_transaction_and_cognito_are_ordered_and_retryable(factory):
    calls: list[tuple] = []
    with factory() as session:
        user = _account(session, "ordered")
        user_id, sub = user.id, user.cognito_sub
        session.add_all(
            [
                Media(uploader_id=user.id, s3_key_quarantine="q/one", status=MediaStatus.UPLOADED),
                Media(uploader_id=user.id, s3_key_public="p/two", status=MediaStatus.PROCESSED),
            ]
        )
        session.commit()

    s3 = _S3(calls)
    _delete(factory, sub, s3, _Cognito(calls), calls)

    assert [x[0] for x in calls] == ["s3", "s3", "db_commit", "cognito"]
    assert {x[1] for x in calls if x[0] == "s3"} == {"quarantine-test", "public-test"}
    assert calls[-1] == ("cognito", "pool-test", sub)
    with factory() as session:
        assert session.get(User, user_id) is None


@pytest.mark.parametrize("failed_stage", ["s3", "db", "cognito"])
def test_each_failure_stops_later_stages_and_a_retry_finishes(factory, failed_stage):
    calls: list[tuple] = []
    with factory() as session:
        user = _account(session, f"retry-{failed_stage}")
        user_id, sub = user.id, user.cognito_sub
        session.add(Media(uploader_id=user.id, s3_key_quarantine=f"q/{failed_stage}", status=MediaStatus.UPLOADED))
        session.commit()

    s3 = _S3(calls, fail=failed_stage == "s3")
    cognito = _Cognito(calls, fail=failed_stage == "cognito")
    if failed_stage == "db":
        with pytest.raises(RuntimeError, match="database failure"):
            _delete(factory, sub, s3, cognito, calls, fail_db=True)
    else:
        with pytest.raises(RuntimeError, match=f"{failed_stage} failure"):
            _delete(factory, sub, s3, cognito, calls)

    assert not any(x[0] == "cognito" for x in calls) if failed_stage != "cognito" else calls[-1][0] == "cognito"
    if failed_stage in {"s3", "db"}:
        with factory() as session:
            assert session.get(User, user_id) is not None
    else:
        with factory() as session:
            assert session.get(User, user_id) is None

    s3.fail = False
    cognito.fail = False
    calls.clear()
    _delete(factory, sub, s3, cognito, calls)
    assert calls[-1] == ("cognito", "pool-test", sub)


def test_second_bucket_failure_retries_after_first_bucket_already_succeeded(factory):
    calls: list[tuple] = []
    with factory() as session:
        user = _account(session, "partial-s3")
        user_id, sub = user.id, user.cognito_sub
        session.add_all(
            [
                Media(uploader_id=user.id, s3_key_quarantine="q/already-deleted", status=MediaStatus.UPLOADED),
                Media(uploader_id=user.id, s3_key_public="p/retry-me", status=MediaStatus.PROCESSED),
            ]
        )
        session.commit()

    s3 = _S3(calls, fail_bucket="public-test")
    cognito = _Cognito(calls)
    with pytest.raises(RuntimeError, match="s3 failure"):
        _delete(factory, sub, s3, cognito, calls)

    assert [call[1] for call in calls if call[0] == "s3"] == ["quarantine-test", "public-test"]
    assert not any(call[0] in {"db_commit", "cognito"} for call in calls)
    with factory() as session:
        assert session.get(User, user_id) is not None

    s3.fail_bucket = None
    calls.clear()
    _delete(factory, sub, s3, cognito, calls)

    assert [call[1] for call in calls if call[0] == "s3"] == ["quarantine-test", "public-test"]
    assert [call[0] for call in calls] == ["s3", "s3", "db_commit", "cognito"]


def test_valid_identity_without_local_user_row_retries_directly_to_cognito(factory):
    calls: list[tuple] = []
    sub = "sub-users-008-no-local-row"
    _delete(factory, sub, _S3(calls), _Cognito(calls), calls)
    assert calls == [("cognito", "pool-test", sub)]


def test_posts_without_other_authors_dependants_are_row_deleted(factory):
    calls: list[tuple] = []
    with factory() as session:
        owner, other = _account(session, "hard-owner"), _account(session, "hard-other")
        root = Post(author_id=owner.id, text="owned root with only an owned reply")
        unrelated = Post(author_id=other.id, text="unrelated surviving post")
        session.add_all([root, unrelated])
        session.flush()
        reply = Post(author_id=owner.id, text="owned reply", is_reply=True, parent_post_id=root.id)
        standalone = Post(author_id=owner.id, text="standalone private post")
        session.add_all([reply, standalone])
        session.flush()
        session.add_all([
            PostLike(user_id=other.id, post_id=standalone.id),
            Report(post_id=standalone.id, reporter_id=other.id),
        ])
        removed_ids = [root.id, reply.id, standalone.id]
        unrelated_id, other_id, owner_id, sub = unrelated.id, other.id, owner.id, owner.cognito_sub
        session.commit()

    _delete(factory, sub, _S3(calls), _Cognito(calls), calls)

    with factory() as session:
        assert session.scalars(select(Post).where(Post.id.in_(removed_ids))).all() == []
        assert session.scalars(select(PostLike).where(PostLike.post_id.in_(removed_ids))).all() == []
        assert session.scalars(select(Report).where(Report.post_id.in_(removed_ids))).all() == []
        assert session.get(User, owner_id) is None
        assert session.get(Post, unrelated_id).author_id == other_id
        assert session.get(Post, unrelated_id).text == "unrelated surviving post"
        assert session.get(User, other_id) is not None


def test_cognito_user_not_found_is_success_and_repeated_deletion_stays_successful(factory):
    calls: list[tuple] = []

    class _MissingCognito(_Cognito):
        def admin_delete_user(self, *, UserPoolId: str, Username: str) -> dict:
            self.calls.append(("cognito", UserPoolId, Username))
            raise ClientError(
                {"Error": {"Code": "UserNotFoundException", "Message": "User does not exist"}},
                "AdminDeleteUser",
            )

    with factory() as session:
        owner = _account(session, "missing-cognito")
        owner_id, sub = owner.id, owner.cognito_sub

    cognito = _MissingCognito(calls)
    _delete(factory, sub, _S3(calls), cognito, calls)
    with factory() as session:
        assert session.get(User, owner_id) is None
    assert [call[0] for call in calls] == ["db_commit", "cognito"]

    calls.clear()
    _delete(factory, sub, _S3(calls), cognito, calls)
    assert calls == [("cognito", "pool-test", sub)]


def test_s3_success_response_with_object_errors_stops_later_stages_and_retries(factory):
    calls: list[tuple] = []

    class _PartialS3(_S3):
        object_error = True

        def delete_objects(self, *, Bucket: str, Delete: dict) -> dict:
            result = super().delete_objects(Bucket=Bucket, Delete=Delete)
            if self.object_error:
                return {
                    "ResponseMetadata": {"HTTPStatusCode": 200},
                    "Deleted": [{"Key": "q/already-deleted"}],
                    "Errors": [{"Key": "q/retry-object", "Code": "AccessDenied", "Message": "Denied"}],
                }
            return result

    with factory() as session:
        owner = _account(session, "partial-object-error")
        post = Post(author_id=owner.id, text="must survive failed S3 deletion")
        session.add(post)
        session.flush()
        media = [
            Media(uploader_id=owner.id, post_id=post.id, s3_key_quarantine=key, status=MediaStatus.UPLOADED)
            for key in ["q/already-deleted", "q/retry-object"]
        ]
        session.add_all(media)
        session.flush()
        owner_id, sub, post_id = owner.id, owner.cognito_sub, post.id
        media_ids = [item.id for item in media]
        session.commit()

    s3, cognito = _PartialS3(calls), _Cognito(calls)
    with pytest.raises(RuntimeError):
        _delete(factory, sub, s3, cognito, calls)
    assert calls == [("s3", "quarantine-test", ("q/already-deleted", "q/retry-object"))]
    with factory() as session:
        assert session.get(User, owner_id) is not None
        assert session.get(Post, post_id) is not None
        assert all(session.get(Media, media_id) is not None for media_id in media_ids)

    s3.object_error = False
    calls.clear()
    _delete(factory, sub, s3, cognito, calls)
    assert calls == [
        ("s3", "quarantine-test", ("q/already-deleted", "q/retry-object")),
        ("db_commit",),
        ("cognito", "pool-test", sub),
    ]
    with factory() as session:
        assert session.get(User, owner_id) is None
        assert session.get(Post, post_id) is None
        assert all(session.get(Media, media_id) is None for media_id in media_ids)


def test_deletion_logs_local_id_and_counts_without_identity_pii(factory, caplog, monkeypatch):
    from app import account_deletion

    # Isolate the logging contract from Alembic fileConfig in earlier tests.
    monkeypatch.setattr(logging.getLogger(account_deletion.logger.name), "disabled", False)
    caplog.set_level(logging.INFO, logger=account_deletion.logger.name)
    records: list[logging.LogRecord] = []

    class _Recording(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = _Recording()
    account_deletion.logger.addHandler(handler)
    try:
        with factory() as session:
            user = _account(session, "log-privacy")
            user_id, sub, username = user.id, user.cognito_sub, user.username
            session.commit()

        email = "users-008-private@example.test"
        _delete(factory, sub, _S3([]), _Cognito([], email=email), [])
    finally:
        account_deletion.logger.removeHandler(handler)

    assert records
    rendered = "\n".join(
        f"{record.getMessage()} {record.__dict__}" for record in records
    )
    assert str(user_id) in rendered
    assert sub not in rendered
    assert username not in rendered
    assert email not in rendered


def test_every_foreign_key_to_users_is_in_the_deletion_fixture_and_absent_afterward(factory):
    with factory() as session:
        target, other = _account(session, "fk-target"), _account(session, "fk-other")
        game = _game(session)
        owned = Post(author_id=target.id, text="owned root")
        theirs = Post(author_id=other.id, text="other root")
        session.add_all([owned, theirs])
        session.flush()
        reply = Post(author_id=other.id, text="their reply", is_reply=True, parent_post_id=owned.id)
        session.add_all(
            [
                reply,
                Follow(follower_user_id=target.id, followed_user_id=other.id),
                Follow(follower_user_id=other.id, followed_user_id=target.id),
                NotificationPreference(user_id=target.id),
                Notification(
                    recipient_user_id=target.id,
                    type=NotificationType.FOLLOW,
                    actor_user_id=other.id,
                    reference_id=other.id,
                ),
                Notification(recipient_user_id=other.id, type=NotificationType.FOLLOW, actor_user_id=target.id),
                Notification(
                    recipient_user_id=other.id,
                    type=NotificationType.FOLLOW,
                    actor_user_id=other.id,
                    reference_id=target.id,
                ),
                Notification(
                    recipient_user_id=other.id,
                    type=NotificationType.REPLY,
                    actor_user_id=other.id,
                    reference_id=owned.id,
                ),
                PostLike(user_id=target.id, post_id=theirs.id),
                PostLike(user_id=other.id, post_id=owned.id),
                Report(post_id=theirs.id, reporter_id=target.id),
                Report(post_id=owned.id, reporter_id=other.id),
                Media(uploader_id=target.id, post_id=owned.id, s3_key_quarantine="q/fk", status=MediaStatus.UPLOADED),
                EventMention(post_id=owned.id, game_id=game.id, raw_token="#GameId80801"),
            ]
        )
        session.flush()
        target.profile_picture_media_id = session.scalar(select(Media.id).where(Media.uploader_id == target.id))
        target_id, sub = target.id, target.cognito_sub
        owned_post_id = owned.id
        session.commit()

    with factory() as session:
        user_fks = [
            fk
            for table in Base.metadata.tables.values()
            for fk in table.foreign_keys
            if fk.column.table.name == "users"
        ]
        for fk in user_fks:
            assert session.execute(select(fk.parent).where(fk.parent == target_id)).first() is not None, (
                "seed a target reference for every user FK",
                fk.parent.table.name,
                fk.parent.name,
            )

    calls: list[tuple] = []
    _delete(factory, sub, _S3(calls), _Cognito(calls), calls)

    with factory() as session:
        user_fks = [
            fk
            for table in Base.metadata.tables.values()
            for fk in table.foreign_keys
            if fk.column.table.name == "users"
        ]
        assert {fk.parent.table.name for fk in user_fks} >= {
            "follows", "notification_preferences", "notifications", "post_likes", "reports", "media", "posts"
        }
        for fk in user_fks:
            assert session.execute(select(fk.parent).where(fk.parent == target_id)).first() is None, (
                fk.parent.table.name,
                fk.parent.name,
            )
        assert session.scalar(select(PostLike).where(PostLike.post_id == owned_post_id)) is None
        assert session.scalar(select(Report).where(Report.post_id == owned_post_id)) is None
        assert session.scalar(select(EventMention).where(EventMention.post_id == owned_post_id)) is None
        assert session.scalar(
            select(Notification).where(
                Notification.type == NotificationType.FOLLOW,
                Notification.reference_id == target_id,
            )
        ) is None
        assert session.scalar(
            select(Notification).where(
                Notification.type.in_((NotificationType.REPLY, NotificationType.REPOST)),
                Notification.reference_id == owned_post_id,
            )
        ) is None
        assert session.get(User, target_id) is None


def test_chain_tombstones_preserve_other_authors_and_all_public_readers(factory):
    calls: list[tuple] = []
    with factory() as session:
        owner, other = _account(session, "chain-owner"), _account(session, "chain-other")
        game = _game(session)
        root = Post(author_id=owner.id, text="private root text", linked_game_id=game.id)
        session.add(root)
        session.flush()
        middle = Post(author_id=owner.id, text="private middle text", is_reply=True, parent_post_id=root.id)
        session.add(middle)
        session.flush()
        attached_media = Media(
            uploader_id=owner.id,
            post_id=middle.id,
            s3_key_public="media/chain-middle/public.jpg",
            s3_key_thumbnail="media/chain-middle/thumbnail.jpg",
            status=MediaStatus.PROCESSED,
        )
        session.add(attached_media)
        session.flush()
        surviving_reply = Post(
            author_id=other.id,
            text="surviving unique reply text",
            is_reply=True,
            parent_post_id=middle.id,
        )
        direct_reply = Post(
            author_id=other.id,
            text="direct surviving reply text",
            is_reply=True,
            parent_post_id=root.id,
        )
        quote = Post(
            author_id=other.id,
            text="surviving unique quote text",
            is_repost=True,
            original_post_id=root.id,
        )
        plain = Post(author_id=other.id, text=None, is_repost=True, original_post_id=root.id)
        session.add_all([surviving_reply, direct_reply, quote, plain])
        viewer = _account(session, "chain-viewer")
        session.add_all(
            [
                PostLike(user_id=viewer.id, post_id=surviving_reply.id),
                PostLike(user_id=viewer.id, post_id=direct_reply.id),
            ]
        )
        session.commit()
        owner_id, sub = owner.id, owner.cognito_sub
        root_id, middle_id = root.id, middle.id
        reply_id, direct_reply_id = surviving_reply.id, direct_reply.id
        quote_id, plain_id = quote.id, plain.id
        attached_media_id = attached_media.id

    s3 = _S3(calls)
    _delete(factory, sub, s3, _Cognito(calls), calls)
    assert any(
        call[0] == "s3"
        and call[1] == "public-test"
        and set(call[2])
        == {"media/chain-middle/public.jpg", "media/chain-middle/thumbnail.jpg"}
        for call in calls
    )
    with factory() as session:
        root = session.get(Post, root_id)
        middle = session.get(Post, middle_id)
        assert root is not None and root.author_id is None and root.text is None and root.deleted_at is not None
        assert middle is not None and middle.author_id is None and middle.text is None and middle.deleted_at is not None
        assert middle.parent_post_id == root_id
        assert all(
            getattr(root, field) is None
            for field in (
                "linked_game_id",
                "linked_player_game_stats_id",
                "linked_player_id",
                "linked_player_scope",
                "linked_line_game_id",
            )
        )
        assert all(
            getattr(middle, field) is None
            for field in (
                "linked_game_id",
                "linked_player_game_stats_id",
                "linked_player_id",
                "linked_player_scope",
                "linked_line_game_id",
            )
        )
        assert session.scalar(select(Media.id).where(Media.post_id.in_([root_id, middle_id]))) is None
        assert session.get(Media, attached_media_id) is None
        assert session.get(User, owner_id) is None
        assert session.get(Post, reply_id).author_id is not None

    saved = dict(main_app.dependency_overrides)

    def _get_session_override():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    main_app.dependency_overrides[get_session] = _get_session_override
    main_app.dependency_overrides[get_event_bus] = lambda: PostEventBus(InMemoryEventPublisher())
    main_app.dependency_overrides[get_moderation_chain] = lambda: _PassThrough()
    try:
        with TestClient(main_app) as client:
            thread = client.get(f"/feed/thread/{root_id}")
            assert thread.status_code == 200
            assert thread.json()["root"] is None
            assert thread.json()["root_deleted"] is True
            assert direct_reply_id in [item["id"] for item in thread.json()["replies"]]

            feed = client.get("/feed")
            assert feed.status_code == 200
            feed_items = {item["id"]: item for item in feed.json()["items"]}
            assert {reply_id, direct_reply_id, quote_id, plain_id} <= feed_items.keys()
            assert root_id not in feed_items and middle_id not in feed_items
            assert feed_items[quote_id]["reposted_post_deleted"] is True
            assert feed_items[plain_id]["reposted_post_deleted"] is True

            search = client.get("/search/posts", params={"q": "surviving unique"})
            assert search.status_code == 200
            search_items = {item["id"]: item for item in search.json()["items"]}
            assert reply_id in search_items and quote_id in search_items
            assert root_id not in search_items and middle_id not in search_items
            assert "private root text" not in search.text
            assert "private middle text" not in search.text
    finally:
        main_app.dependency_overrides.clear()
        main_app.dependency_overrides.update(saved)
