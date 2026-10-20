from pydantic import Field, PositiveInt
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

    # Per-author post rate limits for app.posts.moderation.PostCountRateLimiter
    # (every kind of post counts). PositiveInt so zero, a negative number or a
    # non-integer fails when Settings is built, not at the first post.
    post_rate_limit_per_minute: PositiveInt = 10
    post_rate_limit_per_hour: PositiveInt = 100

    # app.posts.moderation.HeuristicSpamScorer: a post scoring at or above
    # the threshold is refused, and an account younger than
    # spam_new_account_hours is new (a new account posting a link scores
    # higher). The threshold must be in (0, 1] and the age a positive
    # integer, so a bad value fails when Settings is built, not at the first
    # post. The scorer's weights are constants in the scorer, not settings.
    spam_score_threshold: float = Field(default=0.8, gt=0, le=1)
    spam_new_account_hours: PositiveInt = 24

    # EventBridge PostEventBus wiring for app.dependencies.get_event_bus.
    # Empty default keeps InMemoryEventPublisher wired for local dev/tests
    # (wiki/CodeContext/Modules/0x00-architecture.md "PostEventBus
    # implementation") -- once infra/lib/app-stack.ts's POST_EVENT_BUS_NAME
    # is set, get_event_bus() switches to the real EventBridgePublisher.
    post_event_bus_name: str = ""

    # SES "From" address for app.notifications.email.SesEmailSender.
    # infra/lib/app-stack.ts only sets NOTIFICATION_FROM_ADDRESS when
    # `config.domainName` is configured (no SES identity exists otherwise) --
    # empty is SesEmailSender's own signal to skip sending (log, no PII) and
    # let in-app notifications carry on alone, never an error.
    notification_from_address: str = ""

    # The bucket app.events.load_handler (the SportsDataLoad Lambda) reads
    # the NBA dataset's CSVs from, under nba-eoin/. Set by
    # infra/lib/app-stack.ts on that function only. Empty means unset, and
    # the handler fails fast on it.
    sports_data_bucket: str = ""
