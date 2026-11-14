"""Users-owned durable account authority and transaction fencing.

Lock order: sorted issuer/sub advisory keys, authority rows, User rows, then
post/media rows. Every mutation keeps these locks until its commit/rollback.
No clock or lease ever restores an account's authority.
"""
from __future__ import annotations

from collections.abc import Callable, Collection
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import-untyped]
from sqlalchemy import inspect, or_, select, text, update
from sqlalchemy.orm import Session

from app.settings import Settings
from app.users.models import AccountAuthority, AccountDeletionObject, AccountOperation, User


class AccountRestricted(ValueError):
    """A durable account fence refuses a mutation, without identifiers."""


class LifecycleUnavailable(RuntimeError):
    """Required authority/adoption evidence is unavailable."""


def _settings() -> Settings:
    from app.dependencies import get_settings
    return get_settings()


def trusted_issuer(settings: Settings) -> str:
    if settings.environment == "perf" and settings.perf_jwks_path:
        return "https://perf.fanwire.local/issuer"
    if not settings.cognito_region or not settings.cognito_user_pool_id:
        raise LifecycleUnavailable("Account authority namespace unavailable")
    return f"https://cognito-idp.{settings.cognito_region}.amazonaws.com/{settings.cognito_user_pool_id}"


def ready(session: Session, settings: Settings | None = None) -> bool:
    """Dormant code may precede the additive schema; active code never may.

    An existing schema is always consulted, even after disabling acceptance.
    Database failures are deliberately not interpreted as an absent schema.
    """
    cfg = settings or _settings()
    exists = inspect(session.connection()).has_table("account_authorities")
    if not exists and cfg.account_lifecycle_enabled:
        raise LifecycleUnavailable("Account authority schema unavailable")
    return exists


def _namespace(settings: Settings) -> str | None:
    if not settings.cognito_user_pool_id and not settings.account_lifecycle_enabled:
        return None
    return trusted_issuer(settings)


def lock_subject(session: Session, issuer: str, sub: str) -> None:
    if session.get_bind().dialect.name == "postgresql":
        session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:subject, 0))"),
                        {"subject": issuer + "\x1f" + sub})


def authority_for_sub(session: Session, sub: str, *, settings: Settings | None = None,
                      lock: bool = False, adopt_profile: bool = False) -> AccountAuthority | None:
    cfg = settings or _settings()
    if not ready(session, cfg):
        return None
    issuer = _namespace(cfg)
    if issuer is None:
        # A missing dormant namespace must still never hide an old tombstone.
        terminal = session.scalar(select(AccountAuthority).where(
            AccountAuthority.cognito_sub == sub,
            AccountAuthority.state.in_(["deleting", "deleted"])))
        if terminal is not None:
            return terminal
        return None
    if lock:
        lock_subject(session, issuer, sub)
    stmt = select(AccountAuthority).where(AccountAuthority.issuer == issuer,
                                          AccountAuthority.cognito_sub == sub)
    if lock:
        stmt = stmt.with_for_update()
    authority = session.scalar(stmt.execution_options(populate_existing=True))
    if authority is None and adopt_profile:
        user = session.scalar(select(User).where(User.cognito_sub == sub))
        if user is not None:
            authority = AccountAuthority(issuer=issuer, cognito_sub=sub,
                state="inactive" if user.deleted_at else "active", generation=1,
                inactive_at=user.deleted_at)
            session.add(authority)
            session.flush()
    return authority


def check_subject(session: Session, sub: str, *, allow_inactive: bool = True) -> None:
    authority = authority_for_sub(session, sub)
    if authority is not None and (authority.state in {"deleting", "deleted"} or
                                  (authority.state == "inactive" and not allow_inactive)):
        raise AccountRestricted("Account is unavailable")


def fence_users(session: Session, user_ids: Collection[int], *, allow_inactive: bool = False) -> None:
    """Public cross-module mutation boundary. Holds ordered locks until commit."""
    cfg = _settings()
    if not ready(session, cfg):
        return
    users = list(session.scalars(select(User).where(User.id.in_(set(user_ids)))).all())
    issuer = _namespace(cfg)
    if issuer is not None:
        for sub in sorted({user.cognito_sub for user in users}):
            lock_subject(session, issuer, sub)
    for user in sorted(users, key=lambda value: value.cognito_sub):
        authority = authority_for_sub(session, user.cognito_sub, settings=cfg,
                                      lock=True, adopt_profile=True)
        if authority is not None and (authority.state in {"deleting", "deleted"} or
            (authority.state == "inactive" and not allow_inactive)):
            raise AccountRestricted("Account is unavailable")
    # Re-fetch after the authority locks: a request's identity-map row is not proof.
    current = list(session.scalars(select(User).where(User.id.in_(set(user_ids)))
                  .with_for_update().execution_options(populate_existing=True)).all())
    if len(current) != len(set(user_ids)):
        raise AccountRestricted("Account is unavailable")
    if not allow_inactive and any(user.deleted_at is not None for user in current):
        raise AccountRestricted("Account is unavailable")


def transition(session: Session, user: User, state: str) -> None:
    authority = authority_for_sub(session, user.cognito_sub, lock=True, adopt_profile=True)
    if authority is not None:
        if authority.state in {"deleting", "deleted"}:
            raise AccountRestricted("Account is unavailable")
        if authority.state != state:
            authority.state = state
            authority.generation += 1
            authority.inactive_at = datetime.now(UTC) if state == "inactive" else None
            user.deleted_at = authority.inactive_at
            session.add(AccountOperation(authority_id=authority.id,
                kind="deactivate" if state == "inactive" else "recover",
                operation_id=token_urlsafe(24), status="completed", stage="completed",
                generation=authority.generation))
    else:
        user.deleted_at = datetime.now(UTC) if state == "inactive" else None


def prepare_profile(session: Session, sub: str) -> None:
    """Adopt only provider-created post-cutover identities; never infer from login."""
    cfg = _settings()
    if not ready(session, cfg):
        return
    existing = authority_for_sub(session, sub, settings=cfg, lock=True)
    if existing is not None:
        if existing.state in {"deleting", "deleted"}:
            raise AccountRestricted("Account is unavailable")
        return
    used = session.scalar(select(AccountOperation.id).where(AccountOperation.kind == "delete").limit(1))
    if not cfg.account_lifecycle_enabled and cfg.account_lifecycle_cutover_at is None and used is None:
        return
    if cfg.account_lifecycle_cutover_at is None:
        raise LifecycleUnavailable("Account adoption requires reviewed evidence")
    from app.users.dependencies import get_cognito_client
    try:
        response: dict[str, Any] = get_cognito_client().admin_get_user(
            UserPoolId=cfg.cognito_user_pool_id, Username=sub)
        attributes = {item["Name"]: item["Value"] for item in response["UserAttributes"]}
        created = response["UserCreateDate"]
        cutoff = cfg.account_lifecycle_cutover_at
        if (attributes.get("sub") != sub or not isinstance(created, datetime) or
            created.tzinfo is None or cutoff is None or created < cutoff):
            raise LifecycleUnavailable("Account adoption requires reviewed evidence")
    except (BotoCoreError, ClientError, KeyError, TypeError, RuntimeError):
        raise LifecycleUnavailable("Account adoption evidence unavailable") from None
    session.add(AccountAuthority(issuer=trusted_issuer(cfg), cognito_sub=sub,
                                 state="active", generation=1))
    session.flush()


@dataclass(frozen=True)
class DeletionClaim:
    id: int
    epoch: int
    issuer: str
    sub: str
    operation_id: str
    terminal: bool


def deletion_status(session: Session, sub: str) -> dict[str, str] | None:
    cfg = _settings()
    if not ready(session, cfg):
        return None
    authority = authority_for_sub(session, sub, settings=cfg)
    if authority is None:
        return None
    operation = session.scalar(select(AccountOperation).where(
        AccountOperation.authority_id == authority.id, AccountOperation.kind == "delete"))
    if operation is None:
        return None
    return {"operation_id": operation.operation_id, "status": operation.status}


def accept_deletion(session: Session, *, sub: str, settings: Settings,
                    snapshot: Callable[[int | None], tuple[list[int], list[tuple[str, str]]]]) -> int:
    """The only deletion-intent boundary; it commits before any external work."""
    if not ready(session, settings):
        raise LifecycleUnavailable("Account authority schema unavailable")
    issuer = trusted_issuer(settings)
    lock_subject(session, issuer, sub)
    authority = session.scalar(select(AccountAuthority).where(
        AccountAuthority.issuer == issuer, AccountAuthority.cognito_sub == sub)
        .with_for_update().execution_options(populate_existing=True))
    if authority is None:
        authority = AccountAuthority(issuer=issuer, cognito_sub=sub, state="active", generation=1)
        session.add(authority)
        session.flush()
    existing = session.scalar(select(AccountOperation).where(
        AccountOperation.authority_id == authority.id, AccountOperation.kind == "delete"))
    if existing is not None:
        session.commit()
        return existing.id
    user = session.scalar(select(User).where(User.cognito_sub == sub).with_for_update()
                          .execution_options(populate_existing=True))
    post_ids, objects = snapshot(user.id if user is not None else None)
    authority.state = "deleting"
    authority.generation += 1
    if user is not None:
        user.deleted_at = user.deleted_at or datetime.now(UTC)
    operation = AccountOperation(authority_id=authority.id, kind="delete",
        operation_id=token_urlsafe(24), status="in_progress", stage="objects",
        generation=authority.generation, user_id=user.id if user is not None else None,
        post_ids=post_ids, next_attempt_at=datetime.now(UTC))
    session.add(operation)
    session.flush()
    for bucket, key in sorted(set(objects)):
        session.add(AccountDeletionObject(operation_id=operation.id, bucket=bucket, key=key,
                                         removed=False))
    session.commit()
    return operation.id


def due_deletions(session: Session, *, settings: Settings, now: datetime, limit: int) -> list[int]:
    if not ready(session, settings):
        return []
    issuer = trusted_issuer(settings)
    return list(session.scalars(select(AccountOperation.id).join(AccountAuthority).where(
        AccountAuthority.issuer == issuer, AccountOperation.kind == "delete",
        AccountOperation.next_attempt_at <= now,
        or_(AccountOperation.lease_until.is_(None), AccountOperation.lease_until <= now))
        .order_by(AccountOperation.next_attempt_at, AccountOperation.id).limit(limit)))


def claim_deletion(session: Session, operation_id: int, now: datetime, *, force: bool = False) -> DeletionClaim | None:
    operation = session.get(AccountOperation, operation_id)
    if operation is None:
        return None
    authority = session.get(AccountAuthority, operation.authority_id)
    assert authority is not None
    lock_subject(session, authority.issuer, authority.cognito_sub)
    session.refresh(authority, with_for_update=True)
    operation = session.scalar(select(AccountOperation).where(AccountOperation.id == operation_id)
                               .with_for_update().execution_options(populate_existing=True))
    assert operation is not None
    terminal = operation.status == "completed"
    # Retained-object maintenance cannot revoke durable logical completion.
    # The HTTP retry observes completion without touching its lease or epoch.
    if terminal and force:
        return DeletionClaim(operation.id, operation.lease_epoch, authority.issuer,
                             authority.cognito_sub, operation.operation_id, True)
    if operation.lease_until is not None and operation.lease_until > now:
        return None
    if not force and operation.next_attempt_at > now:
        return None
    operation.lease_epoch += 1
    operation.attempts += 1
    operation.lease_until = now + timedelta(minutes=5)
    # Commit fairness before RPCs: hard termination bypasses release handlers.
    # Lease expiry permits another attempt, never an authority transition.
    operation.next_attempt_at = operation.lease_until
    if terminal and operation.stage == "completed":
        operation.stage = "maintenance"
        session.execute(update(AccountDeletionObject).where(
            AccountDeletionObject.operation_id == operation.id).values(removed=False))
    elif not terminal:
        operation.status = "in_progress"
    claim = DeletionClaim(operation.id, operation.lease_epoch, authority.issuer,
                          authority.cognito_sub, operation.operation_id, terminal)
    session.commit()
    return claim


def _owned(session: Session, claim: DeletionClaim) -> tuple[AccountAuthority, AccountOperation] | None:
    lock_subject(session, claim.issuer, claim.sub)
    authority = session.scalar(select(AccountAuthority).where(
        AccountAuthority.issuer == claim.issuer, AccountAuthority.cognito_sub == claim.sub)
        .with_for_update().execution_options(populate_existing=True))
    operation = session.scalar(select(AccountOperation).where(AccountOperation.id == claim.id,
        AccountOperation.lease_epoch == claim.epoch).with_for_update()
        .execution_options(populate_existing=True))
    if (operation is None or authority is None or operation.authority_id != authority.id
        or authority.state not in {"deleting", "deleted"}):
        return None
    return authority, operation


def deletion_stage(session: Session, claim: DeletionClaim) -> str | None:
    operation = session.scalar(select(AccountOperation).where(AccountOperation.id == claim.id,
        AccountOperation.lease_epoch == claim.epoch))
    return operation.stage if operation is not None else None


def deletion_objects(session: Session, claim: DeletionClaim, limit: int) -> list[tuple[int, str, str]]:
    if _owned(session, claim) is None:
        return []
    return [(row.id, row.bucket, row.key) for row in session.scalars(
        select(AccountDeletionObject).where(AccountDeletionObject.operation_id == claim.id,
            AccountDeletionObject.removed.is_(False)).order_by(AccountDeletionObject.id).limit(limit))]


def objects_removed(session: Session, claim: DeletionClaim, ids: list[int], now: datetime) -> bool:
    owned = _owned(session, claim)
    if owned is None:
        return False
    _, operation = owned
    if ids:
        session.execute(update(AccountDeletionObject).where(
            AccountDeletionObject.operation_id == claim.id,
            AccountDeletionObject.id.in_(ids)).values(removed=True))
    remaining = session.scalar(select(AccountDeletionObject.id).where(
        AccountDeletionObject.operation_id == claim.id, AccountDeletionObject.removed.is_(False)).limit(1))
    if remaining is None:
        if operation.status == "completed":
            operation.stage = "completed"
            operation.next_attempt_at = now + timedelta(hours=1)
            operation.lease_until = None
        else:
            operation.stage = "database"
    session.commit()
    return True


def remove_local_data(session: Session, claim: DeletionClaim,
                      cleanup: Callable[[Session, int, list[int]], None]) -> bool:
    owned = _owned(session, claim)
    if owned is None:
        return False
    _, operation = owned
    if operation.stage != "database":
        return True
    if operation.user_id is not None:
        cleanup(session, operation.user_id, operation.post_ids)
    operation.user_id = None
    operation.post_ids = []
    operation.stage = "identity"
    session.commit()
    return True


def identity_removed(session: Session, claim: DeletionClaim, now: datetime) -> bool:
    owned = _owned(session, claim)
    if owned is None:
        return False
    authority, operation = owned
    if operation.status != "completed":
        authority.state = "deleted"
        authority.generation += 1
        operation.status = "completed"
        operation.stage = "completed"
        operation.lease_until = None
        operation.next_attempt_at = now + timedelta(hours=1)
    session.commit()
    return True


def release_deletion(session: Session, claim: DeletionClaim, now: datetime, *, failed: bool) -> None:
    owned = _owned(session, claim)
    if owned is None:
        return
    _, operation = owned
    operation.lease_until = None
    if failed:
        if operation.status != "completed":
            operation.status = "retrying"
        from secrets import randbelow
        delay = min(3600, 5 * (2 ** min(operation.attempts, 10))) + randbelow(5)
        operation.next_attempt_at = now + timedelta(seconds=delay)
    elif operation.stage != "completed":
        operation.next_attempt_at = now
    session.commit()
