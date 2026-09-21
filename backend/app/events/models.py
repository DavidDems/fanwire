"""SQLAlchemy 2.0 declarative models for events/: Team and Game.

Schema and rationale: wiki/CodeContext/Modules/0x02-events.md.
Every table uses a bigint identity primary key, never UUID, per
wiki/CodeContext/Modules/0x00-architecture.md "Cross-cutting conventions".

`Team` is seeded up front; `Game` FKs into it. There is no auto-create path
for an unrecognized team — see wiki/CodeContext/Modules/0x00-architecture.md
"Data seeding order" and app.events.ingestion.UnrecognizedTeamError.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Identity, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Team(Base):
    """NBA team reference data. One row per team, effectively static. No FKs
    out of Team; Game FKs into it."""

    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    api_sports_team_id: Mapped[int] = mapped_column(unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    abbreviation: Mapped[str] = mapped_column(Text, nullable=False)
    conference: Mapped[str] = mapped_column(Text, nullable=False)
    division: Mapped[str] = mapped_column(Text, nullable=False)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)


class Game(Base):
    """An imported NBA game result, including that game's player box score.

    `player_stats` is a JSONB array of per-player entries; each entry's
    `team_id` references `Team.id` as data, not an enforced FK (Postgres
    can't FK into JSONB array elements) — the ingestion pipeline validates it
    at import time instead (fail fast, same rule as home_team_id/
    away_team_id — see app.events.ingestion).
    """

    __tablename__ = "games"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    api_sports_game_id: Mapped[int] = mapped_column(unique=True, nullable=False)
    home_team_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("teams.id"), nullable=False)
    away_team_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("teams.id"), nullable=False)
    date: Mapped[datetime] = mapped_column(nullable=False)
    # e.g. "2025-26" — settled format, see wiki/CodeContext/Modules/0x02-events.md.
    season: Mapped[str] = mapped_column(Text, nullable=False)
    home_score: Mapped[int] = mapped_column(nullable=False)
    away_score: Mapped[int] = mapped_column(nullable=False)
    venue: Mapped[str | None] = mapped_column(Text, nullable=True)
    player_stats: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)

    __table_args__ = (
        # search/'s position filter (wiki/CodeContext/Modules/0x07-search.md)
        # queries this via JSONB containment (`player_stats @> '[{"position":
        # "<P>"}]'`) -- jsonb_path_ops is the right opclass for containment
        # (@>) queries specifically, smaller/faster than the default
        # jsonb_ops at the cost of not supporting key-existence (?) queries,
        # which nothing here needs.
        Index(
            "ix_games_player_stats_gin",
            "player_stats",
            postgresql_using="gin",
            postgresql_ops={"player_stats": "jsonb_path_ops"},
        ),
    )
