"""MentionParser — the Interpreter piece (per
wiki/CodeContext/Standards/gof-patterns.md "Interpreter") restricted to
`#GameId<digits>` tokens only.

Scope judgment call (see wiki/CodeContext/Modules/0x03-posts.md
"EventMention" section): the GoF reference doc's illustrative example also
mentions `@user` and `$TEAM` tokens; neither is implemented here.
- `@user`: no business rule in wiki/GeneralContext/Architecture/
  business-rules.md calls for in-text @mentions, and no schema table exists
  to store one (unlike EventMention) -- YAGNI.
- `$TEAM`: a bare team abbreviation doesn't identify one specific Game row,
  but EventMention.game_id is NOT NULL -- there's no single Game a $TEAM
  token could resolve to without an invented, undocumented rule (e.g. "most
  recent game"). The literal business rule is "a sports game result"
  (singular, specific), which #GameId satisfies directly. Left out rather
  than guessed at.

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", this
module imports only app.events.models.Game (the resolution target) --
nothing else cross-module.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.events.models import Game


@dataclass(frozen=True)
class MentionToken:
    """One parsed mention token."""

    raw_token: str  # as authored, e.g. "#GameId123"
    game_id: int  # extracted internal Game.id (NOT api_sports_game_id -- the
    # token literally encodes the internal id)


def _handle_game_id(match: re.Match[str]) -> MentionToken:
    return MentionToken(raw_token=match.group(0), game_id=int(match.group(1)))


# Data-driven grammar: a list of (compiled regex, handler) pairs, per the
# GoF doc's own framing ("a new mention syntax doesn't require a rewrite")
# -- even though only one entry exists today.
_GRAMMAR: list[tuple[re.Pattern[str], Callable[[re.Match[str]], MentionToken]]] = [
    (re.compile(r"#GameId(\d+)"), _handle_game_id),
]


def parse_mentions(text: str | None) -> list[MentionToken]:
    """Extracts every #GameId<digits> occurrence from text (empty/None text
    -> empty list)."""
    if not text:
        return []

    tokens: list[MentionToken] = []
    for pattern, handler in _GRAMMAR:
        for match in pattern.finditer(text):
            tokens.append(handler(match))
    return tokens


def resolve_mentions(
    session: Session, tokens: list[MentionToken]
) -> list[tuple[MentionToken, Game]]:
    """Looks up each token's game_id against events.Game (session.get).
    Tokens that don't resolve to an existing Game are silently dropped from
    the returned list -- per wiki/CodeContext/Modules/0x03-posts.md's
    already-resolved 'unresolved mention token' decision (post text is kept
    as-authored regardless; this function has no say over Post.text, only
    which EventMention rows get created from it)."""
    resolved: list[tuple[MentionToken, Game]] = []
    for token in tokens:
        game = session.get(Game, token.game_id)
        if game is not None:
            resolved.append((token, game))
    return resolved
