"""Shared fixtures-as-functions for EVENTS-006's player tests
(test_players.py, test_player_detail.py, test_player_games.py).

Plain functions, not pytest fixtures, so the test modules import them
without tripping ruff's unused-import rule; each module keeps its own
engine/session/client fixtures, as the sibling events tests do.

The schema is built with `Base.metadata.create_all`, which does not run
migrations, so `make_players_engine` creates the `unaccent` extension the
EVENTS-006 migration adds (tests/test_migrations_unaccent.py pins that the
migration itself installs it).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, time
from itertools import count
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base, make_engine
from app.dependencies import get_session
from app.events.models import Game, Player, PlayerGameStats, Team
from app.events.routes import router

COUNTING_STATS: tuple[str, ...] = (
    "field_goals_made",
    "field_goals_attempted",
    "three_pointers_made",
    "three_pointers_attempted",
    "free_throws_made",
    "free_throws_attempted",
    "offensive_rebounds",
    "defensive_rebounds",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "personal_fouls",
    "points",
)
PERCENTAGES: tuple[str, ...] = ("field_goal_pct", "three_point_pct", "free_throw_pct")
AVERAGES: tuple[str, ...] = (
    "points_per_game",
    "rebounds_per_game",
    "assists_per_game",
    "steals_per_game",
    "blocks_per_game",
    "turnovers_per_game",
    "three_pointers_made_per_game",
    "minutes_per_game",
)

_person_ids = count(1_000_000)
_game_ids = count(22_000_001)
_team_ids = count(1_610_612_700)


def make_players_engine(postgres_url: str) -> Engine:
    engine = make_engine(postgres_url)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
    Base.metadata.create_all(engine)
    return engine


def make_client(session_factory: sessionmaker[Session]) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    def _get_session_override() -> Iterator[Session]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    return TestClient(app)


def add_team(session: Session, abbreviation: str, name: str | None = None) -> Team:
    team = Team(
        nba_team_id=next(_team_ids),
        name=name or f"{abbreviation} Team",
        abbreviation=abbreviation,
        conference="East",
        division="Central",
    )
    session.add(team)
    session.flush()
    return team


def add_player(
    session: Session, first_name: str | None, last_name: str | None, **attrs: Any
) -> Player:
    player = Player(
        nba_person_id=next(_person_ids), first_name=first_name, last_name=last_name, **attrs
    )
    session.add(player)
    session.flush()
    return player


def add_game(
    session: Session,
    *,
    home: Team,
    away: Team,
    when: datetime | date,
    season: str,
    game_type: str = "regular",
    home_score: int = 100,
    away_score: int = 90,
    label: str | None = None,
) -> Game:
    if not isinstance(when, datetime):
        when = datetime.combine(when, time(19, 30))
    game = Game(
        nba_game_id=next(_game_ids),
        home_team_id=home.id,
        away_team_id=away.id,
        date=when,
        season=season,
        home_score=home_score,
        away_score=away_score,
        game_type=game_type,
        label=label,
    )
    session.add(game)
    session.flush()
    return game


def add_line(
    session: Session, *, game: Game, team: Team, player: Player, **overrides: Any
) -> PlayerGameStats:
    """A played bench line of zeros, 10 minutes, unless overridden. Pass
    `seconds_played=None` for a did-not-play row."""
    values: dict[str, Any] = {stat: 0 for stat in COUNTING_STATS}
    values.update(
        {
            "game_id": game.id,
            "team_id": team.id,
            "player_id": player.id,
            "starter": False,
            "starting_position": None,
            "seconds_played": 600,
            "plus_minus": 0,
            "dnp_reason": None,
        }
    )
    values.update(overrides)
    line = PlayerGameStats(**values)
    session.add(line)
    session.flush()
    return line


@contextmanager
def recorded_statements(engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement sent to the database inside the block."""
    statements: list[str] = []

    def _record(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _record)


def add_long_career(session: Session, player: Player, teams: list[Team], opponent: Team) -> int:
    """45 played games and 5 DNPs over five seasons, regular and playoffs,
    split across `teams`. Returns the number of rows written."""
    rows = 0
    for season_index in range(5):
        start = 2015 + season_index
        season = f"{start}-{str(start + 1)[-2:]}"
        for n in range(10):
            game_type = "playoffs" if n >= 8 else "regular"
            month = 4 if game_type == "playoffs" else 11
            team = teams[(season_index + (n >= 5)) % len(teams)]
            game = add_game(
                session,
                home=team if n % 2 else opponent,
                away=opponent if n % 2 else team,
                when=date(start + (month == 4), month, n + 1),
                season=season,
                game_type=game_type,
            )
            dnp = n == 3
            add_line(
                session,
                game=game,
                team=team,
                player=player,
                seconds_played=None if dnp else 1500 + n,
                dnp_reason="DNP - Coach's Decision" if dnp else None,
                points=0 if dnp else 10 + n,
                field_goals_made=0 if dnp else 4,
                field_goals_attempted=0 if dnp else 9,
            )
            rows += 1
    return rows
