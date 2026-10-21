"""Errors raised by events/: its data loaders' refusals, and the attachment
targets posts/ validates through app.events.service (EVENTS-009)."""

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


class LinkTargetError(ValueError):
    """A sports-data attachment's target is refused: the base posts/ catches
    to turn any of the refusals below into one client error. A malformed
    request (an unknown career scope) is a plain ValueError instead, never
    one of these: the caller is wrong, not the target."""


class LinkTargetNotFoundError(LinkTargetError):
    """No game, box-score line or player has the target's id."""


class GameNotCompletedError(LinkTargetError):
    """A `game_final` target's game has no result yet (Game.completed)."""


class PlayerDidNotPlayError(LinkTargetError):
    """A `player_game` target is a did-not-play line: it has no minutes."""


class NoGamesInScopeError(LinkTargetError):
    """A `player_career` target's player has no played game of that scope's
    game type, so there is no line to average."""
