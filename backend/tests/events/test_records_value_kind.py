"""EVENTS-011: what kind of value a record holds, and the figures behind it.
Spec: .ai/tasks/EVENTS-011/.

Pinned contract:

- `RecordDefinition.value_kind` is one of count, win_loss, made_total,
  shot_pct, average, and has no default: a record cannot be registered
  without one. Both records routes return it on each record.
- `team-best-season` and `team-worst-season` are win_loss with unit
  "record"; `player-threes-game` is made_total. EVENTS-012 frees the other
  ten of EVENTS-010's twelve to any kind; each still names one.
- Every entry and holder carries `wins`, `losses`, `made`, `attempted`
  (integers or null) and `pct` (a number or null). win_loss sets wins,
  losses and pct; made_total sets made, attempted and pct (null when
  nothing was attempted); a count sets none. `value` keeps its meaning: a
  season's win percentage, a line's threes made.
- EVENTS-012: shot_pct sets made, attempted and pct, `value` being the pct;
  an average sets neither wins nor losses. The catalog (GET /events/records)
  carries each record's value_kind; holders come from
  GET /events/records/holders.

Expected percentages are rounded here, in Python, to three places (the rule
of service._pct), never by calling app code.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import pytest

from app.db import Base, make_session_factory
from app.events.models import PlayerGameStats
from app.events.records import RECORDS, RECORDS_BY_ID, RecordDefinition
from app.main import app
from tests.events.players_support import (
    COUNTING_STATS,
    add_game,
    add_player,
    add_team,
    make_client,
    make_players_engine,
)
from tests.events.records_library import LIBRARY_IDS
from tests.events.records_support import RECORD_IDS, build_fixture, rebuild_totals

VALUE_KINDS = frozenset({"count", "win_loss", "made_total", "shot_pct", "average"})
NEW_FIELDS = ("wins", "losses", "made", "attempted", "pct")
# The kinds EVENTS-011 settled that EVENTS-012 keeps.
EXPECTED_KINDS: dict[str, str] = {
    "team-best-season": "win_loss",
    "team-worst-season": "win_loss",
    "player-threes-game": "made_total",
}
# The fields each kind fills; every other new field is null. An average's
# figures are not pinned beyond wins and losses being null.
USED_FIELDS: dict[str, frozenset[str]] = {
    "count": frozenset(),
    "win_loss": frozenset({"wins", "losses", "pct"}),
    "made_total": frozenset({"made", "attempted", "pct"}),
    "shot_pct": frozenset({"made", "attempted", "pct"}),
    "average": frozenset({"made", "attempted", "pct"}),
}
CACHE_CONTROL = "public, max-age=300"


# ------------------------------------------------------------ the registry


def test_every_record_names_a_known_value_kind():
    kinds = {record.id: record.value_kind for record in RECORDS}

    assert set(kinds.values()) <= VALUE_KINDS, kinds
    assert set(RECORD_IDS) <= set(kinds)
    assert {i: kinds[i] for i in EXPECTED_KINDS} == EXPECTED_KINDS


@pytest.mark.parametrize("record_id", ["team-best-season", "team-worst-season"])
def test_season_records_are_win_loss_with_unit_record(record_id):
    record = RECORDS_BY_ID[record_id]

    assert record.value_kind == "win_loss"
    assert record.unit == "record"


def test_the_threes_record_is_a_made_total():
    assert RECORDS_BY_ID["player-threes-game"].value_kind == "made_total"


def _definition(**overrides: Any) -> RecordDefinition:
    template = RECORDS_BY_ID["team-championships"]
    fields: dict[str, Any] = {
        "id": "team-test",
        "group": "team",
        "title": "A test record",
        "unit": "titles",
        "rule": "A rule.",
        "candidates": template.candidates,
        **overrides,
    }
    return RecordDefinition(**fields)


def test_a_record_cannot_be_registered_without_a_value_kind():
    with pytest.raises(TypeError):
        _definition()


def test_a_record_registers_with_a_value_kind():
    definition = _definition(value_kind="count")

    assert definition.value_kind == "count"


# ----------------------------------------------------------------- OpenAPI


@pytest.fixture(scope="module")
def schemas() -> dict[str, Any]:
    return app.openapi()["components"]["schemas"]


def _kind_enum(schema: dict[str, Any], schemas: dict[str, Any]) -> set[str]:
    prop = schema["properties"]["value_kind"]
    if "$ref" in prop:
        prop = schemas[prop["$ref"].rsplit("/", 1)[-1]]
    return set(prop["enum"])


def _resolve(schema: dict[str, Any], schemas: dict[str, Any]) -> dict[str, Any]:
    if "$ref" in schema:
        return schemas[schema["$ref"].rsplit("/", 1)[-1]]
    return schema


def _catalog_record_schema(schemas: dict[str, Any]) -> dict[str, Any]:
    """The schema of one record of GET /events/records, through its 200."""
    operation = app.openapi()["paths"]["/events/records"]["get"]
    body = _resolve(operation["responses"]["200"]["content"]["application/json"]["schema"], schemas)
    return _resolve(body["properties"]["records"]["items"], schemas)


def test_the_catalog_and_list_models_require_a_value_kind_of_the_five(schemas):
    for schema in (_catalog_record_schema(schemas), schemas["RecordListOut"]):
        assert "value_kind" in schema.get("required", []), schema
        assert _kind_enum(schema, schemas) == VALUE_KINDS


def _nullable_types(prop: dict[str, Any]) -> set[str]:
    return {option.get("type", "") for option in prop.get("anyOf", [prop])}


@pytest.mark.parametrize("name", ["RecordEntryOut", "RecordHolderOut"])
def test_entries_and_holders_carry_the_nullable_figures(schemas, name):
    properties = schemas[name]["properties"]

    for field in ("wins", "losses", "made", "attempted"):
        assert _nullable_types(properties[field]) == {"integer", "null"}, (name, field)
    assert _nullable_types(properties["pct"]) == {"number", "null"}, name


# ------------------------------------------------------------ the routes


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


def _catalog(client) -> dict:
    response = client.get("/events/records")
    assert response.status_code == 200, response.text
    assert response.headers.get("cache-control") == CACHE_CONTROL
    return response.json()


def _kinds(client) -> dict[str, str]:
    return {r["id"]: r["value_kind"] for r in _catalog(client)["records"]}


def _list(client, record_id: str, **params) -> dict:
    response = client.get(f"/events/records/{record_id}", params=params)
    assert response.status_code == 200, response.text
    assert response.headers.get("cache-control") == CACHE_CONTROL
    return response.json()


def _holder(client, record_id: str) -> dict:
    response = client.get("/events/records/holders", params={"ids": record_id})
    assert response.status_code == 200, response.text
    assert response.headers.get("cache-control") == CACHE_CONTROL
    holder = response.json()["holders"][record_id]
    assert holder is not None, record_id
    return holder


def test_both_routes_return_each_records_value_kind(client):
    kinds = _kinds(client)

    assert kinds == {record.id: record.value_kind for record in RECORDS}
    assert {i: kinds[i] for i in EXPECTED_KINDS} == EXPECTED_KINDS
    for record_id in RECORD_IDS:
        assert _list(client, record_id)["value_kind"] == kinds[record_id], record_id


def test_both_routes_give_the_season_records_unit_record(client):
    summary = {r["id"]: r for r in _catalog(client)["records"]}

    for record_id in ("team-best-season", "team-worst-season"):
        assert summary[record_id]["unit"] == "record"
        assert _list(client, record_id)["unit"] == "record"


# --------------------------------------------- a 73-9 season and a 12 of 21


@dataclass
class ShapesFixture:
    best: int  # 73-9, then the champion
    worst: int  # 9-73
    sharpshooter: int  # 12 of 21 threes
    steady: int  # 5 of 10
    no_attempts: int  # 0 of 0


def _shooting_line(session, *, game, team, player, made: int, attempted: int) -> None:
    values = {stat: 0 for stat in COUNTING_STATS}
    values.update(points=3 * made, three_pointers_made=made, three_pointers_attempted=attempted)
    session.add(
        PlayerGameStats(
            game_id=game.id,
            team_id=team.id,
            player_id=player.id,
            starter=False,
            starting_position=None,
            seconds_played=1800,
            plus_minus=0,
            dnp_reason=None,
            **values,
        )
    )


def _build_shapes(session) -> ShapesFixture:
    best, worst = add_team(session, "GSW"), add_team(session, "PHI")
    when = datetime(2015, 10, 27, 19, 30)
    games = []
    for n in range(82):
        best_wins = n < 73
        home, away = (best, worst) if n % 2 == 0 else (worst, best)
        best_score, worst_score = (110, 100) if best_wins else (95, 105)
        home_score, away_score = (
            (best_score, worst_score) if home is best else (worst_score, best_score)
        )
        games.append(
            add_game(
                session,
                home=home,
                away=away,
                when=when + timedelta(days=n),
                season="2015-16",
                home_score=home_score,
                away_score=away_score,
            )
        )
    for n in range(4):
        add_game(
            session,
            home=best,
            away=worst,
            when=when + timedelta(days=100 + n),
            season="2015-16",
            game_type="playoffs",
            label="NBA Finals",
            home_score=110,
            away_score=100,
        )
    sharpshooter = add_player(session, "Stephen", "Shooter")
    steady = add_player(session, "Steady", "Hand")
    no_attempts = add_player(session, "Never", "Shoots")
    game = games[0]
    _shooting_line(session, game=game, team=best, player=sharpshooter, made=12, attempted=21)
    _shooting_line(session, game=game, team=best, player=steady, made=5, attempted=10)
    _shooting_line(session, game=game, team=worst, player=no_attempts, made=0, attempted=0)
    session.flush()
    rebuild_totals(session)
    return ShapesFixture(
        best=best.id,
        worst=worst.id,
        sharpshooter=sharpshooter.id,
        steady=steady.id,
        no_attempts=no_attempts.id,
    )


@pytest.fixture()
def shapes(session_factory) -> ShapesFixture:
    with session_factory() as session:
        fx = _build_shapes(session)
        session.commit()
    return fx


def _figures(entry: dict) -> dict[str, Any]:
    return {field: entry[field] for field in NEW_FIELDS}


SEASON_73_9 = {"wins": 73, "losses": 9, "made": None, "attempted": None, "pct": 0.89}
SEASON_9_73 = {"wins": 9, "losses": 73, "made": None, "attempted": None, "pct": round(9 / 82, 3)}


def test_a_73_9_season_holds_the_best_season_on_both_routes(client, shapes):
    holder = _holder(client, "team-best-season")
    (first, second) = _list(client, "team-best-season")["entries"]

    for entry in (holder, first):
        assert entry["team"]["id"] == shapes.best
        assert _figures(entry) == SEASON_73_9
        # value keeps its meaning: the win percentage.
        assert entry["value"] == 0.89
    assert second["team"]["id"] == shapes.worst
    assert _figures(second) == SEASON_9_73


def test_a_73_9_season_reads_the_same_on_the_worst_season_list(client, shapes):
    holder = _holder(client, "team-worst-season")
    (first, second) = _list(client, "team-worst-season")["entries"]

    for entry in (holder, first):
        assert entry["team"]["id"] == shapes.worst
        assert _figures(entry) == SEASON_9_73
        assert entry["value"] == round(9 / 82, 3)
    assert second["team"]["id"] == shapes.best
    assert _figures(second) == SEASON_73_9
    assert second["value"] == 0.89


def test_a_threes_entry_carries_made_attempted_and_pct_from_the_same_line(client, shapes):
    holder = _holder(client, "player-threes-game")
    entries = _list(client, "player-threes-game")["entries"]
    by_player = {entry["player"]["id"]: entry for entry in entries}

    assert holder["player"]["id"] == shapes.sharpshooter
    for entry in (holder, by_player[shapes.sharpshooter]):
        assert entry["value"] == 12
        assert _figures(entry) == {
            "wins": None,
            "losses": None,
            "made": 12,
            "attempted": 21,
            "pct": round(12 / 21, 3),
        }
    assert _figures(by_player[shapes.steady]) == {
        "wins": None,
        "losses": None,
        "made": 5,
        "attempted": 10,
        "pct": 0.5,
    }


def test_a_threes_entry_with_no_attempts_has_a_null_pct(client, shapes):
    entries = _list(client, "player-threes-game")["entries"]
    (entry,) = [e for e in entries if e["player"]["id"] == shapes.no_attempts]

    assert entry["value"] == 0
    assert _figures(entry) == {
        "wins": None,
        "losses": None,
        "made": 0,
        "attempted": 0,
        "pct": None,
    }


@pytest.mark.parametrize(
    "record_id", ["team-most-points-game", "team-championships", "player-points-game"]
)
def test_a_count_record_leaves_every_new_figure_null(client, shapes, record_id):
    holder = _holder(client, record_id)
    entries = _list(client, record_id)["entries"]

    for entry in (holder, *entries):
        assert _figures(entry) == dict.fromkeys(NEW_FIELDS), (record_id, entry)


# ------------------------------------- every record, on EVENTS-010's fixture


@pytest.fixture()
def fixture(session_factory):
    with session_factory() as session:
        fx = build_fixture(session)
        session.commit()
    return fx


def _check_shape(record_id: str, kind: str, entry: dict) -> None:
    used = USED_FIELDS[kind]
    assert set(NEW_FIELDS) <= set(entry), entry
    for field in NEW_FIELDS:
        if field not in used:
            assert entry[field] is None, (record_id, field, entry)
    if kind == "win_loss":
        wins, losses = entry["wins"], entry["losses"]
        assert isinstance(wins, int) and isinstance(losses, int), entry
        assert entry["pct"] == round(wins / (wins + losses), 3) == entry["value"], entry
    if kind == "made_total":
        made, attempted = entry["made"], entry["attempted"]
        assert isinstance(made, int) and isinstance(attempted, int), entry
        assert made == entry["value"], entry
        expected_pct = round(made / attempted, 3) if attempted else None
        assert entry["pct"] == expected_pct, entry
    if kind == "shot_pct":
        made, attempted = entry["made"], entry["attempted"]
        assert isinstance(made, int) and isinstance(attempted, int) and attempted > 0, entry
        assert entry["pct"] == round(made / attempted, 3) == entry["value"], entry


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_every_entry_and_holder_fills_exactly_its_kinds_figures(client, fixture, record_id):
    kind = _kinds(client)[record_id]
    holder = _holder(client, record_id)
    entries = _list(client, record_id, limit=100)["entries"]
    assert entries

    for entry in (holder, *entries):
        _check_shape(record_id, kind, entry)


@pytest.mark.parametrize("record_id", LIBRARY_IDS)
def test_every_library_list_answers_and_fills_its_kinds_figures(client, fixture, record_id):
    """EVENTS-012: every id of the brief is a list the route answers, on
    EVENTS-010's fixture, and its holder is the list's first entry."""
    kind = _kinds(client)[record_id]
    body = _list(client, record_id, limit=100)
    response = client.get("/events/records/holders", params={"ids": record_id})
    assert response.status_code == 200, response.text
    holder = response.json()["holders"][record_id]

    assert body["value_kind"] == kind
    for entry in body["entries"]:
        _check_shape(record_id, kind, entry)
    if body["entries"]:
        assert holder is not None
        _check_shape(record_id, kind, holder)
        first = dict(holder)
        first.pop("tied_count")
        assert first == body["entries"][0]
    else:
        assert holder is None
