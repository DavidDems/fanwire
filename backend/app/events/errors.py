"""Errors raised by events/'s data loaders."""

from __future__ import annotations


class UnrecognizedTeamError(ValueError):
    """Raised when a Game payload references a team_id (top-level or inside
    player_stats) that isn't already seeded in Team. Fail fast, per
    wiki/CodeContext/Modules/0x00-architecture.md "Data seeding order" and
    wiki/CodeContext/Standards/design-principles.md "Fail fast" — never
    silently auto-create the Team row."""
