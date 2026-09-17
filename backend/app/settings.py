from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """12-factor config: every value comes from the environment, nothing
    hardcoded per-environment (wiki/CodeContext/Standards/design-principles.md)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    aws_default_region: str = "us-east-1"
