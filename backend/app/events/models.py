"""SQLAlchemy 2.0 declarative models for events/: Team, Game, Player and
PlayerGameStats (the box score).

Schema and rationale: wiki/CodeContext/Modules/0x02-events.md.
Every table uses a bigint identity primary key, never UUID, per
wiki/CodeContext/Modules/0x00-architecture.md "Cross-cutting conventions".

`Team` is seeded up front; `Game` FKs into it. There is no auto-create path
for an unrecognized team or player -- see wiki/CodeContext/Modules/
0x00-architecture.md "Data seeding order" and app.events.errors.

Every row is keyed by nba.com's id (`nba_team_id`/`nba_game_id`/
`nba_person_id`, from the NBA dataset loader, app.events.nba_history):
required and unique, the one source-of-truth key for sports data.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, ForeignKey, Identity, Index, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.elements import ColumnElement

from app.db import Base


class Team(Base):
    """NBA team reference data. One row per team, effectively static. No FKs
    out of Team; Game FKs into it."""

    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    # nba.com TEAM_IDs (1610612737...) exceed a 32-bit int, hence BigInteger.
    nba_team_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    abbreviation: Mapped[str] = mapped_column(Text, nullable=False)
    conference: Mapped[str] = mapped_column(Text, nullable=False)
    division: Mapped[str] = mapped_column(Text, nullable=False)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)


class Game(Base):
    """An imported NBA game result. Its box score is PlayerGameStats."""

    __tablename__ = "games"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    nba_game_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    home_team_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("teams.id"), nullable=False)
    away_team_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("teams.id"), nullable=False)
    date: Mapped[datetime] = mapped_column(nullable=False)
    # e.g. "2025-26" — settled format, see wiki/CodeContext/Modules/0x02-events.md.
    season: Mapped[str] = mapped_column(Text, nullable=False)
    home_score: Mapped[int] = mapped_column(nullable=False)
    away_score: Mapped[int] = mapped_column(nullable=False)
    venue: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "regular" / "cup-final" / "play-in" / "playoffs", set by the NBA
    # dataset loader (app.events.nba_history) from the nba.com game id
    # prefix. Nullable because a game type is never invented for a row that
    # came without one.
    game_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The dataset's display labels as written: "NBA Finals" / "Game 5",
    # "Emirates NBA Cup" / "East Group B". Null when the source leaves them blank.
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    sub_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A playoff series' game number (1-7); null outside a series.
    series_game_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Points per period: four quarters, then overtimes. The source gives the
    # first and second overtime and all overtimes together, so a third
    # overtime and any later are one figure (all - first - second). Null when
    # the source has no team line for the game.
    home_line_score: Mapped[list[int] | None] = mapped_column(ARRAY(Integer), nullable=True)
    away_line_score: Mapped[list[int] | None] = mapped_column(ARRAY(Integer), nullable=True)


class Player(Base):
    """An NBA player, keyed by nba.com's personId. Attributes are as the
    dataset's Players.csv gives them; one the file leaves blank is null."""

    __tablename__ = "players"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    nba_person_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    first_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    birth_date: Mapped[date | None] = mapped_column(nullable=True)
    height_inches: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_lbs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    country: Mapped[str | None] = mapped_column(Text, nullable=True)
    school: Mapped[str | None] = mapped_column(Text, nullable=True)
    jersey: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "G", "F", "C" or a combination in that order ("G-F", "F-C").
    position: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    draft_round: Mapped[int | None] = mapped_column(Integer, nullable=True)
    draft_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "YYYY-YY", like Game.season.
    first_season: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_season: Mapped[str | None] = mapped_column(Text, nullable=True)


class PlayerGameStats(Base):
    """One player's line in one game's box score. A player who did not play
    has no minutes (`seconds_played` null), the source's reason and zeros.
    Percentages are not stored: they are computed from made and attempted."""

    __tablename__ = "player_game_stats"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    game_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("games.id"), nullable=False)
    player_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("players.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("teams.id"), nullable=False)
    starter: Mapped[bool] = mapped_column(nullable=False)
    # "G", "F" or "C" for a starter; null for the bench.
    starting_position: Mapped[str | None] = mapped_column(Text, nullable=True)
    seconds_played: Mapped[int | None] = mapped_column(Integer, nullable=True)
    field_goals_made: Mapped[int] = mapped_column(Integer, nullable=False)
    field_goals_attempted: Mapped[int] = mapped_column(Integer, nullable=False)
    three_pointers_made: Mapped[int] = mapped_column(Integer, nullable=False)
    three_pointers_attempted: Mapped[int] = mapped_column(Integer, nullable=False)
    free_throws_made: Mapped[int] = mapped_column(Integer, nullable=False)
    free_throws_attempted: Mapped[int] = mapped_column(Integer, nullable=False)
    offensive_rebounds: Mapped[int] = mapped_column(Integer, nullable=False)
    defensive_rebounds: Mapped[int] = mapped_column(Integer, nullable=False)
    rebounds: Mapped[int] = mapped_column(Integer, nullable=False)
    assists: Mapped[int] = mapped_column(Integer, nullable=False)
    steals: Mapped[int] = mapped_column(Integer, nullable=False)
    blocks: Mapped[int] = mapped_column(Integer, nullable=False)
    turnovers: Mapped[int] = mapped_column(Integer, nullable=False)
    personal_fouls: Mapped[int] = mapped_column(Integer, nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    plus_minus: Mapped[int] = mapped_column(Integer, nullable=False)
    dnp_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # Box-score reads go by game; this constraint's index serves them.
        UniqueConstraint("game_id", "player_id", name="uq_player_game_stats_game_player"),
        # Career and game-log reads go by player.
        Index("ix_player_game_stats_player_id", "player_id"),
    )

    @hybrid_property
    def played(self) -> bool:
        """Whether the player got on the court: the row has minutes."""
        return self.seconds_played is not None

    @played.inplace.expression
    @classmethod
    def _played_expression(cls) -> ColumnElement[bool]:
        return cls.seconds_played.is_not(None)
