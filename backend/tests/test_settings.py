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
