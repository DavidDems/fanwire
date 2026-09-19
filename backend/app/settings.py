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
    # api_sports_key empty-string default, same reasoning as the Cognito
    # fields above: Settings() still constructs fine when unset, and an
    # empty api_sports_key (with no api_sports_secret_arn either) is
    # get_live_score_proxy's own signal to return None (no real vendor key
    # configured yet) rather than build a proxy that would fail on first
    # use. api_sports_base_url defaults to the real API-SPORTS basketball
    # endpoint (not empty) because infra/lib/app-stack.ts never sets
    # API_SPORTS_BASE_URL -- it's non-secret config with a sensible fixed
    # value, so it's defaulted here rather than plumbed through infra.
    api_sports_base_url: str = "https://v1.basketball.api-sports.io"
    api_sports_key: str = ""
    # ARN of the Secrets Manager secret holding the real API-SPORTS key
    # (infra/lib/app-stack.ts's `data.apiSportsSecret`, ingestion Lambda
    # only). Read once per cold start and cached -- see
    # app.events.dependencies.resolve_api_sports_key. api_sports_key (an
    # env var, e.g. for local dev/tests) always wins over this when both are
    # set, so a developer can override the vendor key without touching
    # Secrets Manager.
    api_sports_secret_arn: str = ""

    # EventBridge PostEventBus wiring for app.dependencies.get_event_bus.
    # Empty default keeps InMemoryEventPublisher wired for local dev/tests
    # (wiki/CodeContext/Modules/0x00-architecture.md "PostEventBus
    # implementation") -- once infra/lib/app-stack.ts's POST_EVENT_BUS_NAME
    # is set, get_event_bus() switches to the real EventBridgePublisher.
    post_event_bus_name: str = ""

    # DynamoDB live-score cache table (infra/lib/data-stack.ts's
    # `liveScoreCacheTable`) for app.events.dependencies.get_live_score_proxy.
    # Empty default keeps InMemoryLiveScoreCache wired, same "no real
    # adapter until the table name is known" precedent as post_event_bus_name.
    live_score_cache_table_name: str = ""

    # DynamoDB ingestion idempotency table (infra/lib/data-stack.ts's
    # `idempotencyTable`, partition key `id`, TTL attribute `expiration` --
    # see app.events.ingestion). Empty default only matters for tests that
    # construct Settings() without it; the real ingestion Lambda always has
    # this set (infra/lib/app-stack.ts's IDEMPOTENCY_TABLE_NAME).
    idempotency_table_name: str = ""

    # SES "From" address for app.notifications.email.SesEmailSender.
    # infra/lib/app-stack.ts only sets NOTIFICATION_FROM_ADDRESS when
    # `config.domainName` is configured (no SES identity exists otherwise) --
    # empty is SesEmailSender's own signal to skip sending (log, no PII) and
    # let in-app notifications carry on alone, never an error.
    notification_from_address: str = ""
