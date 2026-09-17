from app.settings import Settings


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
