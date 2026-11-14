"""Shared builders for EVENTS-007's season tests (test_seasons.py,
test_standings.py, test_champion.py, test_leaders.py, test_team_season.py).

Plain functions, as in players_support.py, which this module builds on.
`add_team` there puts every team in East/Central; standings need real
conferences and divisions, so `add_conference_team` sets them.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.events.models import Game, Player, Team
from tests.events.players_support import add_game, add_line, add_team, recorded_statements

STATS: tuple[str, ...] = ("points", "rebounds", "assists", "steals", "blocks", "threes")
# The box-score column behind each `stat` value; threes are three-pointers made.
STAT_COLUMNS: dict[str, str] = {
    "points": "points",
    "rebounds": "rebounds",
    "assists": "assists",
    "steals": "steals",
    "blocks": "blocks",
    "threes": "three_pointers_made",
}

SEASON_ROUTES: tuple[str, ...] = (
    "/events/seasons/{season}/standings",
    "/events/seasons/{season}/champion",
    "/events/seasons/{season}/leaders",
)


def add_conference_team(
    session: Session, abbreviation: str, name: str, conference: str, division: str
) -> Team:
    team = add_team(session, abbreviation, name)
    team.conference = conference
    team.division = division
    session.flush()
    return team


class Calendar:
    """Hands out distinct, increasing game dates from a start day."""

    def __init__(self, start: date) -> None:
        self._next = datetime.combine(start, time(19, 30))

    def next(self) -> datetime:
        when = self._next
        self._next = when + timedelta(days=1)
        return when


def add_result(
    session: Session,
    *,
    home: Team,
    away: Team,
    home_won: bool,
    season: str,
    when: datetime | date,
    game_type: str = "regular",
    label: str | None = None,
) -> Game:
    """A game the home team won 100-90, or lost 90-100."""
    return add_game(
        session,
        home=home,
        away=away,
        when=when,
        season=season,
        game_type=game_type,
        home_score=100 if home_won else 90,
        away_score=90 if home_won else 100,
        label=label,
    )


def add_games(
    session: Session,
    *,
    team: Team,
    opponent: Team,
    season: str,
    count: int,
    calendar: Calendar,
    game_type: str = "regular",
) -> list[Game]:
    """`count` games of `team` against `opponent`, alternating home and away."""
    return [
        add_result(
            session,
            home=team if n % 2 == 0 else opponent,
            away=opponent if n % 2 == 0 else team,
            home_won=True,
            season=season,
            when=calendar.next(),
            game_type=game_type,
        )
        for n in range(count)
    ]


def add_lines(
    session: Session, *, games: list[Game], team: Team, player: Player, **stats: Any
) -> None:
    """One played line per game for `player` on `team`, the same stats each."""
    for game in games:
        add_line(session, game=game, team=team, player=player, **stats)


def statements_for(engine: Engine, client: TestClient, url: str, **params: Any) -> list[str]:
    """The SQL statements one call sends, after a warm-up call (connection
    setup is not the route's)."""
    warm_up = client.get(url, params=params)
    assert warm_up.status_code == 200, warm_up.text
    with recorded_statements(engine) as statements:
        response = client.get(url, params=params)
    assert response.status_code == 200, response.text
    return statements
