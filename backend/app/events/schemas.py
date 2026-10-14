"""Pydantic response models for events/ routes.

`model_config = ConfigDict(from_attributes=True)` lets these build directly
from app.events.models ORM instances (`TeamOut.model_validate(team)` /
FastAPI's `response_model` doing that implicitly) without a separate mapping
step. See wiki/CodeContext/Modules/0x02-events.md for the schema these
mirror.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nba_team_id: int
    name: str
    abbreviation: str
    conference: str
    division: str
    logo_url: str | None


class GameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nba_game_id: int
    home_team_id: int
    away_team_id: int
    date: datetime
    season: str
    home_score: int
    away_score: int
    venue: str | None
    game_type: str | None


GameType = Literal["regular", "cup-final", "play-in", "playoffs"]


class TeamRefOut(BaseModel):
    """A team as a game detail embeds it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    abbreviation: str


class ShootingOut(BaseModel):
    """Counting stats and shooting percentages, shared by a player's line
    and a team's totals. Percentages are a fraction from 0 to 1, three
    places, computed from made and attempted; null when none was attempted."""

    model_config = ConfigDict(from_attributes=True)

    seconds_played: int
    field_goals_made: int
    field_goals_attempted: int
    field_goal_pct: float | None
    three_pointers_made: int
    three_pointers_attempted: int
    three_point_pct: float | None
    free_throws_made: int
    free_throws_attempted: int
    free_throw_pct: float | None
    offensive_rebounds: int
    defensive_rebounds: int
    rebounds: int
    assists: int
    steals: int
    blocks: int
    turnovers: int
    personal_fouls: int
    points: int


class BoxScorePlayerOut(ShootingOut):
    """One player who played: has minutes, possibly zero seconds."""

    player_id: int
    first_name: str | None
    last_name: str | None
    starter: bool
    starting_position: str | None
    plus_minus: int


class DidNotPlayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    player_id: int
    first_name: str | None
    last_name: str | None
    dnp_reason: str | None


class TeamBoxScoreOut(BaseModel):
    """One team's side: played rows (starters first, then by seconds
    played), the players who did not play, and totals summed from the
    played rows, never adjusted to the final score."""

    model_config = ConfigDict(from_attributes=True)

    players: list[BoxScorePlayerOut]
    did_not_play: list[DidNotPlayOut]
    totals: ShootingOut


class GameDetailOut(BaseModel):
    """GET /events/games/{id}: a read model built by
    app.events.service.game_detail, not the ORM row."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nba_game_id: int
    date: datetime
    season: str
    game_type: str | None
    label: str | None
    sub_label: str | None
    series_game_number: int | None
    venue: str | None
    home_score: int
    away_score: int
    home_team: TeamRefOut
    away_team: TeamRefOut
    # Points per period as stored: quarters, then overtimes (the third
    # figure after regulation is "third overtime and later"). Null when the
    # source had no team line.
    home_line_score: list[int] | None
    away_line_score: list[int] | None
    home_box_score: TeamBoxScoreOut
    away_box_score: TeamBoxScoreOut
