"""FastAPI dependency wiring for posts/'s write path — the pre-publish
moderation chain and PublishPostFacade.

Per AGENTS.md's connection rule, this module imports from app.posts.*,
app.eventbus, and app.dependencies only.

Judgment call (manager-approved, see this unit's task brief): no real
SpamScorer/RateLimiter adapter exists yet (no live AWS this phase).
SpamScoreCheck/RateLimitCheck are wired against
FakeSpamScorer(score=0.0)/FakeRateLimiter(allowed=True) as the PRODUCTION
default here — not just a test double — same precedent as
app.dependencies.get_event_bus wiring InMemoryEventPublisher as its
production default. This means neither check can currently reject
anything in production; ProfanityFilter (config-driven via Settings) and
DuplicateContentCheck (DB-backed) are the two checks with real teeth
today.
"""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from app.dependencies import get_event_bus, get_session, get_settings
from app.eventbus import PostEventBus
from app.posts.facade import PublishPostFacade
from app.posts.moderation import (
    DuplicateContentCheck,
    FakeRateLimiter,
    FakeSpamScorer,
    ModerationCheck,
    ProfanityFilter,
    RateLimitCheck,
    SpamScoreCheck,
)
from app.settings import Settings

# Threshold is meaningless while FakeSpamScorer always returns 0.0 (nothing
# will ever meet/exceed it), but SpamScoreCheck still needs one -- keep it
# out of the 0.0 the fake always returns so a future real scorer's "wired
# in but not yet tuned" default doesn't accidentally reject everything.
_SPAM_SCORE_THRESHOLD = 0.8


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
    spam = SpamScoreCheck(FakeSpamScorer(0.0), _SPAM_SCORE_THRESHOLD)
    rate_limit = RateLimitCheck(FakeRateLimiter(True))
    duplicate = DuplicateContentCheck(session)

    profanity.set_next(spam).set_next(rate_limit).set_next(duplicate)
    return profanity


def get_publish_post_facade(
    session: Session = Depends(get_session),
    moderation_chain: ModerationCheck = Depends(get_moderation_chain),
    event_bus: PostEventBus = Depends(get_event_bus),
) -> PublishPostFacade:
    return PublishPostFacade(session, moderation_chain, event_bus)
