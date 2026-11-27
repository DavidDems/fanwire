"""Database credentials from Secrets Manager (ADR 0045).

A deployed function is told where the RDS secret is (`DATABASE_SECRET_ARN`)
and where the database is (`DATABASE_HOST`/`DATABASE_PORT`/`DATABASE_NAME`),
never the password: `Settings` reads the secret once per process and builds
the SQLAlchemy URL in memory. A plain `DATABASE_URL` (local dev, tests,
compose) still wins when it is set. No AWS here: moto, or a counting stub.
"""

from __future__ import annotations

import json
from urllib.parse import quote

import boto3
import pytest
from moto import mock_aws
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from app import settings as settings_module
from app.settings import Settings

_REGION = "ca-central-1"
_HOST = "db.internal.invalid"
# Every character that breaks a naively assembled URL or configparser.
_PASSWORD = "p%40ss:w@rd/%-LEAKCANARY"
_USERNAME = "fanwire_admin"
_DB_ENV = (
    "DATABASE_URL",
    "DATABASE_SECRET_ARN",
    "DATABASE_HOST",
    "DATABASE_PORT",
    "DATABASE_NAME",
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in _DB_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_DEFAULT_REGION", _REGION)
    _clear_secret_cache()
    yield
    _clear_secret_cache()


def _clear_secret_cache() -> None:
    """The once-per-process cache, emptied so each test reads afresh."""
    cached = getattr(settings_module, "database_url_from_secret", None)
    if cached is not None:
        cached.cache_clear()


def _point_at_secret(monkeypatch, arn: str) -> None:
    monkeypatch.setenv("DATABASE_SECRET_ARN", arn)
    monkeypatch.setenv("DATABASE_HOST", _HOST)
    monkeypatch.setenv("DATABASE_PORT", "5432")
    monkeypatch.setenv("DATABASE_NAME", "fanwire")


class _CountingClient:
    """A Secrets Manager client that counts reads and returns one secret."""

    def __init__(self, secret: dict[str, str]) -> None:
        self.secret = secret
        self.reads: list[str] = []

    def get_secret_value(self, SecretId: str) -> dict[str, str]:  # noqa: N803 - boto3's name
        self.reads.append(SecretId)
        return {"SecretString": json.dumps(self.secret)}


def _stub_client(monkeypatch, secret: dict[str, str]) -> _CountingClient:
    client = _CountingClient(secret)
    created: list[str] = []

    def fake_client(service: str, **kwargs):
        created.append(service)
        assert service == "secretsmanager"
        return client

    monkeypatch.setattr(settings_module.boto3, "client", fake_client)
    return client


def test_url_is_built_from_the_secret_with_the_credentials_url_quoted(monkeypatch):
    with mock_aws():
        arn = boto3.client("secretsmanager", region_name=_REGION).create_secret(
            Name="fanwire-db",
            SecretString=json.dumps(
                {"username": _USERNAME, "password": _PASSWORD, "engine": "postgres"}
            ),
        )["ARN"]
        _point_at_secret(monkeypatch, arn)

        url = Settings(_env_file=None).database_url

    assert url == (
        f"postgresql+psycopg://{_USERNAME}:{quote(_PASSWORD, safe='')}@{_HOST}:5432/fanwire"
    )
    parsed = make_url(url)
    assert parsed.password == _PASSWORD
    assert parsed.username == _USERNAME
    assert (parsed.host, parsed.port, parsed.database) == (_HOST, 5432, "fanwire")


def test_the_secret_is_read_once_per_process_however_often_settings_is_built(monkeypatch):
    client = _stub_client(monkeypatch, {"username": _USERNAME, "password": _PASSWORD})
    _point_at_secret(monkeypatch, "arn:aws:secretsmanager:ca-central-1:111122223333:secret:db-AbCdEf")

    urls = {Settings(_env_file=None).database_url for _ in range(3)}

    assert len(urls) == 1
    assert client.reads == ["arn:aws:secretsmanager:ca-central-1:111122223333:secret:db-AbCdEf"]


def test_database_url_wins_when_set_and_the_secret_is_never_read(monkeypatch):
    client = _stub_client(monkeypatch, {"username": "x", "password": "y"})
    _point_at_secret(monkeypatch, "arn:aws:secretsmanager:ca-central-1:111122223333:secret:db-AbCdEf")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")

    assert Settings(_env_file=None).database_url == "postgresql+psycopg://u:p@localhost:5432/db"
    assert client.reads == []


def test_neither_configured_fails_fast_naming_both_options():
    with pytest.raises(ValidationError) as excinfo:
        Settings(_env_file=None)
    message = str(excinfo.value)
    assert "DATABASE_URL" in message
    assert "DATABASE_SECRET_ARN" in message


def test_a_secret_arn_without_the_host_or_name_fails_fast(monkeypatch):
    client = _stub_client(monkeypatch, {"username": _USERNAME, "password": _PASSWORD})
    monkeypatch.setenv("DATABASE_SECRET_ARN", "arn:aws:secretsmanager:ca-central-1:1:secret:db")

    with pytest.raises(ValidationError) as excinfo:
        Settings(_env_file=None)

    assert "DATABASE_HOST" in str(excinfo.value)
    assert client.reads == []


def test_a_secret_without_a_password_fails_without_quoting_the_secret(monkeypatch):
    _stub_client(monkeypatch, {"username": _USERNAME, "pass": _PASSWORD})
    _point_at_secret(monkeypatch, "arn:aws:secretsmanager:ca-central-1:1:secret:db")

    with pytest.raises(Exception) as excinfo:
        Settings(_env_file=None)

    assert "password" in str(excinfo.value)
    assert _PASSWORD not in str(excinfo.value)
    assert quote(_PASSWORD, safe="") not in str(excinfo.value)


def test_a_later_validation_failure_does_not_quote_the_built_url(monkeypatch):
    _stub_client(monkeypatch, {"username": _USERNAME, "password": _PASSWORD})
    _point_at_secret(monkeypatch, "arn:aws:secretsmanager:ca-central-1:1:secret:db")
    monkeypatch.setenv("PERF_JWKS_PATH", "jwks.json")  # refused outside ENVIRONMENT=perf

    with pytest.raises(ValidationError) as excinfo:
        Settings(_env_file=None)

    rendered = str(excinfo.value)
    assert _PASSWORD not in rendered
    assert quote(_PASSWORD, safe="") not in rendered


def test_the_settings_repr_does_not_carry_the_password(monkeypatch):
    _stub_client(monkeypatch, {"username": _USERNAME, "password": _PASSWORD})
    _point_at_secret(monkeypatch, "arn:aws:secretsmanager:ca-central-1:1:secret:db")

    settings = Settings(_env_file=None)

    assert quote(_PASSWORD, safe="") not in repr(settings)
    assert quote(_PASSWORD, safe="") not in str(settings)
