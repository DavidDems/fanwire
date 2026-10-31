import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.settings import Settings

_BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_settings_reads_database_url_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    settings = Settings()
    assert settings.database_url == "postgresql+psycopg://u:p@host:5432/db"


def test_settings_defaults_aws_region(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)
    settings = Settings()
    assert settings.aws_default_region == "us-east-1"


def test_settings_defaults_cognito_region(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("COGNITO_REGION", raising=False)
    settings = Settings()
    assert settings.cognito_region == "us-east-1"


def test_settings_reads_cognito_region_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("COGNITO_REGION", "ca-central-1")
    settings = Settings()
    assert settings.cognito_region == "ca-central-1"


def test_settings_defaults_cognito_user_pool_id_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
    settings = Settings()
    assert settings.cognito_user_pool_id == ""


def test_settings_reads_cognito_user_pool_id_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_abc123")
    settings = Settings()
    assert settings.cognito_user_pool_id == "us-east-1_abc123"


def test_settings_defaults_cognito_app_client_id_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("COGNITO_APP_CLIENT_ID", raising=False)
    settings = Settings()
    assert settings.cognito_app_client_id == ""


def test_settings_reads_cognito_app_client_id_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", "test-client-id")
    settings = Settings()
    assert settings.cognito_app_client_id == "test-client-id"


def test_settings_defaults_media_quarantine_bucket(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("MEDIA_QUARANTINE_BUCKET", raising=False)
    settings = Settings()
    assert settings.media_quarantine_bucket == "fanwire-media-quarantine"


def test_settings_reads_media_quarantine_bucket_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("MEDIA_QUARANTINE_BUCKET", "custom-quarantine-bucket")
    settings = Settings()
    assert settings.media_quarantine_bucket == "custom-quarantine-bucket"


def test_settings_defaults_media_public_bucket(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("MEDIA_PUBLIC_BUCKET", raising=False)
    settings = Settings()
    assert settings.media_public_bucket == "fanwire-media-public"


def test_settings_reads_media_public_bucket_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("MEDIA_PUBLIC_BUCKET", "custom-public-bucket")
    settings = Settings()
    assert settings.media_public_bucket == "custom-public-bucket"


def test_settings_defaults_moderation_banned_words_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("MODERATION_BANNED_WORDS", raising=False)
    settings = Settings()
    assert settings.moderation_banned_words == ""


def test_settings_reads_moderation_banned_words_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("MODERATION_BANNED_WORDS", "badword, worseword,thirdword")
    settings = Settings()
    assert settings.moderation_banned_words == "badword, worseword,thirdword"


def test_settings_defaults_post_event_bus_name_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("POST_EVENT_BUS_NAME", raising=False)
    settings = Settings()
    assert settings.post_event_bus_name == ""


def test_settings_reads_post_event_bus_name_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("POST_EVENT_BUS_NAME", "PostEventBus")
    settings = Settings()
    assert settings.post_event_bus_name == "PostEventBus"


def test_settings_defaults_notification_from_address_empty(monkeypatch):
    # Unset until a domain exists (infra/lib/app-stack.ts only sets
    # NOTIFICATION_FROM_ADDRESS when config.domainName is configured) --
    # app.notifications.email.SesEmailSender treats empty as "email
    # disabled, in-app only", never an error.
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("NOTIFICATION_FROM_ADDRESS", raising=False)
    settings = Settings()
    assert settings.notification_from_address == ""


def test_settings_reads_notification_from_address_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("NOTIFICATION_FROM_ADDRESS", "notifications@fanwire.daviddems.com")
    settings = Settings()
    assert settings.notification_from_address == "notifications@fanwire.daviddems.com"


# EVENTS-003 retired API-SPORTS: none of its settings survive, and the app
# starts without any of their environment variables.
_RETIRED_SETTINGS = (
    "api_sports_key",
    "api_sports_secret_arn",
    "api_sports_base_url",
    "idempotency_table_name",
    "live_score_cache_table_name",
)


@pytest.mark.parametrize("name", _RETIRED_SETTINGS)
def test_settings_has_no_retired_api_sports_setting(monkeypatch, name):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    assert name not in Settings.model_fields
    assert not hasattr(Settings(), name)


@pytest.mark.parametrize("name", _RETIRED_SETTINGS)
def test_settings_ignores_a_leftover_retired_env_var(monkeypatch, name):
    # A stale variable left in a deployed environment must not break startup.
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv(name.upper(), "leftover")
    settings = Settings()
    assert not hasattr(settings, name)


def test_app_starts_and_serves_health_with_no_retired_env_vars_set():
    """A fresh interpreter, so app.main is imported (and every module-level
    dependency built) with none of the variables present."""
    env = {
        key: value
        for key, value in os.environ.items()
        if key.upper() not in {name.upper() for name in _RETIRED_SETTINGS}
    }
    env.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
    script = (
        "from fastapi.testclient import TestClient\n"
        "from app.main import app\n"
        "r = TestClient(app).get('/health')\n"
        "assert r.status_code == 200, r.status_code\n"
        "print(r.json())\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert "'status': 'ok'" in result.stdout


# --- POSTS-002: per-author post rate limits ---------------------------------

_RATE_LIMIT_ENV = {
    "post_rate_limit_per_minute": "POST_RATE_LIMIT_PER_MINUTE",
    "post_rate_limit_per_hour": "POST_RATE_LIMIT_PER_HOUR",
}


@pytest.mark.parametrize(
    ("field", "default"),
    [("post_rate_limit_per_minute", 10), ("post_rate_limit_per_hour", 100)],
)
def test_settings_defaults_post_rate_limits(monkeypatch, field, default):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv(_RATE_LIMIT_ENV[field], raising=False)
    settings = Settings()
    assert getattr(settings, field) == default


@pytest.mark.parametrize("field", sorted(_RATE_LIMIT_ENV))
def test_settings_reads_post_rate_limits_from_env(monkeypatch, field):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv(_RATE_LIMIT_ENV[field], "250")
    settings = Settings()
    assert getattr(settings, field) == 250


@pytest.mark.parametrize("field", sorted(_RATE_LIMIT_ENV))
@pytest.mark.parametrize("bad_value", ["0", "-1", "abc", "1.5"])
def test_settings_rejects_a_post_rate_limit_that_is_not_a_positive_integer(
    monkeypatch, field, bad_value
):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv(_RATE_LIMIT_ENV[field], bad_value)
    with pytest.raises(ValidationError):
        Settings()


# --- POSTS-003: the heuristic spam scorer's threshold and new-account age ---

_SPAM_ENV = {
    "spam_score_threshold": "SPAM_SCORE_THRESHOLD",
    "spam_new_account_hours": "SPAM_NEW_ACCOUNT_HOURS",
}


@pytest.mark.parametrize(
    ("field", "default"),
    [("spam_score_threshold", 0.8), ("spam_new_account_hours", 24)],
)
def test_settings_defaults_spam_settings(monkeypatch, field, default):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv(_SPAM_ENV[field], raising=False)
    settings = Settings()
    assert getattr(settings, field) == pytest.approx(default)


@pytest.mark.parametrize(
    ("field", "raw", "expected"),
    [
        ("spam_score_threshold", "0.5", 0.5),
        ("spam_score_threshold", "1", 1.0),
        ("spam_score_threshold", "0.01", 0.01),
        ("spam_new_account_hours", "48", 48),
        ("spam_new_account_hours", "1", 1),
    ],
)
def test_settings_reads_spam_settings_from_env(monkeypatch, field, raw, expected):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv(_SPAM_ENV[field], raw)
    settings = Settings()
    assert getattr(settings, field) == pytest.approx(expected)


@pytest.mark.parametrize("bad_value", ["0", "-0.1", "1.01", "2", "abc"])
def test_settings_rejects_a_spam_score_threshold_outside_zero_to_one(monkeypatch, bad_value):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv(_SPAM_ENV["spam_score_threshold"], bad_value)
    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize("bad_value", ["0", "-1", "abc", "1.5"])
def test_settings_rejects_a_spam_new_account_hours_that_is_not_a_positive_integer(
    monkeypatch, bad_value
):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv(_SPAM_ENV["spam_new_account_hours"], bad_value)
    with pytest.raises(ValidationError):
        Settings()


# --- NOTIFICATIONS-001: ENVIRONMENT=development can never run on a deployment ---


@pytest.fixture()
def _no_deployment_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("POST_EVENT_BUS_NAME", raising=False)
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)


@pytest.mark.usefixtures("_no_deployment_env")
def test_settings_accepts_development_with_no_bus_and_outside_lambda(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert Settings().environment == "development"


@pytest.mark.usefixtures("_no_deployment_env")
def test_settings_refuses_development_with_a_bus_name(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("POST_EVENT_BUS_NAME", "PostEventBus")
    with pytest.raises(ValidationError, match="POST_EVENT_BUS_NAME"):
        Settings()


@pytest.mark.usefixtures("_no_deployment_env")
def test_settings_refuses_development_inside_lambda(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "fanwire-api")
    with pytest.raises(ValidationError, match="AWS_LAMBDA_FUNCTION_NAME"):
        Settings()


@pytest.mark.usefixtures("_no_deployment_env")
@pytest.mark.parametrize("environment", [None, "", "perf", "production", "Development"])
def test_a_deployed_function_with_a_bus_name_still_starts(monkeypatch, environment):
    monkeypatch.setenv("POST_EVENT_BUS_NAME", "PostEventBus")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "fanwire-api")
    if environment is not None:
        monkeypatch.setenv("ENVIRONMENT", environment)
    assert Settings().post_event_bus_name == "PostEventBus"


@pytest.mark.usefixtures("_no_deployment_env")
def test_a_deployed_function_missing_its_bus_name_still_starts(monkeypatch):
    # With no ENVIRONMENT it behaves as it does today: the in-memory publisher.
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "fanwire-api")
    assert Settings().post_event_bus_name == ""
