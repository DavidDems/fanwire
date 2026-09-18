"""Dev fixture data for `backend-dev` (docker-compose.yml), NOT the real
seed-loader.

The Kaggle NBA dataset (wiki/CodeContext/Modules/0x02-events.md) still
isn't downloaded/ingested anywhere in this repo, so this script has
nothing to do with `app.events.ingestion`. It exists purely so a developer
running `backend-dev` and the Vite frontend against it has a handful of
real `Team`/`Game` rows in Postgres to filter/mention/click through in the
browser — a fixture, not a data pipeline. Replace/remove once the real
ingestion path lands and can populate a dev database itself.

Idempotent: safe to run every time the `backend-dev` container starts, or
by hand any number of times. Uses only the `Team`/`Game` ORM models'
public constructors (`app.events.models`) — no raw SQL, no `Base.metadata`
poking.

Usage (inside the backend-dev container, or locally with DATABASE_URL set
to point at the compose Postgres):
    python scripts/seed_dev.py
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.db import make_engine, make_session_factory
from app.events.models import Game, Team
from app.settings import Settings

# A handful of real NBA teams/abbreviations — just enough variety for the
# frontend to have something to filter/search/mention against. Not the
# full 30-team league, not sourced from the Kaggle dataset.
_TEAMS = [
    {
        "api_sports_team_id": 1,
        "name": "Toronto Raptors",
        "abbreviation": "TOR",
        "conference": "Eastern",
        "division": "Atlantic",
        "logo_url": None,
    },
    {
        "api_sports_team_id": 2,
        "name": "Boston Celtics",
        "abbreviation": "BOS",
        "conference": "Eastern",
        "division": "Atlantic",
        "logo_url": None,
    },
    {
        "api_sports_team_id": 3,
        "name": "Los Angeles Lakers",
        "abbreviation": "LAL",
        "conference": "Western",
        "division": "Pacific",
        "logo_url": None,
    },
    {
        "api_sports_team_id": 4,
        "name": "Golden State Warriors",
        "abbreviation": "GSW",
        "conference": "Western",
        "division": "Pacific",
        "logo_url": None,
    },
]

# Games reference teams by their api_sports_team_id above, resolved to the
# real (possibly pre-existing) Team.id after teams are seeded.
_GAMES = [
    {
        "api_sports_game_id": 1001,
        "home_api_sports_team_id": 1,
        "away_api_sports_team_id": 2,
        "date": datetime(2025, 11, 1, 19, 30, tzinfo=timezone.utc),
        "season": "2025-26",
        "home_score": 108,
        "away_score": 102,
        "venue": "Scotiabank Arena",
    },
    {
        "api_sports_game_id": 1002,
        "home_api_sports_team_id": 3,
        "away_api_sports_team_id": 4,
        "date": datetime(2025, 11, 3, 22, 0, tzinfo=timezone.utc),
        "season": "2025-26",
        "home_score": 115,
        "away_score": 120,
        "venue": "Crypto.com Arena",
    },
    {
        "api_sports_game_id": 1003,
        "home_api_sports_team_id": 2,
        "away_api_sports_team_id": 3,
        "date": datetime(2025, 11, 6, 20, 0, tzinfo=timezone.utc),
        "season": "2025-26",
        "home_score": 99,
        "away_score": 104,
        "venue": "TD Garden",
    },
]


def seed() -> None:
    engine = make_engine(Settings().database_url)
    session_factory = make_session_factory(engine)

    with session_factory() as session:
        team_id_by_api_id: dict[int, int] = {}

        for team_data in _TEAMS:
            existing = session.scalar(
                select(Team).where(Team.api_sports_team_id == team_data["api_sports_team_id"])
            )
            if existing is not None:
                team_id_by_api_id[team_data["api_sports_team_id"]] = existing.id
                continue

            team = Team(**team_data)
            session.add(team)
            session.flush()  # populate team.id for the games below
            team_id_by_api_id[team_data["api_sports_team_id"]] = team.id

        for game_data in _GAMES:
            existing = session.scalar(
                select(Game).where(Game.api_sports_game_id == game_data["api_sports_game_id"])
            )
            if existing is not None:
                continue

            session.add(
                Game(
                    api_sports_game_id=game_data["api_sports_game_id"],
                    home_team_id=team_id_by_api_id[game_data["home_api_sports_team_id"]],
                    away_team_id=team_id_by_api_id[game_data["away_api_sports_team_id"]],
                    date=game_data["date"],
                    season=game_data["season"],
                    home_score=game_data["home_score"],
                    away_score=game_data["away_score"],
                    venue=game_data["venue"],
                )
            )

        session.commit()

    print(f"Seeded {len(_TEAMS)} teams and {len(_GAMES)} games (idempotent).")


if __name__ == "__main__":
    seed()
