from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """12-factor config: every value comes from the environment, nothing
    hardcoded per-environment (wiki/CodeContext/Standards/design-principles.md)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    aws_default_region: str = "us-east-1"

    # Cognito wiring for app.users.dependencies.get_token_verifier's
    # default RefreshingTokenVerifier. Empty-string defaults so Settings()
    # still constructs fine when unset — the real values only matter once
    # get_token_verifier is actually invoked in production; route tests
    # override get_token_verifier entirely and never hit these.
    cognito_region: str = "us-east-1"
    cognito_user_pool_id: str = ""
    cognito_app_client_id: str = ""
