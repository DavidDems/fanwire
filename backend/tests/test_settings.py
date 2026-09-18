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


def test_settings_reads_api_sports_base_url_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("API_SPORTS_BASE_URL", "https://api-sports.example.com")
    settings = Settings()
    assert settings.api_sports_base_url == "https://api-sports.example.com"


def test_settings_defaults_api_sports_key_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("API_SPORTS_KEY", raising=False)
    settings = Settings()
    assert settings.api_sports_key == ""


def test_settings_reads_api_sports_key_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("API_SPORTS_KEY", "test-key")
    settings = Settings()
    assert settings.api_sports_key == "test-key"


def test_settings_defaults_api_sports_base_url_to_the_v1_basketball_endpoint(monkeypatch):
    # infra/lib/app-stack.ts never sets API_SPORTS_BASE_URL (only
    # API_SPORTS_SECRET_ARN) -- this is non-secret config, defaulted here
    # rather than in infra. See app.events.dependencies.
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("API_SPORTS_BASE_URL", raising=False)
    settings = Settings()
    assert settings.api_sports_base_url == "https://v1.basketball.api-sports.io"


def test_settings_reads_api_sports_base_url_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("API_SPORTS_BASE_URL", "https://api-sports.example.com")
    settings = Settings()
    assert settings.api_sports_base_url == "https://api-sports.example.com"


def test_settings_defaults_api_sports_secret_arn_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("API_SPORTS_SECRET_ARN", raising=False)
    settings = Settings()
    assert settings.api_sports_secret_arn == ""


def test_settings_reads_api_sports_secret_arn_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("API_SPORTS_SECRET_ARN", "arn:aws:secretsmanager:ca-central-1:1:secret:x")
    settings = Settings()
    assert settings.api_sports_secret_arn == "arn:aws:secretsmanager:ca-central-1:1:secret:x"


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


def test_settings_defaults_live_score_cache_table_name_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("LIVE_SCORE_CACHE_TABLE_NAME", raising=False)
    settings = Settings()
    assert settings.live_score_cache_table_name == ""


def test_settings_reads_live_score_cache_table_name_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("LIVE_SCORE_CACHE_TABLE_NAME", "fanwire-live-score-cache")
    settings = Settings()
    assert settings.live_score_cache_table_name == "fanwire-live-score-cache"


def test_settings_defaults_idempotency_table_name_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.delenv("IDEMPOTENCY_TABLE_NAME", raising=False)
    settings = Settings()
    assert settings.idempotency_table_name == ""


def test_settings_reads_idempotency_table_name_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@host:5432/db")
    monkeypatch.setenv("IDEMPOTENCY_TABLE_NAME", "fanwire-idempotency")
    settings = Settings()
    assert settings.idempotency_table_name == "fanwire-idempotency"


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
    monkeypatch.setenv("NOTIFICATION_FROM_ADDRESS", "notifications@fanwire.daviddems.ca")
    settings = Settings()
    assert settings.notification_from_address == "notifications@fanwire.daviddems.ca"
