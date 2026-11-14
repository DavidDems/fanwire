"""EVENTS-014: GET /events/seasons/{season}/schedule, a season's played and
upcoming games together. Spec: .ai/tasks/EVENTS-014/task.json. Written
before the route exists.

The data is the synthetic fixture (tests/fixtures/nba_data/) loaded with
load_nba_history; its schedule file is described in test_schedule_load.py.
Every expected item is built here from Games.csv and LeagueSchedule25_26.csv
read with the csv module (tests/events/schedule_support.py); only the
internal ids the load assigned (Team.id, Game.id) are read back from the
database.

Also pinned here: no existing route's response changes when a schedule
with unplayed games is loaded, and a scheduled game reaches a team's season
only once it has been played and loaded into games.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, select, text

from app.db import Base, make_session_factory
from app.events import nba_history
from app.events.models import Game, Player, Team
from tests.events.players_support import make_client, make_players_engine
from tests.events.schedule_support import (
    FIXTURE_DIR,
    GAMES_FILE,
    SCHEDULE_25_26,
    SCHEDULE_HEADER,
    STORED_TYPES,
    Expected,
    copy_fixture,
    expected_rows,
    read_csv,
    schedule_row,
    season_of,
    write_csv,
)
from tests.events.seasons_support import statements_for

SEASON = "2025-26"
BOS, NYK, DEN = 1610612738, 1610612752, 1610612743
ITEM_FIELDS = (
    "nba_game_id",
    "status",
    "game_id",
    "date",
    "time_tbd",
    "game_type",
    "label",
    "sub_label",
    "series_game_number",
    "venue",
    "home_team",
    "away_team",
    "home_score",
    "away_score",
)


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


def _load(session_factory, data_dir: Path = FIXTURE_DIR, seasons=None):
    with session_factory() as session:
        return nba_history.load_nba_history(session, data_dir, seasons)


@pytest.fixture()
def loaded(session_factory):
    _load(session_factory)


def _url(season: str = SEASON) -> str:
    return f"/events/seasons/{season}/schedule"


def _schedule(client, season: str = SEASON, **params) -> dict[str, Any]:
    response = client.get(_url(season), params=params)
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------- expected items


def _played_games(data_dir: Path, season: str) -> dict[int, dict[str, Any]]:
    """Games.csv's stored games of `season`, by the loader's documented rules
    (first row of a repeated id; prefixes 2/4/5/6; a final score that is
    not blank and not 0-0)."""
    played: dict[int, dict[str, Any]] = {}
    for row in read_csv(data_dir / GAMES_FILE)[1]:
        game_id = row["gameId"]
        if int(game_id) in played or season_of(game_id) != season:
            continue
        if game_id[0] not in STORED_TYPES or not row["homeScore"] or not row["awayScore"]:
            continue
        home_score, away_score = int(float(row["homeScore"])), int(float(row["awayScore"]))
        if home_score == 0 and away_score == 0:
            continue
        series = row["seriesGameNumber"].strip().removeprefix("Game ").strip()
        series_number = int(float(series)) if series else None
        played[int(game_id)] = {
            "nba_game_id": int(game_id),
            "date": datetime.strptime(row["gameDateTimeEst"], "%Y-%m-%d %H:%M:%S"),
            "time_tbd": False,
            "game_type": STORED_TYPES[game_id[0]],
            "label": row["gameLabel"].strip() or None,
            "sub_label": row["gameSubLabel"].strip() or None,
            "series_game_number": series_number or None,
            "venue": row["arenaName"].strip() or None,
            "home": int(row["hometeamId"]),
            "away": int(row["awayteamId"]),
            "home_score": home_score,
            "away_score": away_score,
        }
    return played


def _team_refs(session_factory) -> dict[int, dict[str, Any]]:
    with session_factory() as session:
        return {
            nba_id: {"id": team_id, "name": name, "abbreviation": abbreviation}
            for nba_id, team_id, name, abbreviation in session.execute(
                select(Team.nba_team_id, Team.id, Team.name, Team.abbreviation)
            )
        }


def _game_ids(session_factory) -> dict[int, int]:
    with session_factory() as session:
        return dict(session.execute(select(Game.nba_game_id, Game.id)).tuples().all())


def _expected_items(
    session_factory, season: str = SEASON, data_dir: Path = FIXTURE_DIR, schedule: str | None = None
) -> list[dict[str, Any]]:
    """The union, ordered by date then nba_game_id, in the response's JSON
    shape except `date` (a datetime, compared after parsing)."""
    teams = _team_refs(session_factory)
    game_ids = _game_ids(session_factory)
    items: dict[int, dict[str, Any]] = {}
    for nba_game_id, game in _played_games(data_dir, season).items():
        items[nba_game_id] = {
            "nba_game_id": nba_game_id,
            "status": "final",
            "game_id": game_ids[nba_game_id],
            "date": game["date"],
            "time_tbd": False,
            "game_type": game["game_type"],
            "label": game["label"],
            "sub_label": game["sub_label"],
            "series_game_number": game["series_game_number"],
            "venue": game["venue"],
            "home_team": teams[game["home"]],
            "away_team": teams[game["away"]],
            "home_score": game["home_score"],
            "away_score": game["away_score"],
        }
    schedule_name = schedule or f"LeagueSchedule{season[2:4]}_{season[5:7]}.csv"
    path = data_dir / schedule_name
    scheduled: dict[int, Expected] = expected_rows(read_csv(path)[1])[0] if path.is_file() else {}
    for nba_game_id, row in scheduled.items():
        if nba_game_id in items:
            continue  # played wins
        items[nba_game_id] = {
            "nba_game_id": nba_game_id,
            "status": "scheduled",
            "game_id": None,
            "date": row.date,
            "time_tbd": row.time_tbd,
            "game_type": row.game_type,
            "label": row.label,
            "sub_label": row.sub_label,
            "series_game_number": row.series_game_number,
            "venue": row.venue,
            "home_team": None if row.home_nba_team_id is None else teams[row.home_nba_team_id],
            "away_team": None if row.away_nba_team_id is None else teams[row.away_nba_team_id],
            "home_score": None,
            "away_score": None,
        }
    return sorted(items.values(), key=lambda item: (item["date"], item["nba_game_id"]))


def _comparable(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each response item's spec fields, its date parsed (naive)."""
    out = []
    for item in items:
        missing = [name for name in ITEM_FIELDS if name not in item]
        assert missing == [], f"item {item.get('nba_game_id')} lacks {missing}"
        picked = {name: item[name] for name in ITEM_FIELDS}
        picked["date"] = datetime.fromisoformat(picked["date"]).replace(tzinfo=None)
        out.append(picked)
    return out


def _team_id(session_factory, nba_team_id: int) -> int:
    with session_factory() as session:
        return session.scalar(select(Team.id).where(Team.nba_team_id == nba_team_id))


# --------------------------------------------------------------------- the union


def test_the_full_season_is_stored_games_and_unplayed_schedule_rows(
    client, session_factory, loaded
):
    body = _schedule(client)

    assert body["season"] == SEASON
    assert _comparable(body["games"]) == _expected_items(session_factory)


def test_a_game_in_both_is_listed_once_as_final_with_the_stored_games_fields(
    client, session_factory, loaded
):
    games = _comparable(_schedule(client)["games"])

    played = [item for item in games if item["nba_game_id"] == 22500001]
    assert len(played) == 1
    item = played[0]
    assert item["status"] == "final"
    assert item["game_id"] == _game_ids(session_factory)[22500001]
    assert (item["home_score"], item["away_score"]) == (124, 123)
    assert item["time_tbd"] is False
    # Games.csv leaves its arena blank; the schedule row says Scotiabank
    # Arena. The stored game is what happened.
    assert item["venue"] is None
    assert [i["nba_game_id"] for i in games].count(42500101) == 1


def test_a_scheduled_item_has_no_game_id_and_no_score(client, loaded):
    games = {item["nba_game_id"]: item for item in _schedule(client)["games"]}

    quarterfinal = games[22501201]
    assert quarterfinal["status"] == "scheduled"
    assert quarterfinal["game_id"] is None
    assert (quarterfinal["home_score"], quarterfinal["away_score"]) == (None, None)
    assert (quarterfinal["home_team"], quarterfinal["away_team"]) == (None, None)
    assert quarterfinal["time_tbd"] is True
    assert quarterfinal["venue"] is None
    assert quarterfinal["date"].startswith("2025-12-09T00:00")

    game_2 = games[42500102]
    assert game_2["status"] == "scheduled"
    assert game_2["series_game_number"] == 2
    assert game_2["home_team"]["abbreviation"] == "SAS"
    assert set(game_2["home_team"]) == {"id", "name", "abbreviation"}


def test_a_stored_game_without_a_schedule_row_is_listed(client, session_factory, tmp_path):
    data_dir = copy_fixture(tmp_path)
    path = data_dir / SCHEDULE_25_26
    header, rows = read_csv(path)
    write_csv(path, header, [row for row in rows if row["gameId"] != "42500101"])
    _load(session_factory, data_dir)

    games = _comparable(_schedule(client)["games"])

    assert games == _expected_items(session_factory, data_dir=data_dir)
    finals_1 = [item for item in games if item["nba_game_id"] == 42500101]
    assert len(finals_1) == 1 and finals_1[0]["status"] == "final"


def test_a_season_without_a_schedule_file_lists_its_stored_games(client, session_factory, loaded):
    games = _comparable(_schedule(client, "2024-25")["games"])

    assert games == _expected_items(session_factory, "2024-25")
    assert games and {item["status"] for item in games} == {"final"}


def test_a_season_with_only_schedule_rows_is_listed(client, session_factory, tmp_path):
    data_dir = copy_fixture(tmp_path)
    rows = [
        schedule_row("22600002", "2026-10-20 19:00:00", str(NYK), "1610612755"),
        schedule_row("22600001", "2026-10-20 15:00:00", "1610612765", str(BOS)),
    ]
    write_csv(data_dir / "LeagueSchedule26_27.csv", SCHEDULE_HEADER, rows)
    _load(session_factory, data_dir)

    body = _schedule(client, "2026-27")

    assert body["season"] == "2026-27"
    assert _comparable(body["games"]) == _expected_items(
        session_factory, "2026-27", data_dir=data_dir
    )
    assert [item["nba_game_id"] for item in body["games"]] == [22600001, 22600002]


def test_items_are_ordered_by_date_then_nba_game_id(client, loaded):
    games = _schedule(client)["games"]

    keys = [(datetime.fromisoformat(g["date"]), g["nba_game_id"]) for g in games]
    assert keys == sorted(keys)
    ids = [g["nba_game_id"] for g in games]
    # Same start: 22500004 (written after 22500005 in the file) comes first.
    assert ids.index(22500004) + 1 == ids.index(22500005)


# --------------------------------------------------------------------- filters


def test_team_filter_keeps_that_teams_home_and_away_games(client, session_factory, loaded):
    bos = _team_id(session_factory, BOS)

    games = _comparable(_schedule(client, team_id=bos)["games"])

    expected = [
        item
        for item in _expected_items(session_factory)
        if bos in {(item["home_team"] or {}).get("id"), (item["away_team"] or {}).get("id")}
    ]
    assert games == expected
    assert {g["nba_game_id"] for g in games} == {22500002, 22500004}


def test_date_filters_are_inclusive_eastern_calendar_dates(client, session_factory, loaded):
    one_day = _schedule(client, date_from="2025-11-03", date_to="2025-11-03")["games"]
    assert [g["nba_game_id"] for g in one_day] == [22500002, 22500003]

    # The midnight start is on its own calendar date, at both ends.
    assert [
        g["nba_game_id"]
        for g in _schedule(client, date_from="2025-12-09", date_to="2025-12-09")["games"]
    ] == [22501201]
    assert 22501201 not in {
        g["nba_game_id"] for g in _schedule(client, date_to="2025-12-08")["games"]
    }
    assert 22501201 in {
        g["nba_game_id"] for g in _schedule(client, date_from="2025-12-09")["games"]
    }

    expected = [
        item
        for item in _expected_items(session_factory)
        if date(2025, 11, 5) <= item["date"].date() <= date(2026, 4, 17)
    ]
    games = _schedule(client, date_from="2025-11-05", date_to="2026-04-17")["games"]
    assert _comparable(games) == expected


def test_filters_combine(client, session_factory, loaded):
    nyk = _team_id(session_factory, NYK)

    games = _schedule(client, team_id=nyk, date_from="2025-11-04", date_to="2026-06-04")["games"]

    assert [g["nba_game_id"] for g in games] == [22500004, 42500101]


def test_filters_that_match_nothing_are_an_empty_list(client, session_factory, loaded):
    assert _schedule(client, date_from="2025-07-01", date_to="2025-07-31") == {
        "season": SEASON,
        "games": [],
    }
    # A known team that has no game this season.
    den = _team_id(session_factory, DEN)
    assert _schedule(client, team_id=den)["games"] == []


# --------------------------------------------------------------------- errors


@pytest.mark.parametrize("season", ["2025", "2025-2026", "25-26", "abcd-ef", "2025_26"])
def test_a_malformed_season_is_a_422(client, loaded, season):
    assert client.get(_url(season)).status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"date_from": "2025-11-31"},
        {"date_to": "yesterday"},
        {"date_from": "2025-11-03", "date_to": "2025-11-02"},
        {"team_id": "bos"},
    ],
    ids=["impossible-date", "not-a-date", "from-after-to", "team-not-a-number"],
)
def test_a_malformed_filter_is_a_422(client, loaded, params):
    assert client.get(_url(), params=params).status_code == 422


@pytest.mark.parametrize("season", ["1999-00", "2030-31", "2023-24"])
def test_a_season_with_no_game_and_no_schedule_row_is_a_404(client, loaded, season):
    assert client.get(_url(season)).status_code == 404


def test_an_unknown_team_is_a_404(client, session_factory, loaded):
    with session_factory() as session:
        unknown = session.scalar(select(func.max(Team.id))) + 1000

    assert client.get(_url(), params={"team_id": unknown}).status_code == 404


def test_an_empty_database_is_a_404(client):
    assert client.get(_url()).status_code == 404


# --------------------------------------------------------------------- statements


def _big_schedule(tmp_path: Path) -> Path:
    """The fixture plus a 2026-27 file of 60 unplayed games."""
    data_dir = copy_fixture(tmp_path)
    teams = [str(t) for t in (BOS, NYK, DEN, 1610612761, 1610612747, 1610612744)]
    start = datetime(2026, 10, 20, 19, 0)
    rows = [
        schedule_row(
            f"2260{n:04d}",
            (start + timedelta(days=n // 3, hours=n % 3)).strftime("%Y-%m-%d %H:%M:%S"),
            teams[n % 6],
            teams[(n + 1) % 6],
        )
        for n in range(1, 61)
    ]
    write_csv(data_dir / "LeagueSchedule26_27.csv", SCHEDULE_HEADER, rows)
    return data_dir


def test_the_read_is_a_fixed_number_of_statements_without_box_scores(
    engine, client, session_factory, tmp_path
):
    _load(session_factory, _big_schedule(tmp_path))
    bos = _team_id(session_factory, BOS)

    calls = {
        "played only": statements_for(engine, client, _url("2024-25")),
        "both": statements_for(engine, client, _url()),
        "scheduled only, 60 games": statements_for(engine, client, _url("2026-27")),
        "team": statements_for(engine, client, _url("2026-27"), team_id=bos),
        "dates": statements_for(
            engine, client, _url("2026-27"), date_from="2026-10-21", date_to="2026-10-30"
        ),
        "team and dates": statements_for(
            engine, client, _url(), team_id=bos, date_from="2025-11-01", date_to="2025-11-30"
        ),
        "nothing matches": statements_for(
            engine, client, _url(), date_from="2025-07-01", date_to="2025-07-02"
        ),
    }

    counts = {name: len(statements) for name, statements in calls.items()}
    assert len(set(counts.values())) == 1, counts
    assert 1 <= counts["both"] <= 5, calls["both"]
    for name, statements in calls.items():
        assert not any("player_game_stats" in sql.lower() for sql in statements), name


# --------------------------------------------------------------------- existing routes


def _existing_responses(client, session_factory) -> dict[str, Any]:
    """Every existing events read the spec names, over every stored game,
    team, season and player."""
    with session_factory() as session:
        game_ids = sorted(session.scalars(select(Game.id)))
        seasons = sorted(set(session.scalars(select(Game.season))))
        team_ids = sorted(
            set(session.scalars(select(Game.home_team_id)))
            | set(session.scalars(select(Game.away_team_id)))
            | {session.scalar(select(Team.id).where(Team.nba_team_id == DEN))}
        )
        player_ids = sorted(session.scalars(select(Player.id)))
    urls = [
        "/events/games",
        "/events/games?limit=200",
        "/events/games/recent?limit=10",
        "/events/seasons",
        "/events/teams",
        "/events/records",
        *(f"/events/games?season={season}" for season in seasons),
        *(f"/events/games/{game_id}" for game_id in game_ids),
        *(f"/events/seasons/{season}/standings" for season in (*seasons, "2026-27")),
        *(f"/events/seasons/{season}/champion" for season in (*seasons, "2026-27")),
        *(
            f"/events/seasons/{season}/leaders?stat={stat}&game_type={kind}"
            for season in seasons
            for stat in ("points", "rebounds")
            for kind in ("regular", "playoffs")
        ),
        *(f"/events/seasons/{season}/leader-boards" for season in seasons),
        *(
            f"/events/teams/{team_id}/seasons/{season}"
            for team_id in team_ids
            for season in (*seasons, "2026-27")
        ),
        *(f"/events/players/{player_id}" for player_id in player_ids),
        *(f"/events/players/{player_id}/games" for player_id in player_ids),
    ]
    responses = {}
    for url in urls:
        response = client.get(url)
        responses[url] = (response.status_code, response.json())
    return responses


def test_no_existing_route_changes_when_a_schedule_is_loaded(
    engine, client, session_factory, tmp_path
):
    without = copy_fixture(tmp_path, "without")
    (without / SCHEDULE_25_26).unlink()
    _load(session_factory, without)
    before = _existing_responses(client, session_factory)

    _load(session_factory, _big_schedule(tmp_path))

    with engine.connect() as conn:
        unplayed = conn.execute(
            text(
                "SELECT count(*) FROM scheduled_games s "
                "WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.nba_game_id = s.nba_game_id)"
            )
        ).scalar()
    assert unplayed > 0, "the second load stored no unplayed schedule rows"
    assert _existing_responses(client, session_factory) == before


def test_a_scheduled_game_reaches_a_teams_season_only_once_played(
    client, session_factory, tmp_path
):
    _load(session_factory)
    bos = _team_id(session_factory, BOS)
    before = client.get(f"/events/teams/{bos}/seasons/{SEASON}")
    # BOS has no stored 2025-26 game yet: a 404 or no games, never 22500002.
    assert before.status_code in (200, 404)
    if before.status_code == 200:
        assert before.json()["games"] == []
    item = next(g for g in _schedule(client)["games"] if g["nba_game_id"] == 22500002)
    assert item["status"] == "scheduled"

    # 22500002 is played: Games.csv now has its result.
    data_dir = copy_fixture(tmp_path)
    header, rows = read_csv(data_dir / GAMES_FILE)
    source = next(row for row in rows if row["gameId"] == "22500001")
    rows.append(
        {
            **source,
            "gameId": "22500002",
            "gameDateTimeEst": "2025-11-03 19:00:00",
            "gameDate": "2025-11-03 19:00:00",
            "hometeamCity": "Boston",
            "hometeamName": "Celtics",
            "hometeamId": str(BOS),
            "awayteamCity": "New York",
            "awayteamName": "Knicks",
            "awayteamId": str(NYK),
            "homeScore": "110",
            "awayScore": "100",
            "winner": str(BOS),
            "arenaName": "TD Garden",
        }
    )
    write_csv(data_dir / GAMES_FILE, header, rows)
    _load(session_factory, data_dir)

    season = client.get(f"/events/teams/{bos}/seasons/{SEASON}")
    assert season.status_code == 200, season.text
    stored_id = _game_ids(session_factory)[22500002]
    assert [g["game_id"] for g in season.json()["games"]] == [stored_id]
    item = next(g for g in _schedule(client)["games"] if g["nba_game_id"] == 22500002)
    assert (item["status"], item["game_id"], item["home_score"]) == ("final", stored_id, 110)
