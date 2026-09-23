"""Tests for app.notifications.consumer.handle_domain_event -- the
PostEventBus Observer subscriber, per AGENTS.md TDD workflow. Written
before app/notifications/consumer.py exists.

See wiki/CodeContext/Modules/0x05-notifications.md's Observer/business-rules
sections and this unit's task brief for the resolved judgment calls this
consumer implements:
- PostCreated's actual payload is only {"post_id", "author_id"} (no
  is_reply/is_repost flags) -- the consumer re-fetches the Post row by id
  rather than app.posts.facade being modified to add those fields.
- A self-reply/self-repost (recipient == actor) is skipped, not notified --
  not stated explicitly in the business rules, mirrors users/'s existing
  no-self-follow rule.
- Only follow/reply/repost trigger a Notification -- a plain post (neither
  is_reply nor is_repost) and PostReported/PostMentionedEvent are ignored.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.db import Base, make_engine, make_session_factory
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
        "cognito_sub": f"sub-consumer-{overrides.get('username', 'u')}",
        "username": "consumer_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


# --- PostCreated: reply ------------------------------------------------------


def test_reply_creates_notification_for_parent_author(session_factory):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender
    from app.notifications.models import Notification, NotificationType

    with session_factory() as session:
        parent_author = _make_user(session, username="reply_parent_author")
        replier = _make_user(session, username="replier")
        parent = Post(author_id=parent_author.id, text="parent post")
        session.add(parent)
        session.commit()
        reply = Post(author_id=replier.id, text="a reply", is_reply=True, parent_post_id=parent.id)
        session.add(reply)
        session.commit()

        sender = RecordingEmailSender()
        result = handle_domain_event(
            session,
            event_name="PostCreated",
            detail={"post_id": reply.id, "author_id": replier.id},
            email_sender=sender,
        )

        assert result is not None
        assert result.recipient_user_id == parent_author.id
        assert result.actor_user_id == replier.id
        assert result.type == NotificationType.REPLY
        assert result.reference_id == reply.id

        fetched = session.scalar(select(Notification).where(Notification.id == result.id))
        assert fetched is not None


def test_self_reply_is_skipped(session_factory):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender
    from app.notifications.models import Notification

    with session_factory() as session:
        author = _make_user(session, username="self_reply_author")
        parent = Post(author_id=author.id, text="own post")
        session.add(parent)
        session.commit()
        reply = Post(
            author_id=author.id, text="replying to myself", is_reply=True, parent_post_id=parent.id
        )
        session.add(reply)
        session.commit()

        result = handle_domain_event(
            session,
            event_name="PostCreated",
            detail={"post_id": reply.id, "author_id": author.id},
            email_sender=RecordingEmailSender(),
        )

        assert result is None
        count = len(
            session.scalars(
                select(Notification).where(Notification.recipient_user_id == author.id)
            ).all()
        )
        assert count == 0


# --- PostCreated: repost ------------------------------------------------------


def test_repost_creates_notification_for_original_author(session_factory):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender
    from app.notifications.models import NotificationType

    with session_factory() as session:
        original_author = _make_user(session, username="repost_original_author")
        reposter = _make_user(session, username="reposter")
        original = Post(author_id=original_author.id, text="original post")
        session.add(original)
        session.commit()
        repost = Post(author_id=reposter.id, is_repost=True, original_post_id=original.id)
        session.add(repost)
        session.commit()

        result = handle_domain_event(
            session,
            event_name="PostCreated",
            detail={"post_id": repost.id, "author_id": reposter.id},
            email_sender=RecordingEmailSender(),
        )

        assert result is not None
        assert result.recipient_user_id == original_author.id
        assert result.actor_user_id == reposter.id
        assert result.type == NotificationType.REPOST
        assert result.reference_id == repost.id


def test_self_repost_is_skipped(session_factory):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender

    with session_factory() as session:
        author = _make_user(session, username="self_repost_author")
        original = Post(author_id=author.id, text="own post to repost")
        session.add(original)
        session.commit()
        repost = Post(author_id=author.id, is_repost=True, original_post_id=original.id)
        session.add(repost)
        session.commit()

        result = handle_domain_event(
            session,
            event_name="PostCreated",
            detail={"post_id": repost.id, "author_id": author.id},
            email_sender=RecordingEmailSender(),
        )

        assert result is None


# --- PostCreated: plain post ---------------------------------------------------


def test_plain_post_creates_no_notification(session_factory):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender
    from app.notifications.models import Notification

    with session_factory() as session:
        author = _make_user(session, username="plain_post_author")
        post = Post(author_id=author.id, text="just a plain post")
        session.add(post)
        session.commit()

        result = handle_domain_event(
            session,
            event_name="PostCreated",
            detail={"post_id": post.id, "author_id": author.id},
            email_sender=RecordingEmailSender(),
        )

        assert result is None
        assert session.scalars(select(Notification)).first() is None


# --- UserFollowed ---------------------------------------------------------------


def test_user_followed_creates_notification(session_factory):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender
    from app.notifications.models import NotificationType

    with session_factory() as session:
        followed = _make_user(session, username="followed_user")
        follower = _make_user(session, username="follower_user")

        result = handle_domain_event(
            session,
            event_name="UserFollowed",
            detail={"follower_user_id": follower.id, "followed_user_id": followed.id},
            email_sender=RecordingEmailSender(),
        )

        assert result is not None
        assert result.recipient_user_id == followed.id
        assert result.actor_user_id == follower.id
        assert result.type == NotificationType.FOLLOW
        assert result.reference_id == follower.id


# --- Ignored events --------------------------------------------------------------


@pytest.mark.parametrize("event_name", ["PostReported", "PostMentionedEvent", "SomethingElse"])
def test_ignored_events_return_none_and_create_no_row(session_factory, event_name):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender
    from app.notifications.models import Notification

    with session_factory() as session:
        author = _make_user(session, username=f"ignored_{event_name}")
        post = Post(author_id=author.id, text="whatever")
        session.add(post)
        session.commit()

        result = handle_domain_event(
            session,
            event_name=event_name,
            detail={"post_id": post.id, "reporter_id": author.id},
            email_sender=RecordingEmailSender(),
        )

        assert result is None
        assert session.scalars(select(Notification)).first() is None


# --- Email gating by NotificationPreference --------------------------------------


def test_email_sent_by_default_when_no_preference_row_exists(session_factory):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender

    with session_factory() as session:
        followed = _make_user(session, username="default_pref_followed")
        follower = _make_user(session, username="default_pref_follower")

        sender = RecordingEmailSender()
        handle_domain_event(
            session,
            event_name="UserFollowed",
            detail={"follower_user_id": follower.id, "followed_user_id": followed.id},
            email_sender=sender,
        )

        assert len(sender.sent) == 1
        assert sender.sent[0].recipient_cognito_sub == followed.cognito_sub


def test_email_suppressed_when_preference_disabled_but_notification_still_created(
    session_factory,
):
    from app.notifications.consumer import handle_domain_event
    from app.notifications.email import RecordingEmailSender
    from app.notifications.models import Notification, NotificationPreference

    with session_factory() as session:
        followed = _make_user(session, username="disabled_pref_followed")
        follower = _make_user(session, username="disabled_pref_follower")
        session.add(NotificationPreference(user_id=followed.id, email_notifications_enabled=False))
        session.commit()

        sender = RecordingEmailSender()
        result = handle_domain_event(
            session,
            event_name="UserFollowed",
            detail={"follower_user_id": follower.id, "followed_user_id": followed.id},
            email_sender=sender,
        )

        assert sender.sent == []
        assert result is not None
        fetched = session.scalar(select(Notification).where(Notification.id == result.id))
        assert fetched is not None
