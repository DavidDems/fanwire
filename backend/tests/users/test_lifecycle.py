"""USERS-009 durable public data contract, independent of profile lifetime.

The new public ORM projections are AccountAuthority (issuer, cognito_sub,
state, generation, inactive_at), AccountOperation (authority_id, kind,
operation_id, status, stage, next_attempt_at), and AccountDeletionObject
(operation_id, bucket, key). Integer id is internal; operation_id is opaque.
"""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import BigInteger, inspect, select
from sqlalchemy.exc import IntegrityError

from app.users import models, service


def test_lifecycle_tables_have_bigint_identity_keys_and_no_profile_cascade(lifecycle_case):
    case = lifecycle_case
    for name in ("AccountAuthority", "AccountOperation", "AccountDeletionObject"):
        table = getattr(models, name).__table__
        keys = list(table.primary_key)
        assert len(keys) == 1
        assert isinstance(keys[0].type, BigInteger)
        assert keys[0].identity is not None
        assert not any(fk.column.table.name == "users" for fk in table.foreign_keys)
        assert not {"email", "password", "code", "token", "provider_error"} & set(
            table.columns.keys()
        )
    assert inspect(case.engine).has_table(models.AccountAuthority.__tablename__)


def test_authority_uniqueness_is_issuer_plus_immutable_sub(lifecycle_case):
    case = lifecycle_case
    owner = case.seed(with_media=False)
    with case.factory() as session:
        session.add(
            models.AccountAuthority(
                issuer="https://different.example.test/pool",
                cognito_sub=owner.sub,
                state="active",
                generation=1,
            )
        )
        session.commit()
    with pytest.raises(IntegrityError), case.factory() as session:
        session.add(
            models.AccountAuthority(
                issuer=case.issuer,
                cognito_sub=owner.sub,
                state="active",
                generation=1,
            )
        )
        session.commit()


@pytest.mark.parametrize("state", ["unknown", "", "ACTIVE"])
def test_invalid_authority_state_is_rejected_by_database(lifecycle_case, state):
    with pytest.raises(IntegrityError), lifecycle_case.factory() as session:
        session.add(
            models.AccountAuthority(
                issuer=lifecycle_case.issuer,
                cognito_sub="invalid-state",
                state=state,
                generation=1,
            )
        )
        session.commit()


def test_deactivate_and_recover_commit_generation_and_minimal_operation_together(lifecycle_case):
    case = lifecycle_case
    owner = case.seed(with_media=False)
    with case.factory() as session:
        service.soft_delete_user(session, owner.user_id)
    with case.factory() as session:
        authority = session.get(models.AccountAuthority, owner.authority_id)
        user = session.get(models.User, owner.user_id)
        first_time = authority.inactive_at
        generation = authority.generation
        assert authority.state == "inactive"
        assert first_time is not None and user.deleted_at == first_time
        assert generation > 1
        operations = session.scalars(
            select(models.AccountOperation).where(
                models.AccountOperation.authority_id == owner.authority_id
            )
        ).all()
        assert [(op.kind, op.status) for op in operations] == [("deactivate", "completed")]
    with case.factory() as session:
        service.soft_delete_user(session, owner.user_id)
    with case.factory() as session:
        authority = session.get(models.AccountAuthority, owner.authority_id)
        assert authority.inactive_at == first_time and authority.generation == generation
        service.recover_user(session, owner.user_id)
    with case.factory() as session:
        authority = session.get(models.AccountAuthority, owner.authority_id)
        assert authority.state == "active" and authority.generation > generation
        assert session.get(models.User, owner.user_id).deleted_at is None
        assert {op.kind for op in session.scalars(select(models.AccountOperation)).all()} == {
            "deactivate",
            "recover",
        }


def test_lifecycle_transition_failure_rolls_back_profile_and_authority(lifecycle_case, monkeypatch):
    case = lifecycle_case
    owner = case.seed(with_media=False)
    with case.factory() as session:
        monkeypatch.setattr(
            session, "commit", lambda: (_ for _ in ()).throw(RuntimeError("commit lost"))
        )
        with pytest.raises(RuntimeError, match="commit lost"):
            service.soft_delete_user(session, owner.user_id)
        session.rollback()
    with case.factory() as session:
        assert session.get(models.AccountAuthority, owner.authority_id).state == "active"
        assert session.get(models.User, owner.user_id).deleted_at is None
        assert session.scalar(select(models.AccountOperation.id)) is None


def test_deleted_subject_cannot_recreate_profile_but_different_sub_is_not_inherited(lifecycle_case):
    case = lifecycle_case
    owner = case.seed(with_media=False)
    case.delete(owner.sub)
    with case.factory() as session:
        with pytest.raises(ValueError):
            service.create_user(
                session,
                cognito_sub=owner.sub,
                username="resurrected",
                date_of_birth=date(1990, 1, 1),
            )
        session.rollback()
    # An unrelated adopted identity must not inherit another subject's tombstone.
    newcomer = case.seed("new-sub", with_media=False)
    with case.factory() as session:
        assert session.get(models.AccountAuthority, newcomer.authority_id).state == "active"
        assert session.get(models.AccountAuthority, owner.authority_id).state == "deleted"
        assert session.get(models.User, owner.user_id) is None


def test_deleting_authority_cannot_be_reactivated_even_while_profile_remains(lifecycle_case):
    case = lifecycle_case
    owner = case.seed()
    case.objects.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    with case.factory() as session:
        with pytest.raises(ValueError):
            service.recover_user(session, owner.user_id)
        session.rollback()
        assert session.get(models.AccountAuthority, owner.authority_id).state == "deleting"


def test_clock_advancement_does_not_unlock_deleting_authority(lifecycle_case):
    case = lifecycle_case
    owner = case.seed()
    case.objects.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    case.reconcile(now=datetime(2199, 1, 1, tzinfo=UTC))
    with case.factory() as session:
        assert session.get(models.AccountAuthority, owner.authority_id).state == "deleting"
        assert session.get(models.User, owner.user_id).deleted_at is not None


@pytest.mark.parametrize("acting_party", ["follower", "followed"])
def test_follow_commit_rejects_deleting_actor_or_target(lifecycle_case, acting_party):
    from app.eventbus import InMemoryEventPublisher, PostEventBus

    case = lifecycle_case
    follower, followed = case.seed("follower"), case.seed("followed")
    target = follower if acting_party == "follower" else followed
    case.objects.fail = True
    with pytest.raises(RuntimeError):
        case.delete(target.sub)
    with case.factory() as session:
        with pytest.raises(ValueError):
            service.follow(
                session,
                follower_user_id=follower.user_id,
                followed_user_id=followed.user_id,
                event_bus=PostEventBus(InMemoryEventPublisher()),
            )
        session.rollback()
        assert session.scalar(select(models.Follow.follower_user_id)) is None
