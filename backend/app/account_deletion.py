"""Durable exact-object, local-data, then identity deletion orchestration."""
from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import boto3  # type: ignore[import-untyped]
from aws_lambda_powertools import Logger
from botocore.config import Config  # type: ignore[import-untyped]
from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import-untyped]
from sqlalchemy import event, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from app.dependencies import get_settings
from app.media.service import account_media_objects, remove_account_media
from app.notifications.service import remove_account_notifications
from app.posts.service import account_post_ids, remove_account_posts
from app.settings import Settings
from app.users import lifecycle
from app.users.service import clear_account_picture, remove_account_user

logger = Logger()

# Two standard-mode attempts cost at most 12 seconds of connect/read time
# plus bounded retry delay. These are local availability limits, never proof
# that a timed-out request stopped executing remotely.
_DELETION_CLIENT_CONFIG = Config(connect_timeout=3, read_timeout=3,
                                 retries={"mode": "standard", "total_max_attempts": 2})
_RPC_RESERVE_MS = 20000
_DB_RESERVE_MS = 10000


def get_s3_client() -> Any:
    return boto3.client("s3", region_name=get_settings().aws_default_region,
                        config=_DELETION_CLIENT_CONFIG)


def get_cognito_client() -> Any:
    return boto3.client("cognito-idp", region_name=get_settings().cognito_region,
                        config=_DELETION_CLIENT_CONFIG)


def _require_time(remaining_time_ms: Callable[[], int] | None, reserve: int) -> None:
    if remaining_time_ms is not None and remaining_time_ms() < reserve:
        raise DeletionPending("Account deletion temporarily unavailable")


def _bound_database_waits(session: Session, remaining_time_ms: Callable[[], int] | None) -> None:
    """Apply wait limits again after each commit starts a new transaction."""
    def limit_waits(_session: Session, _transaction: SessionTransaction,
                    connection: Connection) -> None:
        if connection.dialect.name != "postgresql":
            return
        available = remaining_time_ms() if remaining_time_ms is not None else 60000
        # Keep time for rollback and a fenced release after a blocked claim or
        # stage. All advisory and row locks obey these transaction-local limits.
        lock_ms = max(1, min(2000, available - 5000))
        statement_ms = max(1, min(5000, available - 5000))
        connection.execute(text("SELECT set_config('lock_timeout', :lock_wait, true), "
                                "set_config('statement_timeout', :statement_wait, true)"),
                           {"lock_wait": f"{lock_ms}ms", "statement_wait": f"{statement_ms}ms"})

    event.listen(session, "after_begin", limit_waits)


class DeletionPending(RuntimeError):
    """Accepted work is unfinished; callers must not announce completion."""


def _cleanup(session: Session, user_id: int, post_ids: list[int]) -> None:
    clear_account_picture(session, user_id)
    remove_account_notifications(session, user_id, post_ids)
    remove_account_media(session, user_id, post_ids)
    remove_account_posts(session, user_id, post_ids)
    remove_account_user(session, user_id)


def _run(session: Session, claim: lifecycle.DeletionClaim, *, settings: Settings,
         s3_client: Any, cognito_client: Any, now: datetime, max_objects: int,
         remaining_time_ms: Callable[[], int] | None = None) -> tuple[bool, int]:
    used = 0
    try:
        _require_time(remaining_time_ms, _DB_RESERVE_MS)
        stage = lifecycle.deletion_stage(session, claim)
        if stage == "completed":
            return True, used
        if stage in {"objects", "maintenance"}:
            objects = lifecycle.deletion_objects(session, claim, max_objects)
            # Release locks before remote I/O; the epoch fences every later write.
            session.commit()
            successful: list[int] = []
            failed = False
            for bucket in sorted({row[1] for row in objects}):
                rows = [row for row in objects if row[1] == bucket]
                for offset in range(0, len(rows), 1000):
                    _require_time(remaining_time_ms, _RPC_RESERVE_MS)
                    chunk = rows[offset:offset + 1000]
                    used += len(chunk)
                    result = s3_client.delete_objects(Bucket=bucket,
                        Delete={"Objects": [{"Key": row[2]} for row in chunk]})
                    errors = {item.get("Key") for item in result.get("Errors", [])}
                    successful.extend(row[0] for row in chunk if row[2] not in errors)
                    failed = failed or bool(errors)
            _require_time(remaining_time_ms, _DB_RESERVE_MS)
            if not lifecycle.objects_removed(session, claim, successful, now):
                return False, used
            if failed:
                raise DeletionPending("Account deletion temporarily unavailable")
            stage = lifecycle.deletion_stage(session, claim)
            if stage in {"objects", "maintenance"}:
                lifecycle.release_deletion(session, claim, now, failed=False)
                return False, used
            if stage == "completed":
                return True, used
        if stage == "database":
            _require_time(remaining_time_ms, _DB_RESERVE_MS)
            local_counts: dict[str, int] = {}

            def cleanup(local_session: Session, user_id: int, post_ids: list[int]) -> None:
                quarantine, public = account_media_objects(local_session, user_id, post_ids)
                local_counts.update(user_id=user_id, post_count=len(post_ids),
                                    object_count=len(quarantine) + len(public))
                _cleanup(local_session, user_id, post_ids)

            if not lifecycle.remove_local_data(session, claim, cleanup):
                return False, used
            # The module boundary returned only after local cleanup and stage
            # advancement committed. Keep counts in logs, not erased associations
            # in the durable work record; never include sub, email or raw errors.
            if local_counts:
                logger.info("account local data removed", extra=local_counts)
            stage = lifecycle.deletion_stage(session, claim)
        if stage == "identity":
            _require_time(remaining_time_ms, _RPC_RESERVE_MS)
            session.commit()
            try:
                cognito_client.admin_delete_user(UserPoolId=settings.cognito_user_pool_id,
                                                 Username=claim.sub)
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") != "UserNotFoundException":
                    raise
            _require_time(remaining_time_ms, 5000)
            return lifecycle.identity_removed(session, claim, now), used
        return False, used
    except (BotoCoreError, ClientError, SQLAlchemyError, RuntimeError):
        session.rollback()
        try:
            lifecycle.release_deletion(session, claim, now, failed=True)
        except SQLAlchemyError:
            # A blocked release cannot consume the invocation indefinitely.
            # The pre-RPC claim commit already retained a due marker and lease.
            session.rollback()
        raise DeletionPending("Account deletion temporarily unavailable") from None


def delete_account_data(session: Session, *, cognito_sub: str, s3_client: Any = None,
                        cognito_client: Any = None, user_pool_id: str,
                        quarantine_bucket: str, public_bucket: str) -> None:
    settings = get_settings()
    if (user_pool_id != settings.cognito_user_pool_id or
        quarantine_bucket != settings.media_quarantine_bucket or
        public_bucket != settings.media_public_bucket):
        raise lifecycle.LifecycleUnavailable("Account deletion configuration unavailable")
    _bound_database_waits(session, None)
    existing = lifecycle.deletion_status(session, cognito_sub)
    if existing is not None and existing["status"] == "completed":
        # Independent retained-key maintenance must not undo HTTP idempotency.
        return
    if not settings.account_lifecycle_enabled and existing is None:
        raise lifecycle.LifecycleUnavailable("Account deletion temporarily unavailable")

    def snapshot(user_id: int | None) -> tuple[list[int], list[tuple[str, str]]]:
        if user_id is None:
            return [], []
        posts = account_post_ids(session, user_id)
        quarantine, public = account_media_objects(session, user_id, posts)
        return posts, [(quarantine_bucket, key) for key in quarantine] + [
            (public_bucket, key) for key in public]

    operation_id = lifecycle.accept_deletion(session, sub=cognito_sub, settings=settings,
                                              snapshot=snapshot)
    now = datetime.now(UTC)
    claim = lifecycle.claim_deletion(session, operation_id, now, force=True)
    if claim is None:
        session.rollback()
        raise DeletionPending("Account deletion temporarily unavailable")
    if claim.terminal:
        session.commit()
        return
    completed, _ = _run(session, claim, settings=settings,
        s3_client=s3_client if s3_client is not None else get_s3_client(),
        cognito_client=cognito_client if cognito_client is not None else get_cognito_client(),
        now=now, max_objects=1000)
    if not completed:
        raise DeletionPending("Account deletion temporarily unavailable")


def reconcile_account_deletions(factory: sessionmaker[Session], *, settings: Settings,
                                 s3_client: Any, cognito_client: Any, now: datetime,
                                 batch_size: int, max_objects: int,
                                 remaining_time_ms: Callable[[], int] | None = None) -> dict[str, int]:
    """Bounded due-work scan; optional live runtime budget is checked throughout.

    Reserve time between claims/stages/RPCs to persist retry and release. Time
    limits cannot settle remote work or remove an account's durable restriction.
    """
    summary = {"examined": 0, "completed": 0, "retrying": 0}
    if remaining_time_ms is not None and remaining_time_ms() < _DB_RESERVE_MS:
        return summary
    with factory() as session:
        _bound_database_waits(session, remaining_time_ms)
        due = lifecycle.due_deletions(session, settings=settings, now=now,
                                      limit=max(0, min(batch_size, 100)))
    remaining = max(0, min(max_objects, 1000))
    for operation_id in due:
        if remaining_time_ms is not None and remaining_time_ms() < _RPC_RESERVE_MS:
            break
        with factory() as session:
            _bound_database_waits(session, remaining_time_ms)
            try:
                claim = lifecycle.claim_deletion(session, operation_id, now)
            except SQLAlchemyError:
                session.rollback()
                summary["examined"] += 1
                summary["retrying"] += 1
                continue
            if claim is None:
                continue
            summary["examined"] += 1
            try:
                completed, used = _run(session, claim, settings=settings,
                    s3_client=s3_client, cognito_client=cognito_client, now=now,
                    max_objects=remaining, remaining_time_ms=remaining_time_ms)
                remaining -= used
                summary["completed" if completed else "retrying"] += 1
            except DeletionPending:
                # Failed calls consumed their attempted object work too. End this
                # invocation's object allowance conservatively, but visit peers.
                remaining = 0
                summary["retrying"] += 1
    return summary
