"""Faults at actual external/DB boundaries; recovery needs no HTTP retry.

reconcile_account_deletions(factory, *, settings, s3_client, cognito_client,
now, batch_size, max_objects) is the bounded public scheduler service. Its
returned summary has integer examined/completed/retrying counts and no PII.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app import account_deletion
from app.media.models import Media
from app.posts.models import Post
from app.users import models


def _manifest(case, operation):
    with case.factory() as session:
        rows = session.scalars(
            select(models.AccountDeletionObject).where(
                models.AccountDeletionObject.operation_id == operation.id
            )
        ).all()
        return {(row.bucket, row.key) for row in rows}


def test_acceptance_is_committed_before_first_external_delete(lifecycle_case):
    case = lifecycle_case
    owner = case.seed()
    observed = []

    def inspect_committed_truth(bucket, payload):
        operation = case.operation(owner.sub)
        assert operation is not None and operation.kind == "delete"
        with case.factory() as independent:
            authority = independent.get(models.AccountAuthority, owner.authority_id)
            assert authority.state == "deleting"
            assert independent.get(models.User, owner.user_id).deleted_at is not None
        manifest = _manifest(case, operation)
        assert {(bucket, item["Key"]) for item in payload["Objects"]} <= manifest
        observed.append(operation.operation_id)

    case.objects.before_delete = inspect_committed_truth
    case.delete(owner.sub)
    assert observed and len(set(observed)) == 1


def test_failed_acceptance_does_no_external_work(lifecycle_case, monkeypatch):
    case = lifecycle_case
    owner = case.seed()
    with case.factory() as session:
        monkeypatch.setattr(
            session, "commit", lambda: (_ for _ in ()).throw(RuntimeError("lost commit"))
        )
        with pytest.raises(RuntimeError):
            account_deletion.delete_account_data(
                session,
                cognito_sub=owner.sub,
                user_pool_id=case.settings.cognito_user_pool_id,
                quarantine_bucket=case.settings.media_quarantine_bucket,
                public_bucket=case.settings.media_public_bucket,
                s3_client=case.objects,
                cognito_client=case.provider,
            )
        session.rollback()
    assert case.calls == [] and case.operation(owner.sub) is None


@pytest.mark.parametrize("failure", ["s3", "partial_s3", "database", "identity"])
def test_scheduler_finishes_each_failed_stage_without_another_browser_request(
    lifecycle_case, monkeypatch, failure
):
    case = lifecycle_case
    owner = case.seed()
    case.objects.fail = failure == "s3"
    case.objects.partial = failure == "partial_s3"
    case.provider.fail = failure == "identity"
    original_remove = account_deletion.remove_account_user
    if failure == "database":

        def fail_local(*_args, **_kwargs):
            raise RuntimeError("transaction failure")

        monkeypatch.setattr(account_deletion, "remove_account_user", fail_local)
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    pending = case.operation(owner.sub)
    assert pending is not None and pending.status in {"in_progress", "retrying"}
    assert _manifest(case, pending)
    if failure != "identity":
        assert not any(call[0] == "cognito" for call in case.calls)
    else:
        with case.factory() as session:
            assert session.get(models.User, owner.user_id) is None
    case.objects.fail = case.objects.partial = case.provider.fail = False
    monkeypatch.setattr(account_deletion, "remove_account_user", original_remove)
    summary = case.reconcile()
    assert summary["completed"] == 1
    completed = case.operation(owner.sub)
    assert completed.operation_id == pending.operation_id and completed.status == "completed"
    with case.factory() as session:
        assert session.get(models.User, owner.user_id) is None
        assert session.get(models.AccountAuthority, owner.authority_id).state == "deleted"
    assert case.objects.values == set()


def test_provider_not_found_does_not_skip_unfinished_objects_or_database(lifecycle_case):
    case = lifecycle_case
    owner = case.seed()
    case.provider.missing = True
    case.objects.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    assert not any(call[0] == "cognito" for call in case.calls)
    case.objects.fail = False
    case.reconcile()
    assert case.operation(owner.sub).status == "completed"
    with case.factory() as session:
        assert session.get(models.User, owner.user_id) is None


def test_manifest_covers_unrecorded_deterministic_variants_and_survives_profile_loss(
    lifecycle_case,
):
    case = lifecycle_case
    owner = case.seed()
    case.provider.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    manifest = _manifest(case, case.operation(owner.sub))
    for extension in ("jpg", "png", "webp"):
        assert (
            case.settings.media_public_bucket,
            f"media/{owner.media_id}/public.{extension}",
        ) in manifest
        assert (
            case.settings.media_public_bucket,
            f"media/{owner.media_id}/thumbnail.{extension}",
        ) in manifest
    assert (case.settings.media_quarantine_bucket, "uploads/owner/original.jpg") in manifest
    with case.factory() as session:
        assert session.get(Media, owner.media_id) is None


def test_completed_subject_gets_automatic_cleanup_of_late_known_key(lifecycle_case):
    case = lifecycle_case
    owner = case.seed()
    case.delete(owner.sub)
    original = case.operation(owner.sub)
    late = (case.settings.media_public_bucket, f"media/{owner.media_id}/public.jpg")
    case.objects.values.add(late)
    case.objects.values.add((case.settings.media_public_bucket, "another-owner/private.jpg"))
    case.reconcile(now=datetime(2199, 1, 1, tzinfo=UTC))
    assert late not in case.objects.values
    assert (case.settings.media_public_bucket, "another-owner/private.jpg") in case.objects.values
    assert case.operation(owner.sub).operation_id == original.operation_id
    assert case.operation(owner.sub).status == "completed"
    assert _manifest(case, original)


def test_same_subject_retries_have_one_intent_and_never_move_completed_stage_back(lifecycle_case):
    case = lifecycle_case
    owner = case.seed(with_media=False)
    case.delete(owner.sub)
    first = case.operation(owner.sub)
    case.delete(owner.sub)
    second = case.operation(owner.sub)
    assert (second.id, second.operation_id, second.status) == (
        first.id,
        first.operation_id,
        "completed",
    )
    assert not first.operation_id.isdecimal() and len(first.operation_id) >= 20
    with case.factory() as session:
        assert (
            len(
                session.scalars(
                    select(models.AccountOperation).where(models.AccountOperation.kind == "delete")
                ).all()
            )
            == 1
        )


def test_one_poison_operation_does_not_starve_another_due_subject(lifecycle_case):
    case = lifecycle_case
    first, second = case.seed("poison"), case.seed("healthy")
    case.provider.fail = True
    for owner in (first, second):
        with pytest.raises(RuntimeError):
            case.delete(owner.sub)
    case.provider.fail = False

    def fail_one(_pool, sub):
        if sub == first.sub:
            raise RuntimeError("private provider failure")

    case.provider.before_delete = fail_one
    summary = case.reconcile(batch_size=2)
    assert summary["completed"] == 1 and summary["retrying"] == 1
    assert case.operation(second.sub).status == "completed"
    assert case.operation(first.sub).status != "completed"
    assert first.sub not in repr(summary) and "provider failure" not in repr(summary)


def test_scan_respects_due_time_batch_limit_and_object_work_budget(lifecycle_case):
    case = lifecycle_case
    owners = [case.seed(f"bounded_{index}") for index in range(3)]
    with case.factory() as session:
        for owner in owners:
            media = session.get(Media, owner.media_id)
            media.s3_key_public = f"stored/{owner.media_id}/public.jpg"
            media.s3_key_thumbnail = f"stored/{owner.media_id}/thumbnail.jpg"
            case.objects.values.update(
                {
                    (case.settings.media_public_bucket, media.s3_key_public),
                    (case.settings.media_public_bucket, media.s3_key_thumbnail),
                }
            )
        session.commit()
    case.objects.fail = True
    for owner in owners:
        with pytest.raises(RuntimeError):
            case.delete(owner.sub)
    future = datetime(2099, 1, 1, tzinfo=UTC)
    with case.factory() as session:
        pending = session.scalar(
            select(models.AccountOperation).where(
                models.AccountOperation.authority_id == owners[0].authority_id,
                models.AccountOperation.kind == "delete",
            )
        )
        pending.next_attempt_at = future + timedelta(days=1)
        session.commit()
    case.objects.fail = False
    case.calls.clear()
    summary = case.reconcile(now=future, batch_size=1, max_objects=2)
    assert summary["examined"] <= 1
    assert sum(len(call[2]) for call in case.calls if call[0] == "s3") <= 2
    assert case.operation(owners[0].sub).status != "completed"
    with case.factory() as session:
        assert all(session.get(models.User, owner.user_id) is not None for owner in owners)
    assert all(case.operation(owner.sub).status != "completed" for owner in owners)
    assert case.objects.values, "bounded work cannot skip the rest of the manifest"
    case.reconcile(now=datetime(2100, 1, 1, tzinfo=UTC), batch_size=3, max_objects=1000)
    assert all(case.operation(owner.sub).status == "completed" for owner in owners)
    assert case.objects.values == set()


def test_other_authors_dependent_posts_survive_durable_cleanup(lifecycle_case):
    case = lifecycle_case
    owner, other = case.seed("root", with_media=False), case.seed("reply", with_media=False)
    with case.factory() as session:
        root = Post(author_id=owner.user_id, text="remove my text")
        session.add(root)
        session.flush()
        reply = Post(
            author_id=other.user_id, text="keep their text", is_reply=True, parent_post_id=root.id
        )
        session.add(reply)
        session.commit()
        root_id, reply_id = root.id, reply.id
    case.provider.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    case.provider.fail = False
    case.reconcile()
    with case.factory() as session:
        assert session.get(Post, root_id).author_id is None
        assert session.get(Post, root_id).text is None
        assert session.get(Post, reply_id).text == "keep their text"
        assert session.get(models.User, other.user_id) is not None


class InvocationKilled(BaseException):
    """Lambda termination bypasses ordinary exception/release handlers."""


def test_hard_termination_advances_due_work_before_remote_io(lifecycle_case):
    case = lifecycle_case
    poison, healthy = case.seed("killed"), case.seed("survivor")
    case.objects.fail = True
    for owner in (poison, healthy):
        with pytest.raises(RuntimeError):
            case.delete(owner.sub)
    case.objects.fail = False
    now = datetime(2099, 1, 1, tzinfo=UTC)
    with case.factory() as session:
        for owner, age in ((poison, 2), (healthy, 1)):
            operation = session.get(models.AccountOperation, case.operation(owner.sub).id)
            operation.next_attempt_at = now - timedelta(days=age)
        session.commit()

    def terminate(_bucket, _payload):
        raise InvocationKilled()

    case.objects.before_delete = terminate
    with pytest.raises(InvocationKilled):
        case.reconcile(now=now, batch_size=1)
    killed = case.operation(poison.sub)
    assert killed.lease_until is not None
    assert killed.next_attempt_at > now, "claim must commit fairness before remote I/O"
    case.objects.before_delete = None
    # After the dead worker's lease expires, its old due timestamp must not
    # repeatedly outrank a peer that has never had a turn (batch size one).
    case.reconcile(now=killed.lease_until + timedelta(seconds=1), batch_size=1)
    assert case.operation(healthy.sub).status == "completed"
    assert case.operation(poison.sub).status != "completed"


def test_runtime_budget_stops_between_remote_calls_and_releases_claim(lifecycle_case):
    """Optional remaining_time_ms callback bounds availability, not RPC completion.

    The existing public reconciler arguments remain supported. SDK timeouts bound
    individual attempts; the callback must be checked between chunks/stages/claims
    with enough headroom left to commit retry/backoff and release the claim.
    """
    case = lifecycle_case
    owner, peer = case.seed("budget"), case.seed("budget_peer")
    case.objects.fail = True
    for subject in (owner, peer):
        with pytest.raises(RuntimeError):
            case.delete(subject.sub)
    case.objects.fail = False
    now = datetime(2099, 1, 1, tzinfo=UTC)
    with case.factory() as session:
        for index, subject in enumerate((owner, peer)):
            op = session.get(models.AccountOperation, case.operation(subject.sub).id)
            op.next_attempt_at = now - timedelta(days=2-index)
        session.commit()
    remaining = [60000]
    case.objects.before_delete = lambda *_args: remaining.__setitem__(0, 9000)
    case.calls.clear()
    account_deletion.reconcile_account_deletions(
        case.factory, settings=case.settings, s3_client=case.objects,
        cognito_client=case.provider, now=now, batch_size=2, max_objects=1000,
        remaining_time_ms=lambda: remaining[0],
    )
    assert len([call for call in case.calls if call[0] == "s3"]) == 1
    assert not any(call[0] == "cognito" for call in case.calls)
    pending = case.operation(owner.sub)
    assert pending.status != "completed" and pending.lease_until is None
    assert pending.next_attempt_at > now
    assert case.operation(peer.sub).lease_epoch == 1, "no new claim below the runtime reserve"
    with case.factory() as session:
        assert session.get(models.User, owner.user_id) is not None
    case.objects.before_delete = None
    case.reconcile(now=now + timedelta(days=1))
    assert case.operation(owner.sub).status == case.operation(peer.sub).status == "completed"



def test_reconciler_database_lock_wait_is_bounded_before_runtime_reserve(lifecycle_case):
    """A busy authority cannot consume the Lambda lifetime before retry release.

    Hold the actual PG authority advisory lock, not a fake SQL exception. The
    event deadline is solely a failing-test watchdog; releasing the holder in
    finally guarantees a broken implementation does not leave a test worker.
    """
    from threading import Event, Thread

    from app.users import lifecycle

    case = lifecycle_case
    owner = case.seed("blocked_claim")
    case.objects.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    case.objects.fail = False
    done = Event()
    failures = []

    def scan():
        try:
            account_deletion.reconcile_account_deletions(
                case.factory, settings=case.settings, s3_client=case.objects,
                cognito_client=case.provider, now=datetime(2099, 1, 1, tzinfo=UTC),
                batch_size=1, max_objects=1000, remaining_time_ms=lambda: 60000,
            )
        except (SQLAlchemyError, RuntimeError, TypeError) as exc:
            failures.append(exc)
        finally:
            done.set()

    with case.factory() as holder:
        lifecycle.lock_subject(holder, case.issuer, owner.sub)
        worker = Thread(target=scan, daemon=True)
        worker.start()
        try:
            bounded = done.wait(10)
        finally:
            holder.rollback()
            worker.join(timeout=15)
    assert bounded, "DB lock wait must stop with runtime left to persist retry/backoff"
    assert not worker.is_alive()
    # An unsupported budget argument cannot masquerade as a bounded DB wait.
    assert not any(isinstance(exc, TypeError) for exc in failures), failures
    assert case.operation(owner.sub).status != "completed"
    case.reconcile(now=datetime(2100, 1, 1, tzinfo=UTC))
    assert case.operation(owner.sub).status == "completed"



def test_local_cleanup_purges_unneeded_user_and_post_associations(lifecycle_case):
    """Retain subject/exact-key cleanup authority, not erased profile associations."""
    case = lifecycle_case
    owner = case.seed("minimal_retention")
    with case.factory() as session:
        session.add(Post(author_id=owner.user_id, text="private association"))
        session.commit()
    case.provider.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    pending = case.operation(owner.sub)
    with case.factory() as session:
        assert session.get(models.User, owner.user_id) is None
    assert pending.stage == "identity"
    assert pending.user_id is None and pending.post_ids == []
    manifest = _manifest(case, pending)
    assert manifest
    case.provider.fail = False
    case.reconcile()
    completed = case.operation(owner.sub)
    assert completed.status == "completed"
    assert completed.user_id is None and completed.post_ids == []
    late = (case.settings.media_public_bucket, f"media/{owner.media_id}/public.jpg")
    assert late in manifest
    case.objects.values.add(late)
    case.reconcile(now=datetime(2199, 1, 1, tzinfo=UTC))
    assert late not in case.objects.values
    assert _manifest(case, completed) == manifest
