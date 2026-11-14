"""Tests for the State pattern in app.media.state, per AGENTS.md TDD
workflow. Written before app/media/state.py exists.

Pure in-memory unit tests — Media.status transitions never need a real
session/DB, only the Python attribute. See wiki/CodeContext/Modules/
0x04-media.md GoF pattern tie-in: `Media.status` (Uploaded -> Scanning ->
Processed/Rejected) is a State object per status, not an if/enum-branch.
"""

from __future__ import annotations

import pytest

from app.media.models import Media, MediaStatus
from app.media.state import IllegalTransitionError, transition


def _media(status: MediaStatus) -> Media:
    return Media(uploader_id=1, status=status)


def test_uploaded_to_scanning_is_allowed():
    media = _media(MediaStatus.UPLOADED)
    transition(media, MediaStatus.SCANNING)
    assert media.status == MediaStatus.SCANNING


def test_scanning_to_processed_is_allowed():
    media = _media(MediaStatus.SCANNING)
    transition(media, MediaStatus.PROCESSED)
    assert media.status == MediaStatus.PROCESSED


def test_scanning_to_rejected_is_allowed():
    media = _media(MediaStatus.SCANNING)
    transition(media, MediaStatus.REJECTED)
    assert media.status == MediaStatus.REJECTED


def test_uploaded_to_processed_is_illegal_skips_scanning():
    media = _media(MediaStatus.UPLOADED)
    with pytest.raises(IllegalTransitionError):
        transition(media, MediaStatus.PROCESSED)
    assert media.status == MediaStatus.UPLOADED


def test_uploaded_to_rejected_is_illegal_skips_scanning():
    media = _media(MediaStatus.UPLOADED)
    with pytest.raises(IllegalTransitionError):
        transition(media, MediaStatus.REJECTED)
    assert media.status == MediaStatus.UPLOADED


def test_processed_is_terminal():
    media = _media(MediaStatus.PROCESSED)
    with pytest.raises(IllegalTransitionError):
        transition(media, MediaStatus.SCANNING)
    with pytest.raises(IllegalTransitionError):
        transition(media, MediaStatus.UPLOADED)
    with pytest.raises(IllegalTransitionError):
        transition(media, MediaStatus.REJECTED)


def test_rejected_is_terminal():
    media = _media(MediaStatus.REJECTED)
    with pytest.raises(IllegalTransitionError):
        transition(media, MediaStatus.SCANNING)
    with pytest.raises(IllegalTransitionError):
        transition(media, MediaStatus.UPLOADED)
    with pytest.raises(IllegalTransitionError):
        transition(media, MediaStatus.PROCESSED)
