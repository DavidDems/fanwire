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
