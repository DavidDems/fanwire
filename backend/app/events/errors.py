"""Errors raised by events/'s data loaders."""

from __future__ import annotations


class UnrecognizedTeamError(ValueError):
    """Raised when a game or box-score row names a team the loader does not
    know. Fail fast, per wiki/CodeContext/Modules/0x00-architecture.md "Data
    seeding order" and wiki/CodeContext/Standards/design-principles.md "Fail
    fast" — never silently auto-create the Team row."""


class UnrecognizedPlayerError(ValueError):
    """Raised when a box-score row names a player absent from the dataset's
    player list. Same rule as UnrecognizedTeamError: a Player is never
    invented from a box-score row."""
