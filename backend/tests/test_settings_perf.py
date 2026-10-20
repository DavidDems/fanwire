"""PERF-001: Settings.environment and Settings.perf_jwks_path, per AGENTS.md
TDD workflow. Written before either field exists.

The local load test lets the backend accept ID tokens signed by a local test
key, read from the JWKS file at PERF_JWKS_PATH. That must be impossible
anywhere but the compose perf profile, so Settings itself refuses to build
when PERF_JWKS_PATH is set and ENVIRONMENT is anything but exactly "perf"
(case-sensitive, no surrounding whitespace). Fail closed at construction,
not at the first request.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.settings import Settings

_DB = "postgresql+psycopg://u:p@host:5432/db"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", _DB)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("PERF_JWKS_PATH", raising=False)


def test_environment_and_perf_jwks_path_default_to_empty():
    settings = Settings()

    assert settings.environment == ""
    assert settings.perf_jwks_path == ""


@pytest.mark.parametrize("environment", ["", "development", "production", "perf", "Perf"])
def test_environment_alone_constructs(environment):
    settings = Settings(environment=environment)

    assert settings.environment == environment
    assert settings.perf_jwks_path == ""


def test_perf_environment_with_a_jwks_path_constructs():
    settings = Settings(environment="perf", perf_jwks_path="/var/task/perf-results/jwks.json")

    assert settings.environment == "perf"
    assert settings.perf_jwks_path == "/var/task/perf-results/jwks.json"


def test_environment_and_perf_jwks_path_read_from_env(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "perf")
    monkeypatch.setenv("PERF_JWKS_PATH", "/tmp/jwks.json")

    settings = Settings()

    assert settings.environment == "perf"
    assert settings.perf_jwks_path == "/tmp/jwks.json"


@pytest.mark.parametrize("environment", ["", "development", "production", "Perf", " perf", "perf "])
def test_perf_jwks_path_outside_the_perf_environment_is_refused(environment):
    with pytest.raises(ValidationError):
        Settings(environment=environment, perf_jwks_path="/tmp/jwks.json")


def test_perf_jwks_path_from_env_without_environment_is_refused(monkeypatch):
    monkeypatch.setenv("PERF_JWKS_PATH", "/tmp/jwks.json")

    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize("environment", ["production", "Perf", "development"])
def test_perf_jwks_path_from_env_with_a_non_perf_environment_is_refused(monkeypatch, environment):
    monkeypatch.setenv("ENVIRONMENT", environment)
    monkeypatch.setenv("PERF_JWKS_PATH", "/tmp/jwks.json")

    with pytest.raises(ValidationError):
        Settings()
