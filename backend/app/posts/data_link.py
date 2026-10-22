"""DataLink — a post's one sports-data attachment (POSTS-005), and the one
place it is mapped onto, and read back from, Post's link columns
(linked_game_id, linked_player_game_stats_id, linked_player_id,
linked_player_scope, and POSTS-006's linked_line_game_id, the game of a
player_game link's line). Schema and rationale:
wiki/CodeContext/Modules/0x03-posts.md.

The attachment's target is checked, and a line's game read, through events/'
public interface only (app.events.service's EVENTS-009 validate_* and
player_game_previews functions and the app.events.errors refusals they
raise), per
wiki/CodeContext/Modules/0x00-architecture.md "Connection rule" -- never
app.events.models.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, cast

from sqlalchemy.orm import Session

from app.events.errors import (
    GameNotCompletedError,
    LinkTargetError,
    LinkTargetNotFoundError,
    NoGamesInScopeError,
    PlayerDidNotPlayError,
)
from app.events.service import (
    player_game_previews,
    validate_game_final,
    validate_player_career,
    validate_player_game,
)

DataLinkType = Literal["game_final", "player_game", "player_career"]
CareerScope = Literal["regular", "playoffs"]

# events/' refusals -> the machine detail code the route answers 422 with.
_TARGET_REFUSAL_CODES: dict[type[LinkTargetError], str] = {
    LinkTargetNotFoundError: "link_target_not_found",
    GameNotCompletedError: "game_not_completed",
    PlayerDidNotPlayError: "player_did_not_play",
    NoGamesInScopeError: "no_games_in_scope",
}


class DataLinkRefused(ValueError):
    """A post's data_link is refused, by a post-level rule (a reply, a plain
    repost) or by its target's validator.
    `code` is the machine detail the route answers 422 with."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class DataLink:
    """One attachment: `ref_id` is a games.id (game_final), a
    player_game_stats.id (player_game) or a players.id (player_career);
    `scope` is set for player_career only. The request's shape is already
    checked at the boundary (app.posts.schemas), so this trusts it."""

    type: DataLinkType
    ref_id: int
    scope: CareerScope | None = None

    def columns(self, session: Session) -> dict[str, object]:
        """The Post column values that store this link: exactly one target id
        (and, for a career, the scope; for a line, its game, read from
        events/' player_game_preview); the others stay null. Called after
        validate_target, so a line's preview exists."""
        if self.type == "game_final":
            return {"linked_game_id": self.ref_id}
        if self.type == "player_game":
            line = player_game_previews(session, [self.ref_id])[self.ref_id]
            return {
                "linked_player_game_stats_id": self.ref_id,
                "linked_line_game_id": line.game_id,
            }
        return {"linked_player_id": self.ref_id, "linked_player_scope": self.scope}

    @classmethod
    def from_columns(
        cls,
        *,
        linked_game_id: int | None,
        linked_player_game_stats_id: int | None,
        linked_player_id: int | None,
        linked_player_scope: str | None,
    ) -> DataLink | None:
        """The inverse of `columns`; None for a post without an attachment.
        The CHECK constraints guarantee at most one id is set."""
        if linked_game_id is not None:
            return cls(type="game_final", ref_id=linked_game_id)
        if linked_player_game_stats_id is not None:
            return cls(type="player_game", ref_id=linked_player_game_stats_id)
        if linked_player_id is not None:
            scope = cast(CareerScope, linked_player_scope)
            return cls(type="player_career", ref_id=linked_player_id, scope=scope)
        return None

    def validate_target(self, session: Session) -> None:
        """Runs the target's EVENTS-009 validator; a refusal is re-raised as
        DataLinkRefused with its machine code."""
        try:
            if self.type == "game_final":
                validate_game_final(session, self.ref_id)
            elif self.type == "player_game":
                validate_player_game(session, self.ref_id)
            else:
                validate_player_career(session, self.ref_id, self.scope or "")
        except LinkTargetError as exc:
            raise DataLinkRefused(_TARGET_REFUSAL_CODES[type(exc)]) from exc
