"""State pattern for `Media.status` (GoF tie-in, wiki/CodeContext/Modules/
0x04-media.md): `Uploaded -> Scanning -> Processed | Rejected` is a linear
chain of State objects, one per status, not an if/enum-branch scattered
across the codebase. `Processed` and `Rejected` are both terminal — no
further transitions out of either.

`transition()` is the ONLY place `Media.status` should be mutated from
elsewhere in this module (app.media.pipeline calls it, never sets
`.status` directly) — this is what keeps "Media.status transitions are
never illegal" true.

Out of scope here: a later phase (posts/, Phase 2) is what will make "only
Processed media attachable to a Post by construction, not a runtime check"
real (e.g. a typed accessor posts/ calls) — posts/ doesn't exist yet. This
module only guarantees the transition itself is never illegal.
"""

from __future__ import annotations

import abc
from typing import ClassVar

from app.media.models import Media, MediaStatus


class IllegalTransitionError(Exception):
    """Raised by transition() when the target status isn't in the current
    state's allowed_next()."""


class MediaState(abc.ABC):
    """One concrete subclass per MediaStatus member."""

    status: ClassVar[MediaStatus]

    @abc.abstractmethod
    def allowed_next(self) -> frozenset[MediaStatus]:
        """The set of statuses this state may legally transition to."""


class UploadedState(MediaState):
    status = MediaStatus.UPLOADED

    def allowed_next(self) -> frozenset[MediaStatus]:
        return frozenset({MediaStatus.SCANNING})


class ScanningState(MediaState):
    status = MediaStatus.SCANNING

    def allowed_next(self) -> frozenset[MediaStatus]:
        return frozenset({MediaStatus.PROCESSED, MediaStatus.REJECTED})


class ProcessedState(MediaState):
    status = MediaStatus.PROCESSED

    def allowed_next(self) -> frozenset[MediaStatus]:
        return frozenset()  # terminal


class RejectedState(MediaState):
    status = MediaStatus.REJECTED

    def allowed_next(self) -> frozenset[MediaStatus]:
        return frozenset()  # terminal


_STATES: dict[MediaStatus, MediaState] = {
    MediaStatus.UPLOADED: UploadedState(),
    MediaStatus.SCANNING: ScanningState(),
    MediaStatus.PROCESSED: ProcessedState(),
    MediaStatus.REJECTED: RejectedState(),
}


def transition(media: Media, target: MediaStatus) -> None:
    """Move `media` to `target`, or raise IllegalTransitionError if that
    isn't a legal move from `media`'s current status."""
    current_state = _STATES[media.status]
    if target not in current_state.allowed_next():
        raise IllegalTransitionError(
            f"cannot transition Media {media.id!r} from {media.status} to {target}"
        )
    media.status = target
