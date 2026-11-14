"""USERS-008 HTTP boundary: identity-keyed delete and error mapping."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.main import app as main_app
from app.users.auth import FakeTokenVerifier, VerifiedIdentity
from app.users.dependencies import get_token_verifier

TOKEN = {"Authorization": "Bearer unchanged-token"}


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def route_client(session_factory):
    saved = dict(main_app.dependency_overrides)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    main_app.dependency_overrides[get_session] = _get_session_override
    try:
        with TestClient(main_app, raise_server_exceptions=False) as client:
            yield client
    finally:
        main_app.dependency_overrides.clear()
        main_app.dependency_overrides.update(saved)


def _sign_in(sub: str, *, auth_time: int | None = None) -> None:
    if auth_time is None:
        auth_time = int(datetime.now(UTC).timestamp())
    main_app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub=sub, auth_time=auth_time)
    )


def test_delete_my_data_uses_verified_sub_without_request_user_id_or_body(
    route_client, monkeypatch
):
    from app import account_deletion

    seen: list[dict] = []

    def _delete_account_data(session, **kwargs):
        seen.append(kwargs)

    monkeypatch.setattr(account_deletion, "delete_account_data", _delete_account_data)
    _sign_in("verified-cognito-sub")

    response = route_client.delete("/users/me/data", headers=TOKEN)

    assert response.status_code == 204
    assert len(seen) == 1
    assert seen[0]["cognito_sub"] == "verified-cognito-sub"


def test_delete_my_data_rejects_stale_auth_without_calling_service(route_client, monkeypatch):
    from app import account_deletion

    calls: list[bool] = []
    monkeypatch.setattr(
        account_deletion,
        "delete_account_data",
        lambda *_args, **_kwargs: calls.append(True),
    )
    stale_auth_time = int((datetime.now(UTC) - timedelta(minutes=6)).timestamp())
    _sign_in("verified-cognito-sub", auth_time=stale_auth_time)

    response = route_client.delete("/users/me/data", headers=TOKEN)

    assert response.status_code == 403
    assert response.json() == {"detail": "recent_auth_required"}
    assert calls == []


@pytest.mark.parametrize("failed_phase", ["S3", "database", "Cognito"])
def test_delete_my_data_maps_service_failure_to_5xx_and_stops_route_work(
    route_client, monkeypatch, failed_phase
):
    from app import account_deletion

    calls: list[str] = []

    def _delete_account_data(*_args, **_kwargs):
        calls.append(failed_phase)
        raise RuntimeError(f"{failed_phase} failure")

    monkeypatch.setattr(account_deletion, "delete_account_data", _delete_account_data)
    _sign_in("verified-cognito-sub")

    response = route_client.delete("/users/me/data", headers=TOKEN)

    assert response.status_code >= 500
    assert calls == [failed_phase]


@pytest.fixture()
def lifecycle_client(lifecycle_case, monkeypatch):
    from app import account_deletion

    case = lifecycle_case
    saved = dict(main_app.dependency_overrides)

    def sessions():
        with case.factory() as session:
            yield session

    main_app.dependency_overrides[get_session] = sessions
    monkeypatch.setattr(account_deletion, "get_s3_client", lambda: case.objects)
    monkeypatch.setattr(account_deletion, "get_cognito_client", lambda: case.provider)
    try:
        with TestClient(main_app, raise_server_exceptions=False) as client:
            yield client
    finally:
        main_app.dependency_overrides.clear()
        main_app.dependency_overrides.update(saved)


def test_pending_delete_is_503_with_stable_owner_status_and_no_pii(
    lifecycle_case, lifecycle_client
):
    case = lifecycle_case
    owner = case.seed()
    _sign_in(owner.sub)
    case.objects.fail = True
    first = lifecycle_client.delete("/users/me/data", headers=TOKEN)
    second = lifecycle_client.delete("/users/me/data", headers=TOKEN)
    assert first.status_code == second.status_code == 503
    assert int(first.headers["Retry-After"]) > 0
    assert first.headers["Location"] == second.headers["Location"] == "/users/me/data-operation"
    status = lifecycle_client.get(first.headers["Location"], headers=TOKEN)
    assert status.status_code == 200
    assert set(status.json()) == {"operation_id", "status"}
    assert status.json()["operation_id"] == case.operation(owner.sub).operation_id
    assert status.json()["status"] in {"in_progress", "retrying"}
    assert owner.sub not in first.text + status.text
    assert "external secret" not in first.text + status.text
    assert "uploads/" not in status.text


def test_owner_status_survives_profile_removal_and_scheduler_completion(
    lifecycle_case, lifecycle_client
):
    case = lifecycle_case
    owner = case.seed()
    _sign_in(owner.sub)
    case.provider.fail = True
    assert lifecycle_client.delete("/users/me/data", headers=TOKEN).status_code == 503
    pending = lifecycle_client.get("/users/me/data-operation", headers=TOKEN)
    assert pending.status_code == 200
    handle = pending.json()["operation_id"]
    case.provider.fail = False
    case.reconcile()
    status = lifecycle_client.get("/users/me/data-operation", headers=TOKEN)
    assert status.status_code == 200
    assert status.json() == {"operation_id": handle, "status": "completed"}
    assert lifecycle_client.delete("/users/me/data", headers=TOKEN).status_code == 204


def test_status_cannot_select_another_owner_by_query_or_opaque_handle(
    lifecycle_case, lifecycle_client
):
    case = lifecycle_case
    owner, stranger = case.seed("private"), case.seed("stranger", with_media=False)
    case.delete(owner.sub)
    operation = case.operation(owner.sub)
    _sign_in(stranger.sub)
    response = lifecycle_client.get(
        "/users/me/data-operation",
        headers=TOKEN,
        params={
            "user_id": owner.user_id,
            "sub": owner.sub,
            "operation_id": operation.operation_id,
        },
    )
    assert response.status_code == 404
    assert operation.operation_id not in response.text and owner.sub not in response.text


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid"}])
def test_status_requires_a_valid_identity(lifecycle_client, headers):
    main_app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(None)
    assert lifecycle_client.get("/users/me/data-operation", headers=headers).status_code == 401


def test_tombstoned_identity_can_only_reach_status_and_delete_retry(
    lifecycle_case, lifecycle_client
):
    case = lifecycle_case
    owner = case.seed()
    _sign_in(owner.sub)
    case.delete(owner.sub)
    assert lifecycle_client.get("/users/me/data-operation", headers=TOKEN).status_code == 200
    for method, path, body in [
        ("POST", "/users", {"username": "resurrection", "date_of_birth": "1990-01-01"}),
        ("POST", "/users/me/recover", None),
        ("POST", "/posts", {"text": "resurrect"}),
        ("POST", "/media/uploads", {"mime_type": "image/jpeg"}),
        ("PATCH", "/users/me", {"description": "resurrect"}),
    ]:
        response = lifecycle_client.request(method, path, headers=TOKEN, json=body)
        assert response.status_code == 403, (path, response.text)


def test_acceptance_rejects_missing_stale_or_future_recent_auth_without_operation(
    lifecycle_case, lifecycle_client
):
    from freezegun import freeze_time

    case = lifecycle_case
    owner = case.seed(with_media=False)
    with freeze_time("2026-03-01T12:00:00Z"):
        now = int(datetime.now(UTC).timestamp())
        for auth_time in (None, now - 301, now + 1):
            main_app.dependency_overrides[get_token_verifier] = lambda value=auth_time: (
                FakeTokenVerifier(VerifiedIdentity(sub=owner.sub, auth_time=value))
            )
            response = lifecycle_client.delete("/users/me/data", headers=TOKEN)
            assert response.status_code == 403, (auth_time, response.text)
            assert case.operation(owner.sub) is None
    assert case.calls == []


def test_fresh_auth_boundary_300_seconds_is_accepted(lifecycle_case, lifecycle_client):
    from freezegun import freeze_time

    case = lifecycle_case
    owner = case.seed(with_media=False)
    with freeze_time("2026-03-01T12:00:00Z"):
        _sign_in(owner.sub, auth_time=int(datetime.now(UTC).timestamp()) - 300)
        assert lifecycle_client.delete("/users/me/data", headers=TOKEN).status_code == 204


def test_dormant_acceptance_is_unavailable_without_calling_legacy_deletion(
    lifecycle_case, lifecycle_client, monkeypatch
):
    from app.dependencies import get_settings

    case = lifecycle_case
    owner = case.seed()
    _sign_in(owner.sub)
    monkeypatch.setenv("ACCOUNT_LIFECYCLE_ENABLED", "false")
    get_settings.cache_clear()
    assert lifecycle_client.delete("/users/me/data", headers=TOKEN).status_code == 503
    assert case.calls == [] and case.operation(owner.sub) is None


def test_disabling_flag_does_not_make_a_tombstone_disappear(
    lifecycle_case, lifecycle_client, monkeypatch
):
    from app.dependencies import get_settings

    case = lifecycle_case
    owner = case.seed()
    _sign_in(owner.sub)
    case.delete(owner.sub)
    monkeypatch.setenv("ACCOUNT_LIFECYCLE_ENABLED", "false")
    get_settings.cache_clear()
    assert (
        lifecycle_client.post(
            "/users",
            headers=TOKEN,
            json={"username": "no_rollback_bypass", "date_of_birth": "1990-01-01"},
        ).status_code
        == 403
    )


def test_ambiguous_legacy_missing_profile_is_not_silently_adopted(lifecycle_case, lifecycle_client):
    _sign_in("pre-cutover-unclassified-sub")
    response = lifecycle_client.post(
        "/users",
        headers=TOKEN,
        json={"username": "legacy_needs_evidence", "date_of_birth": "1990-01-01"},
    )
    assert response.status_code == 503
    assert "pre-cutover-unclassified-sub" not in response.text


def test_post_cutover_provider_identity_can_create_a_legitimate_new_profile(
    lifecycle_case, lifecycle_client
):
    case = lifecycle_case
    case.provider.created_at = datetime(2026, 2, 1, tzinfo=UTC)
    _sign_in("legitimate-new-provider-sub")
    response = lifecycle_client.post(
        "/users",
        headers=TOKEN,
        json={"username": "legitimate_new_owner", "date_of_birth": "1990-01-01"},
    )
    assert response.status_code == 201
    assert (
        "cognito_get",
        case.settings.cognito_user_pool_id,
        "legitimate-new-provider-sub",
    ) in case.calls
    assert lifecycle_client.get("/users/me", headers=TOKEN).status_code == 200


@pytest.mark.parametrize("reason", ["wrong_sub", "provider_unavailable"])
def test_new_profile_adoption_requires_exact_provider_subject_and_available_evidence(
    lifecycle_case, lifecycle_client, reason
):
    case = lifecycle_case
    case.provider.created_at = datetime(2026, 2, 1, tzinfo=UTC)
    case.provider.returned_sub = "different-provider-sub" if reason == "wrong_sub" else None
    case.provider.lookup_fail = reason == "provider_unavailable"
    _sign_in("requested-new-sub")
    response = lifecycle_client.post(
        "/users", headers=TOKEN, json={"username": "unsafe_adoption", "date_of_birth": "1990-01-01"}
    )
    assert response.status_code == 503
    assert "different-provider-sub" not in response.text and "private lookup" not in response.text


def test_authority_database_failure_is_closed_but_health_and_guests_remain_available(
    lifecycle_case, lifecycle_client
):
    from sqlalchemy import event
    from sqlalchemy.exc import OperationalError

    case = lifecycle_case
    owner = case.seed(with_media=False)
    _sign_in(owner.sub)

    def fail_authority(_connection, _cursor, statement, _parameters, _context, _executemany):
        if case.models.AccountAuthority.__tablename__ in statement:
            raise OperationalError("private SQL", {}, RuntimeError("unavailable"))

    event.listen(case.engine, "before_cursor_execute", fail_authority)
    try:
        protected = lifecycle_client.patch(
            "/users/me", headers=TOKEN, json={"description": "unsafe"}
        )
        assert protected.status_code == 503
        assert "private SQL" not in protected.text
        assert lifecycle_client.get("/health").status_code == 200
        assert lifecycle_client.get("/feed").status_code == 200
    finally:
        event.remove(case.engine, "before_cursor_execute", fail_authority)
