"""Pydantic response models for events/ routes.

`model_config = ConfigDict(from_attributes=True)` lets these build directly
from app.events.models ORM instances (`TeamOut.model_validate(team)` /
FastAPI's `response_model` doing that implicitly) without a separate mapping
step. See wiki/CodeContext/Modules/0x02-events.md for the schema these
mirror.
"""

from __future__ import annotations

from datetime import date, datetime
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

    # The player_game_stats row's id: a `player_game` attachment's target.
    line_id: int
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


class PlayerListItemOut(BaseModel):
    """One player in GET /events/players' list."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str | None
    last_name: str | None
    position: str | None
    jersey: str | None
    first_season: str | None
    last_season: str | None
    # The team on the player's newest box-score row by game date (DNP rows
    # included); null when the player has none.
    latest_team_abbreviation: str | None


class StatLineOut(ShootingOut):
    """A career or season line: totals of the played rows, percentages
    computed from the totals (the box score's rule) and per-game averages
    to one place, null when no game was played."""

    games_played: int
    games_started: int
    points_per_game: float | None
    rebounds_per_game: float | None
    assists_per_game: float | None
    steals_per_game: float | None
    blocks_per_game: float | None
    turnovers_per_game: float | None
    three_pointers_made_per_game: float | None
    minutes_per_game: float | None


CareerGameType = Literal["regular", "playoffs"]


class SeasonLineOut(StatLineOut):
    """One season and game type the player played in. `teams` are
    abbreviations in the order first played; the stats are summed across
    them, as nba.com's "TOT" row is."""

    season: str
    game_type: CareerGameType
    teams: list[str]


class PlayerDetailOut(BaseModel):
    """GET /events/players/{id}: a read model built by
    app.events.service.player_detail. Only played rows of `regular` and
    `playoffs` games count towards a line."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str | None
    last_name: str | None
    birth_date: date | None
    height_inches: int | None
    weight_lbs: int | None
    country: str | None
    school: str | None
    jersey: str | None
    position: str | None
    draft_year: int | None
    draft_round: int | None
    draft_number: int | None
    first_season: str | None
    last_season: str | None
    career_regular: StatLineOut
    career_playoffs: StatLineOut
    # Newest season first.
    seasons: list[SeasonLineOut]


class PlayerGameOut(BaseModel):
    """One row of GET /events/players/{id}/games: the player's box-score
    line in one game, played or not, with the game around it. A row
    without minutes (`seconds_played` null) is a did-not-play."""

    model_config = ConfigDict(from_attributes=True)

    game_id: int
    date: datetime
    season: str
    game_type: str | None
    label: str | None
    team: TeamRefOut
    opponent: TeamRefOut
    is_home: bool
    team_score: int
    opponent_score: int
    starter: bool
    starting_position: str | None
    seconds_played: int | None
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
    plus_minus: int
    dnp_reason: str | None


# ------------------------------------------------------------------ seasons
# EVENTS-007: read models built in app.events.service, never the ORM rows.

LeaderStat = Literal["points", "rebounds", "assists", "steals", "blocks", "threes"]


class RecordOut(BaseModel):
    """A team's regular-season record (only `regular` games count: NBA Cup
    group and knockout games do; play-in, playoffs and the cup final do
    not), with home and away splits."""

    model_config = ConfigDict(from_attributes=True)

    wins: int
    losses: int
    home_wins: int
    home_losses: int
    away_wins: int
    away_losses: int


class StandingRowOut(RecordOut):
    """`win_pct` is wins / games, three places. `games_behind` is in half
    games behind the first team of the conference's order:
    ((leader_w - w) + (l - leader_l)) / 2."""

    team: TeamRefOut
    win_pct: float
    games_behind: float


class DivisionStandingsOut(BaseModel):
    """A division's teams, in their conference's order."""

    model_config = ConfigDict(from_attributes=True)

    division: str
    teams: list[StandingRowOut]


class ConferenceStandingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    conference: str
    divisions: list[DivisionStandingsOut]


class StandingsOut(BaseModel):
    """GET /events/seasons/{season}/standings. `tie_break` names the
    ordering rule: the NBA's own tie-breakers are not applied."""

    model_config = ConfigDict(from_attributes=True)

    season: str
    tie_break: str
    conferences: list[ConferenceStandingsOut]


class ChampionOut(BaseModel):
    """GET /events/seasons/{season}/champion. `result` is the Finals score,
    the champion's wins first ("4-2"). All three are null until a team has
    won four Finals games."""

    model_config = ConfigDict(from_attributes=True)

    season: str
    champion: TeamRefOut | None
    runner_up: TeamRefOut | None
    result: str | None


class LeaderOut(BaseModel):
    """`teams` are the abbreviations the player played for in the counted
    games; `average` is per game, one place."""

    model_config = ConfigDict(from_attributes=True)

    player_id: int
    first_name: str | None
    last_name: str | None
    teams: list[str]
    games_played: int
    average: float


class LeadersOut(BaseModel):
    """GET /events/seasons/{season}/leaders. `rule` names the qualifying
    rule applied and `minimum_games` its minimum (0 for the playoffs)."""

    model_config = ConfigDict(from_attributes=True)

    season: str
    stat: LeaderStat
    game_type: CareerGameType
    rule: str
    minimum_games: int
    leaders: list[LeaderOut]


class TeamSeasonGameOut(BaseModel):
    """One of the team's games, from its side: `team_score` is its own."""

    model_config = ConfigDict(from_attributes=True)

    game_id: int
    date: datetime
    game_type: str | None
    label: str | None
    sub_label: str | None
    opponent: TeamRefOut
    is_home: bool
    team_score: int
    opponent_score: int
    won: bool


class TeamSeasonOut(BaseModel):
    """GET /events/teams/{team_id}/seasons/{season}: the regular-season
    record and every game of every type, newest first."""

    model_config = ConfigDict(from_attributes=True)

    season: str
    team: TeamOut
    record: RecordOut
    games: list[TeamSeasonGameOut]
