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

    # S3 buckets media/ routes presign uploads into / serve processed
    # variants from. Defaults let Settings() still construct with nothing
    # set; the real values only matter once app.media.dependencies.get_s3_client
    # or ImageUploadPipeline actually issue/serve against them — route
    # tests override get_s3_client entirely (moto) and never depend on
    # these resolving to a bucket that actually exists.
    media_quarantine_bucket: str = "fanwire-media-quarantine"
    media_public_bucket: str = "fanwire-media-public"

    # Comma-separated banned-word list for app.posts.moderation.ProfanityFilter
    # (12-factor: env vars are strings, not lists). Parsed by
    # app.posts.dependencies.get_moderation_chain into a
    # frozenset[str] -- empty string (the default) means no word is banned.
    moderation_banned_words: str = ""

    # API-SPORTS wiring for app.events.dependencies.get_live_score_proxy.
    # Empty-string defaults, same reasoning as the Cognito fields above:
    # Settings() still constructs fine when unset, and an empty
    # api_sports_key is get_live_score_proxy's own signal to return None
    # (no real vendor key configured yet) rather than build a proxy that
    # would fail on first use.
    api_sports_base_url: str = ""
    api_sports_key: str = ""
