"""Tests for GET /events/seasons/{season}/standings (EVENTS-007). Spec:
.ai/tasks/EVENTS-007/.

Pinned contract (the response field names the spec leaves to the unit;
extra fields are tolerated everywhere):

- The response is an object with `season`, `tie_break` (a non-empty string
  naming the ordering rule, since the NBA's own tie-breakers are not
  applied) and `conferences`: a list of
  `{"conference": str, "divisions": [{"division": str, "teams": [row]}]}`.
  The order of conferences and of divisions is not pinned.
- A row has `team` (an object with at least `id`, `name`, `abbreviation`),
  `wins`, `losses`, `win_pct` (wins / games, a float to three places),
  `games_behind` (a float in half games, behind the leader of the team's
  conference: ((leader_w - w) + (l - leader_l)) / 2, the leader at 0),
  `home_wins`, `home_losses`, `away_wins`, `away_losses`.
- Teams in a division are listed in the conference order: win pct desc,
  then wins desc, then team name asc.
- Only `regular` games count. A team with no regular game that season is in
  no conference.
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import select

from app.db import Base, make_session_factory
from app.events import nba_history
from app.events.models import Team
from tests.events.players_support import make_client, make_players_engine
from tests.events.seasons_support import (
    Calendar,
    add_conference_team,
    add_result,
    statements_for,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "nba_data"


@pytest.fixture()
def engine(postgres_url):
    engine = make_players_engine(postgres_url)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def client(session_factory):
    return make_client(session_factory)


def _standings(client, season: str) -> dict:
    response = client.get(f"/events/seasons/{season}/standings")
    assert response.status_code == 200, response.text
    return response.json()


def _rows(body: dict) -> dict[str, dict]:
    """Every row by team abbreviation, with its conference and division."""
    rows = {}
    for conference in body["conferences"]:
        for division in conference["divisions"]:
            for row in division["teams"]:
                abbreviation = row["team"]["abbreviation"]
                assert abbreviation not in rows, f"{abbreviation} listed twice"
                rows[abbreviation] = {
                    **row,
                    "_conference": conference["conference"],
                    "_division": division["division"],
                }
    return rows


def _division(body: dict, conference: str, division: str) -> list[str]:
    for c in body["conferences"]:
        if c["conference"] == conference:
            for d in c["divisions"]:
                if d["division"] == division:
                    return [row["team"]["abbreviation"] for row in d["teams"]]
    raise AssertionError(f"no {conference}/{division} in {body}")


# 14 regular games in 2023-24 (home, away, home won). Hand-computed records:
#   BOS 5-1 .833 GB 0    home 3-0 away 2-1   (Eastern, Atlantic)
#   MIL 4-1 .800 GB 0.5  home 3-0 away 1-1   (Eastern, Central)
#   NYK 3-2 .600 GB 1.5  home 2-0 away 1-2   (Eastern, Atlantic)
#   CHI 1-3 .250 GB 3.0  home 1-0 away 0-3   (Eastern, Central)
#   LAL 1-3 .250 GB 0    home 1-2 away 0-1   (Western, Pacific)
#   GSW 0-4 .000 GB 1.0  home 0-2 away 0-2   (Western, Pacific)
REGULAR_GAMES = (
    ("BOS", "NYK", True),
    ("BOS", "MIL", True),
    ("BOS", "CHI", True),
    ("NYK", "BOS", True),
    ("LAL", "BOS", False),
    ("GSW", "BOS", False),
    ("NYK", "CHI", True),
    ("LAL", "NYK", False),
    ("MIL", "NYK", True),
    ("MIL", "CHI", True),
    ("GSW", "MIL", False),
    ("MIL", "LAL", True),
    ("CHI", "GSW", True),
    ("LAL", "GSW", True),
)

EXPECTED = {
    # abbreviation: (wins, losses, pct, gb, home_w, home_l, away_w, away_l)
    "BOS": (5, 1, 0.833, 0.0, 3, 0, 2, 1),
    "MIL": (4, 1, 0.8, 0.5, 3, 0, 1, 1),
    "NYK": (3, 2, 0.6, 1.5, 2, 0, 1, 2),
    "CHI": (1, 3, 0.25, 3.0, 1, 0, 0, 3),
    "LAL": (1, 3, 0.25, 0.0, 1, 2, 0, 1),
    "GSW": (0, 4, 0.0, 1.0, 0, 2, 0, 2),
}


@pytest.fixture()
def league(session_factory):
    """The 2023-24 games above, plus games that must not count: 2023-24
    play-in, playoffs and cup-final games (all won by CHI or GSW), a 2022-23
    regular game, and MIA, whose only 2023-24 game is a playoff game."""
    with session_factory() as session:
        teams = {
            abbreviation: add_conference_team(session, abbreviation, name, conference, division)
            for abbreviation, name, conference, division in (
                ("BOS", "Boston Celtics", "Eastern", "Atlantic"),
                ("NYK", "New York Knicks", "Eastern", "Atlantic"),
                ("MIL", "Milwaukee Bucks", "Eastern", "Central"),
                ("CHI", "Chicago Bulls", "Eastern", "Central"),
                ("MIA", "Miami Heat", "Eastern", "Southeast"),
                ("LAL", "Los Angeles Lakers", "Western", "Pacific"),
                ("GSW", "Golden State Warriors", "Western", "Pacific"),
            )
        }
        calendar = Calendar(date(2023, 10, 24))
        for home, away, home_won in REGULAR_GAMES:
            add_result(
                session,
                home=teams[home],
                away=teams[away],
                home_won=home_won,
                season="2023-24",
                when=calendar.next(),
            )
        for home, away, game_type, label in (
            ("CHI", "BOS", "play-in", "SoFi Play-In Tournament"),
            ("CHI", "BOS", "playoffs", "East - First Round"),
            ("GSW", "LAL", "playoffs", "West - First Round"),
            ("CHI", "MIL", "cup-final", "Emirates NBA Cup"),
            ("MIA", "BOS", "playoffs", "East - First Round"),
        ):
            add_result(
                session,
                home=teams[home],
                away=teams[away],
                home_won=True,
                season="2023-24",
                when=calendar.next(),
                game_type=game_type,
                label=label,
            )
        add_result(
            session,
            home=teams["GSW"],
            away=teams["BOS"],
            home_won=True,
            season="2022-23",
            when=date(2023, 1, 10),
        )
        session.commit()
        return {abbreviation: team.id for abbreviation, team in teams.items()}


# -------------------------------------------------------------------- shape


def test_standings_names_the_season_and_its_tie_break_rule(client, league):
    body = _standings(client, "2023-24")

    assert body["season"] == "2023-24"
    assert isinstance(body["tie_break"], str)
    assert body["tie_break"].strip()


def test_teams_are_grouped_by_conference_then_division(client, league):
    rows = _rows(_standings(client, "2023-24"))

    placed = {abbr: (row["_conference"], row["_division"]) for abbr, row in rows.items()}
    assert placed == {
        "BOS": ("Eastern", "Atlantic"),
        "NYK": ("Eastern", "Atlantic"),
        "MIL": ("Eastern", "Central"),
        "CHI": ("Eastern", "Central"),
        "LAL": ("Western", "Pacific"),
        "GSW": ("Western", "Pacific"),
    }


def test_a_row_names_its_team(client, league):
    rows = _rows(_standings(client, "2023-24"))

    team = rows["BOS"]["team"]
    assert team["id"] == league["BOS"]
    assert team["name"] == "Boston Celtics"
    assert team["abbreviation"] == "BOS"


# ------------------------------------------------------------------ records


def test_records_count_regular_games_only(client, league):
    """MIA (only a playoff game) is absent; the play-in, playoff and cup-final
    wins of CHI and GSW, and 2022-23's game, are in no record."""
    rows = _rows(_standings(client, "2023-24"))

    got = {
        abbr: (
            row["wins"],
            row["losses"],
            row["win_pct"],
            row["games_behind"],
            row["home_wins"],
            row["home_losses"],
            row["away_wins"],
            row["away_losses"],
        )
        for abbr, row in rows.items()
    }
    assert got == EXPECTED


def test_win_pct_is_rounded_to_three_places(client, session_factory):
    """2-1 is .667 and 1-2 is .333."""
    with session_factory() as session:
        one = add_conference_team(session, "PHX", "Phoenix Suns", "Western", "Pacific")
        two = add_conference_team(session, "SAC", "Sacramento Kings", "Western", "Pacific")
        calendar = Calendar(date(2021, 11, 1))
        for home_won in (True, True, False):
            add_result(
                session,
                home=one,
                away=two,
                home_won=home_won,
                season="2021-22",
                when=calendar.next(),
            )
        session.commit()

    rows = _rows(_standings(client, "2021-22"))

    assert rows["PHX"]["win_pct"] == 0.667
    assert rows["SAC"]["win_pct"] == 0.333
    assert rows["SAC"]["games_behind"] == 1.0


# ----------------------------------------------------------------- ordering


def test_division_order_is_pct_then_wins_then_name(client, session_factory):
    """In one division: Zeta 3-1 (.750); Alpha 2-2, Bravo 2-2 (.500, two
    wins, by name); Delta 1-1 (.500, one win). Their opponent is in the
    other conference."""
    with session_factory() as session:
        opponent = add_conference_team(session, "OPP", "Opponent Club", "Western", "Pacific")
        calendar = Calendar(date(2020, 12, 22))
        # Created out of the expected order so that insertion order proves nothing.
        for abbreviation, name, wins, losses in (
            ("DDD", "Delta Club", 1, 1),
            ("BBB", "Bravo Club", 2, 2),
            ("ZZZ", "Zeta Club", 3, 1),
            ("AAA", "Alpha Club", 2, 2),
        ):
            team = add_conference_team(session, abbreviation, name, "Eastern", "Atlantic")
            for won in [True] * wins + [False] * losses:
                add_result(
                    session,
                    home=team,
                    away=opponent,
                    home_won=won,
                    season="2020-21",
                    when=calendar.next(),
                )
        session.commit()

    body = _standings(client, "2020-21")

    assert _division(body, "Eastern", "Atlantic") == ["ZZZ", "AAA", "BBB", "DDD"]
    rows = _rows(body)
    # Zeta leads the conference: Alpha and Bravo are ((3-2)+(2-1))/2 = 1.0
    # behind, Delta ((3-1)+(1-1))/2 = 1.0.
    assert [rows[a]["games_behind"] for a in ("ZZZ", "AAA", "BBB", "DDD")] == [0.0, 1.0, 1.0, 1.0]


def test_division_lists_follow_the_conference_order(client, league):
    body = _standings(client, "2023-24")

    assert _division(body, "Eastern", "Atlantic") == ["BOS", "NYK"]
    assert _division(body, "Eastern", "Central") == ["MIL", "CHI"]
    assert _division(body, "Western", "Pacific") == ["LAL", "GSW"]


# ---------------------------------------------------- against the fixture


def _expected_from_games_csv(season: str) -> dict[int, tuple[int, int]]:
    """W-L per nba.com team id, read straight from the fixture's Games.csv,
    with the loader's storage rules: the first row of a repeated game id is
    kept; preseason (id prefix 1) and All-Star (3) games are skipped, as is a
    game without a final score (blank, or 0-0). Only regular games (prefix 2)
    count. The season is digits 2-3 of the game id."""
    seen: set[str] = set()
    records: dict[int, list[int]] = {}
    with (FIXTURE_DIR / "Games.csv").open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            game_id = row["gameId"]
            if game_id in seen:
                continue
            seen.add(game_id)
            start = 2000 + int(game_id[1:3])
            if f"{start}-{str(start + 1)[-2:]}" != season or game_id[0] != "2":
                continue
            if not row["homeScore"] or not row["awayScore"]:
                continue
            home_score, away_score = int(float(row["homeScore"])), int(float(row["awayScore"]))
            if home_score == 0 and away_score == 0:
                continue
            home, away = int(row["hometeamId"]), int(row["awayteamId"])
            winner, loser = (home, away) if home_score > away_score else (away, home)
            records.setdefault(winner, [0, 0])[0] += 1
            records.setdefault(loser, [0, 0])[1] += 1
    return {team: (w, l) for team, (w, l) in records.items()}


@pytest.mark.parametrize("season", ["2024-25", "2025-26"])
def test_fixture_records_match_games_csv(client, session_factory, season):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)
        nba_ids = dict(session.execute(select(Team.id, Team.nba_team_id)).tuples().all())
    expected = _expected_from_games_csv(season)
    assert expected  # the fixture has regular games in both seasons

    rows = _rows(_standings(client, season))

    got = {nba_ids[row["team"]["id"]]: (row["wins"], row["losses"]) for row in rows.values()}
    assert got == expected


# ------------------------------------------------------------------ queries


def _league_of_size(session_factory, season: str, start: date, games: int) -> None:
    with session_factory() as session:
        teams = [
            add_conference_team(session, f"{season[2:4]}{n}", f"Club {season} {n}", conf, div)
            for n, (conf, div) in enumerate(
                [("Eastern", "Atlantic"), ("Eastern", "Central"), ("Western", "Pacific")] * 2
            )
        ]
        calendar = Calendar(start)
        for n in range(games):
            add_result(
                session,
                home=teams[n % len(teams)],
                away=teams[(n + 1) % len(teams)],
                home_won=n % 3 != 0,
                season=season,
                when=calendar.next(),
            )
        session.commit()


def test_standings_is_a_fixed_number_of_grouped_queries(engine, client, session_factory):
    _league_of_size(session_factory, "2021-22", date(2021, 10, 20), games=1)
    _league_of_size(session_factory, "2022-23", date(2022, 10, 20), games=40)

    small = statements_for(engine, client, "/events/seasons/2021-22/standings")
    large = statements_for(engine, client, "/events/seasons/2022-23/standings")

    assert len(large) == len(small), (small, large)
    assert 1 <= len(large) <= 6, large
    assert any("GROUP BY" in statement.upper() for statement in large), large
