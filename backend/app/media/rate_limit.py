"""Per-user limit on media uploads (POSTS-010): POST /media/uploads answers
429 once the uploader has too many recent Media rows.

media/'s own narrow interface, not app.posts.moderation.RateLimiter: per
wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", media/
never imports posts/' moderation, so the same small shape is defined here.
app.media.dependencies.get_upload_rate_limiter wires the real
MediaCountRateLimiter from Settings; FakeUploadRateLimiter is a test double.
"""

from __future__ import annotations

import abc

from sqlalchemy import text
from sqlalchemy.orm import Session


class UploadRateLimiter(abc.ABC):
    """Narrow injected interface: may `user_id` start another upload?"""

    @abc.abstractmethod
    def is_allowed(self, user_id: int) -> bool: ...


class FakeUploadRateLimiter(UploadRateLimiter):
    """Test double: constructed with a fixed allow/deny verdict."""

    def __init__(self, verdict: bool) -> None:
        self._verdict = verdict

    def is_allowed(self, user_id: int) -> bool:
        return self._verdict


# One statement over the (uploader_id, created_at) index: the hour count, and
# the minute count as a FILTER over the same rows, the shape of
# app.posts.moderation's post count. Measured against the database's now(),
# the clock Media.created_at defaults to. Strict `>`: a row exactly a minute
# (or an hour) old no longer counts. No status filter: every row counts.
_RECENT_UPLOAD_COUNTS = text(
    "SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'), count(*) "
    "FROM media "
    "WHERE uploader_id = :uploader_id AND created_at > now() - interval '1 hour'"
)


class MediaCountRateLimiter(UploadRateLimiter):
    """Sliding-window limit on the user's own Media rows, whatever their
    status: a rejected or never-uploaded row still cost a presign, and
    counting only some statuses would let a user dodge the limit by
    abandoning uploads. Allowed while the user has fewer than `per_minute`
    rows in the last minute AND fewer than `per_hour` in the last hour.

    Count-then-insert is not atomic: uploads racing at the limit can each
    see the same count and all pass, overshooting by a few. Acceptable for
    an abuse limit, and simpler than a lock -- deliberately no lock."""

    def __init__(self, session: Session, per_minute: int, per_hour: int) -> None:
        self._session = session
        self._per_minute = per_minute
        self._per_hour = per_hour

    def is_allowed(self, user_id: int) -> bool:
        minute_count, hour_count = self._session.execute(
            _RECENT_UPLOAD_COUNTS, {"uploader_id": user_id}
        ).one()
        return bool(minute_count < self._per_minute and hour_count < self._per_hour)
