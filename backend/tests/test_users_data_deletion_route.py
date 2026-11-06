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
