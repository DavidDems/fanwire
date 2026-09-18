"""Pre-publish moderation chain (Chain of Responsibility, per
wiki/CodeContext/Standards/gof-patterns.md): `ProfanityFilter ->
SpamScoreCheck -> RateLimitCheck -> DuplicateContentCheck`, this exact
fixed order -- don't rearrange.

This is NOT the excluded moderation/ module -- wiki/CodeContext/Modules/
0x03-posts.md is explicit that module doesn't exist for v1. This is
pre-publish validation only, owned by (and only ever invoked from)
PublishPostFacade (a later unit, not built here). Runs synchronously
before persistence, per wiki/CodeContext/Standards/security.md
"User-generated content".

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", this
module imports only app.posts.models.Post and the SQLAlchemy Session type
-- nothing cross-module.
"""

from __future__ import annotations

import abc
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.posts.models import Post


class PostRejected(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ModerationContext:
    author_id: int
    text: str | None


class ModerationCheck(abc.ABC):
    """One link in the chain. `set_next` wires the chain (returns the
    argument, so `a.set_next(b).set_next(c)` chains fluently); `handle`
    runs this check then forwards to the next link if one exists.
    Concrete checks implement `check` only, raising PostRejected to halt
    the whole chain (a later link never runs once an earlier one
    rejects)."""

    _next: ModerationCheck | None = None

    def set_next(self, next_check: ModerationCheck) -> ModerationCheck:
        self._next = next_check
        return next_check

    def handle(self, context: ModerationContext) -> None:
        self.check(context)
        if self._next is not None:
            self._next.handle(context)

    @abc.abstractmethod
    def check(self, context: ModerationContext) -> None: ...


class ProfanityFilter(ModerationCheck):
    """Case-insensitive whole-word match against context.text against an
    injected banned-word list. The real production word list is a
    runtime/config concern, deliberately not hardcoded here -- tests inject
    a small set."""

    def __init__(self, banned_words: frozenset[str]) -> None:
        self._pattern: re.Pattern[str] | None = None
        if banned_words:
            alternation = "|".join(re.escape(word) for word in banned_words)
            self._pattern = re.compile(rf"\b(?:{alternation})\b", re.IGNORECASE)

    def check(self, context: ModerationContext) -> None:
        if context.text and self._pattern is not None and self._pattern.search(context.text):
            raise PostRejected("contains a banned word")


class SpamScorer(abc.ABC):
    """Narrow injected interface (Dependency Inversion, same shape as
    app.media.pipeline.MalwareScanner) -- no real implementation exists yet
    (no live AWS/ML service this phase, same "future work" precedent as
    MalwareScanner/GuardDutyMalwareScanner)."""

    @abc.abstractmethod
    def score(self, text: str | None) -> float: ...


class FakeSpamScorer(SpamScorer):
    """Test double: constructed with a fixed score."""

    def __init__(self, fixed_score: float) -> None:
        self._fixed_score = fixed_score

    def score(self, text: str | None) -> float:
        return self._fixed_score


class SpamScoreCheck(ModerationCheck):
    def __init__(self, scorer: SpamScorer, threshold: float) -> None:
        self._scorer = scorer
        self._threshold = threshold

    def check(self, context: ModerationContext) -> None:
        if self._scorer.score(context.text) >= self._threshold:
            raise PostRejected("spam score at or above threshold")


class RateLimiter(abc.ABC):
    """Narrow injected interface. No real DynamoDB-backed implementation
    this phase (wiki/CodeContext/Standards/security.md: "API Gateway usage
    plan + an app-level check against the DynamoDB cache table" -- the
    DynamoDB-cache-check half is this interface's real implementation,
    future work, same precedent as the ingestion pipeline's idempotency
    table)."""

    @abc.abstractmethod
    def is_allowed(self, user_id: int) -> bool: ...


class FakeRateLimiter(RateLimiter):
    """Test double: constructed with a fixed allow/deny verdict, or a
    dict[int, bool] for per-author_id verdicts in one test."""

    def __init__(self, verdict: bool | dict[int, bool]) -> None:
        self._verdict = verdict

    def is_allowed(self, user_id: int) -> bool:
        if isinstance(self._verdict, dict):
            return self._verdict.get(user_id, True)
        return self._verdict


class RateLimitCheck(ModerationCheck):
    def __init__(self, rate_limiter: RateLimiter) -> None:
        self._rate_limiter = rate_limiter

    def check(self, context: ModerationContext) -> None:
        if not self._rate_limiter.is_allowed(context.author_id):
            raise PostRejected("rate limit exceeded")


class DuplicateContentCheck(ModerationCheck):
    """Queries app.posts.models.Post for an existing row with the same
    author_id and exact same text (only when context.text is not
    null/empty -- an empty-text plain repost should never trip this). No
    time window (KISS -- nothing specifies one)."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def check(self, context: ModerationContext) -> None:
        if not context.text:
            return
        existing = self._session.scalar(
            select(Post).where(
                Post.author_id == context.author_id,
                Post.text == context.text,
            )
        )
        if existing is not None:
            raise PostRejected("duplicate content")
