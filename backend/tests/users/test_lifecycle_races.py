"""USERS-009 races use real PG blocking graphs and events, never timing sleeps."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier, Event
from time import monotonic

import pytest
from sqlalchemy import select, text

from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.posts.facade import CreatePostRequest, PublishPostFacade
from app.posts.models import Post
from app.posts.moderation import ModerationCheck
from app.users import models, service

WAIT = 15


class Worker:
    def __init__(self, action):
        self.done = Event()
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.future = self.executor.submit(action)
        self.future.add_done_callback(lambda _future: self.done.set())

    def finish(self):
        try:
            self.future.result(timeout=WAIT)
        finally:
            self.executor.shutdown(wait=False, cancel_futures=True)


def test_publish_that_wins_authority_lock_is_included_before_delete_acceptance(lifecycle_case):
    case = lifecycle_case
    owner = case.seed(with_media=False)
    entered, release, delete_started = Event(), Event(), Event()
    pids = {}

    class PausingModeration(ModerationCheck):
        def check(self, context):
            entered.set()
            assert release.wait(WAIT)

    def publish():
        with case.factory() as session:
            pids["publish"] = session.scalar(text("SELECT pg_backend_pid()"))
            PublishPostFacade(
                session, PausingModeration(), PostEventBus(InMemoryEventPublisher())
            ).publish(CreatePostRequest(author_id=owner.user_id, text="accepted before fence"))

    def delete():
        delete_started.set()
        case.delete(owner.sub)

    publisher = Worker(publish)
    assert entered.wait(WAIT)
    deletion = Worker(delete)
    assert delete_started.wait(WAIT)
    blocked = False
    try:
        deadline = monotonic() + WAIT
        with case.engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
            while monotonic() < deadline and not deletion.done.is_set():
                blocked = bool(
                    observer.scalar(
                        text(
                            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                            "WHERE :pid = ANY(pg_blocking_pids(pid)))"
                        ),
                        {"pid": pids["publish"]},
                    )
                )
                if blocked:
                    break
        assert blocked, "deletion must serialize behind the publishing authority transaction"
    finally:
        release.set()
        publisher.finish()
        deletion.finish()
    with case.factory() as session:
        assert session.scalar(select(Post.id).where(Post.author_id == owner.user_id)) is None
        assert session.get(models.AccountAuthority, owner.authority_id).state == "deleted"


def test_preloaded_actor_cannot_commit_profile_change_after_acceptance(lifecycle_case):
    case = lifecycle_case
    owner = case.seed()
    with case.factory() as stale:
        previously_authorized = stale.get(models.User, owner.user_id)
        assert previously_authorized is not None
        # End the read transaction but retain the detached authorization fact.
        stale.rollback()
        case.objects.fail = True
        with pytest.raises(RuntimeError):
            case.delete(owner.sub)
        with pytest.raises(ValueError):
            service.update_profile(
                stale, owner.user_id, fields_set={"description"}, description="late"
            )
        stale.rollback()
    with case.factory() as session:
        assert session.get(models.User, owner.user_id).description != "late"


def test_recovery_cannot_race_a_committed_deletion_fence(lifecycle_case):
    case = lifecycle_case
    owner = case.seed(state="inactive")
    reached, release = Event(), Event()

    def pause_external(_bucket, _payload):
        reached.set()
        assert release.wait(WAIT)

    case.objects.before_delete = pause_external
    deletion = Worker(lambda: case.delete(owner.sub))
    assert reached.wait(WAIT)
    try:
        with case.factory() as session:
            with pytest.raises(ValueError):
                service.recover_user(session, owner.user_id)
            session.rollback()
    finally:
        release.set()
        deletion.finish()
    with case.factory() as session:
        assert session.get(models.AccountAuthority, owner.authority_id).state == "deleted"


def test_two_scheduled_claims_do_not_duplicate_an_unexpired_external_call(lifecycle_case):
    case = lifecycle_case
    owner = case.seed()
    case.provider.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    case.provider.fail = False
    reached, release = Event(), Event()

    def pause_identity(_pool, _sub):
        reached.set()
        assert release.wait(WAIT)

    case.provider.before_delete = pause_identity
    first = Worker(lambda: case.reconcile())
    assert reached.wait(WAIT)
    try:
        # The same injected clock means the first claim is still live.
        second = Worker(lambda: case.reconcile())
        second.finish()
        assert not first.done.is_set()
    finally:
        release.set()
        first.finish()
    assert case.operation(owner.sub).status == "completed"


def test_expired_claim_does_not_make_late_worker_regress_completed_operation(lifecycle_case):
    case = lifecycle_case
    owner = case.seed()
    case.provider.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    case.provider.fail = False
    reached, release = Event(), Event()
    calls = []

    def pause_first(_pool, _sub):
        calls.append(True)
        if len(calls) == 1:
            reached.set()
            assert release.wait(WAIT)

    case.provider.before_delete = pause_first
    first = Worker(lambda: case.reconcile(now=datetime(2099, 1, 1, tzinfo=UTC)))
    assert reached.wait(WAIT)
    try:
        case.reconcile(now=datetime(2100, 1, 1, tzinfo=UTC))
        operation = case.operation(owner.sub)
        assert operation.status == "completed"
        with case.factory() as session:
            assert session.get(models.AccountAuthority, owner.authority_id).state == "deleted"
    finally:
        release.set()
        first.finish()
    final = case.operation(owner.sub)
    assert final.operation_id == operation.operation_id and final.status == "completed"



def test_reciprocal_reposts_acquire_complete_authority_set_without_deadlock(
    lifecycle_case, monkeypatch
):
    """Synchronize only the unsafe actor-only outer lock, after real acquisition.

    Correct code takes the complete sorted ownership set before its first lock;
    a barrier inside that sorted lock sequence would manufacture a deadlock.
    """
    from app.posts import service as posts_service

    case = lifecycle_case
    first, second = case.seed("repost_a", with_media=False), case.seed("repost_b", with_media=False)
    with case.factory() as session:
        originals = [Post(author_id=owner.user_id, text=owner.sub) for owner in (first, second)]
        session.add_all(originals)
        session.commit()
        first_post, second_post = (post.id for post in originals)
    unsafe_outer_locks = Barrier(2)
    original_fence = posts_service.fence_users

    def synchronize_unsafe_lock(session, user_ids, **kwargs):
        original_fence(session, user_ids, **kwargs)
        if len(set(user_ids)) == 1:
            unsafe_outer_locks.wait(timeout=WAIT)

    monkeypatch.setattr(posts_service, "fence_users", synchronize_unsafe_lock)

    class Allow(ModerationCheck):
        def check(self, context):
            pass

    def repost(actor, target):
        with case.factory() as session:
            session.execute(text("SET LOCAL statement_timeout = '10000ms'"))
            facade = PublishPostFacade(session, Allow(), PostEventBus(InMemoryEventPublisher()))
            post, created = posts_service.repost_post(
                session, facade, user_id=actor.user_id, post_id=target
            )
            assert created
            return post.id

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(repost, first, second_post), executor.submit(repost, second, first_post)]
        results = [future.result(timeout=WAIT) for future in futures]
    assert len(set(results)) == 2
    with case.factory() as session:
        rows = session.scalars(select(Post).where(Post.id.in_(results))).all()
        assert {(row.author_id, row.original_post_id) for row in rows} == {
            (first.user_id, second_post), (second.user_id, first_post)
        }



def test_completed_delete_retry_stays_successful_during_retained_object_maintenance(lifecycle_case):
    """A maintenance lease cannot revoke an already committed logical deletion."""
    case = lifecycle_case
    owner = case.seed("completed_maintenance")
    assert case.delete(owner.sub) is None
    completed = case.operation(owner.sub)
    assert completed.status == "completed"
    provider_calls = [call for call in case.calls if call[0] == "cognito"]
    late = (case.settings.media_public_bucket, f"media/{owner.media_id}/public.jpg")
    case.objects.values.add(late)
    entered, release = Event(), Event()

    def pause_cleanup(_bucket, _payload):
        entered.set()
        assert release.wait(WAIT)

    case.objects.before_delete = pause_cleanup
    maintenance = Worker(lambda: case.reconcile(now=datetime(2199, 1, 1, tzinfo=UTC)))
    try:
        assert entered.wait(WAIT)
        leased = case.operation(owner.sub)
        assert leased.status == "completed" and leased.lease_until is not None
        assert case.delete(owner.sub) is None
        retried = case.operation(owner.sub)
        assert (retried.id, retried.operation_id, retried.status) == (
            completed.id, completed.operation_id, "completed"
        )
        assert [call for call in case.calls if call[0] == "cognito"] == provider_calls
        assert not maintenance.done.is_set(), "retry succeeds before retained cleanup finishes"
    finally:
        release.set()
        maintenance.finish()
        case.objects.before_delete = None
    assert late not in case.objects.values
    assert case.operation(owner.sub).status == "completed"
