"""Pydantic response models for events/ routes.

`model_config = ConfigDict(from_attributes=True)` lets these build directly
from app.events.models ORM instances (`TeamOut.model_validate(team)` /
FastAPI's `response_model` doing that implicitly) without a separate mapping
step. See wiki/CodeContext/Modules/0x02-events.md for the schema these
mirror.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    api_sports_team_id: int
    name: str
    abbreviation: str
    conference: str
    division: str
    logo_url: str | None


class GameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    api_sports_game_id: int
    home_team_id: int
    away_team_id: int
    date: datetime
    season: str
    home_score: int
    away_score: int
    venue: str | None
    player_stats: list[dict[str, Any]]
