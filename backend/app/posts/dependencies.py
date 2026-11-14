"""FastAPI dependency wiring for posts/'s write path — the pre-publish
moderation chain and PublishPostFacade.

Per AGENTS.md's connection rule, this module imports from app.posts.*,
app.eventbus and app.dependencies, plus
app.users.service.account_created_at, the users module's public read of an
account's creation time (HeuristicSpamScorer takes it as an injected
callable, bound here to the request's session, so app.posts.moderation
itself never imports app.users).

The chain holds no fake: SpamScoreCheck is wired against the real
HeuristicSpamScorer (POSTS-003), its threshold and new-account age from
Settings (spam_score_threshold / spam_new_account_hours), and
RateLimitCheck against the real PostCountRateLimiter (POSTS-002), its
limits from Settings (post_rate_limit_per_minute /
post_rate_limit_per_hour). FakeSpamScorer and FakeRateLimiter are test
doubles only. ProfanityFilter is config-driven via Settings; the spam
scorer's account age, RateLimitCheck and DuplicateContentCheck are
DB-backed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import Depends
from sqlalchemy.orm import Session

from app.dependencies import get_event_bus, get_session, get_settings
from app.eventbus import PostEventBus
from app.posts.facade import PublishPostFacade
from app.posts.moderation import (
    DuplicateContentCheck,
    HeuristicSpamScorer,
    ModerationCheck,
    PostCountRateLimiter,
    ProfanityFilter,
    RateLimitCheck,
    SpamScoreCheck,
)
from app.settings import Settings
from app.users.service import account_created_at


def get_moderation_chain(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ModerationCheck:
    """Assembles the fixed-order chain ProfanityFilter -> SpamScoreCheck ->
    RateLimitCheck -> DuplicateContentCheck (per app.posts.moderation's own
    docstring -- don't rearrange)."""
    banned_words = frozenset(
        word.strip().lower()
        for word in settings.moderation_banned_words.split(",")
        if word.strip()
    )

    profanity = ProfanityFilter(banned_words)
    spam = SpamScoreCheck(
        HeuristicSpamScorer(
            account_created_at=lambda user_id: account_created_at(session, user_id),
            now=lambda: datetime.now(UTC),
            new_account_age=timedelta(hours=settings.spam_new_account_hours),
        ),
        settings.spam_score_threshold,
    )
    rate_limit = RateLimitCheck(
        PostCountRateLimiter(
            session,
            per_minute=settings.post_rate_limit_per_minute,
            per_hour=settings.post_rate_limit_per_hour,
        )
    )
    duplicate = DuplicateContentCheck(session)

    profanity.set_next(spam).set_next(rate_limit).set_next(duplicate)
    return profanity


def get_publish_post_facade(
    session: Session = Depends(get_session),
    moderation_chain: ModerationCheck = Depends(get_moderation_chain),
    event_bus: PostEventBus = Depends(get_event_bus),
) -> PublishPostFacade:
    return PublishPostFacade(session, moderation_chain, event_bus)
