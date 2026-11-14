"""EVENTS-012: the records library, as the registry holds it. No database.
Spec: .ai/tasks/EVENTS-012/ (task.json criteria 2-5, brief "The library",
"The featured sixteen" and "Minimums").

Pinned:

- RECORDS holds at least 100 definitions with unique ids, every id of the
  brief's table among them, each with a value_kind of the five, a non-empty
  rule naming its counting window, a category of the seven (the brief's
  section for that id) and a non-empty keywords list.
- The twelve ids of EVENTS-010 still resolve, in the same group.
- Every record about threes has keywords that 3pt, three, threes and
  3-pointer each match (a case-insensitive substring of some keyword, as a
  search box over the catalog matches).
- Exactly sixteen records have a featured_rank, 1 to 16 in the brief's order.
- Field goals, threes and free throws each have, at game, season and career
  scope, a made_total record and a shot_pct record; each shot_pct rule states
  the brief's minimum of attempts, each player average its minimum of games.
"""

from __future__ import annotations

from collections import Counter

import pytest

from app.events.records import RECORDS, RECORDS_BY_ID
from tests.events.records_library import (
    CAREER_AVERAGE_GAMES,
    CAREER_AVERAGES,
    CATEGORIES,
    CATEGORY_OF,
    FAN_THREES_SPELLINGS,
    FEATURED,
    LIBRARY_IDS,
    SEASON_AVERAGE_GAMES,
    SEASON_AVERAGES,
    SHOOTING,
    SHOT_MINIMUMS,
    THREES_IDS,
    rule_states,
)
from tests.events.records_support import PLAYER_RECORDS, RECORD_IDS, TEAM_RECORDS

VALUE_KINDS = frozenset({"count", "win_loss", "made_total", "shot_pct", "average"})


def test_the_brief_lists_104_ids():
    """Guards this file's own table."""
    assert len(LIBRARY_IDS) == 104
    assert len(set(LIBRARY_IDS)) == 104
    assert set(RECORD_IDS) <= set(LIBRARY_IDS)


def test_the_registry_holds_at_least_100_records_with_unique_ids():
    ids = [record.id for record in RECORDS]

    assert len(ids) >= 100, len(ids)
    assert [i for i, n in Counter(ids).items() if n > 1] == []
    assert set(RECORDS_BY_ID) == set(ids)


def test_every_id_of_the_brief_is_registered():
    registered = {record.id for record in RECORDS}

    assert sorted(set(LIBRARY_IDS) - registered) == []


@pytest.mark.parametrize("record_id", RECORD_IDS)
def test_the_twelve_existing_ids_still_resolve_in_their_group(record_id):
    record = RECORDS_BY_ID[record_id]

    expected = "team" if record_id in TEAM_RECORDS else "player"
    assert record_id in TEAM_RECORDS | PLAYER_RECORDS
    assert record.group == expected


def test_every_record_has_a_value_kind_a_rule_and_a_group_matching_its_id():
    for record in RECORDS:
        assert record.value_kind in VALUE_KINDS, record.id
        assert isinstance(record.rule, str) and record.rule.strip(), record.id
        assert record.group == ("team" if record.id.startswith("team-") else "player"), record.id
        for key in ("title", "unit"):
            value = getattr(record, key)
            assert isinstance(value, str) and value.strip(), (record.id, key)


def test_every_rule_names_its_counting_window():
    """Every window the brief names is a regular season, playoffs, or both."""
    silent = [
        record.id
        for record in RECORDS
        if "regular" not in record.rule.lower() and "playoff" not in record.rule.lower()
    ]

    assert silent == []


def test_every_record_has_one_of_the_seven_categories():
    wrong = {record.id: getattr(record, "category", None) for record in RECORDS}

    assert {i: c for i, c in wrong.items() if c not in CATEGORIES} == {}


@pytest.mark.parametrize("record_id", LIBRARY_IDS)
def test_each_brief_id_has_the_category_of_its_section(record_id):
    record = RECORDS_BY_ID[record_id]

    assert record.category == CATEGORY_OF[record_id]


def test_every_record_has_a_non_empty_keywords_list_of_words():
    for record in RECORDS:
        keywords = list(record.keywords)
        assert keywords, record.id
        assert all(isinstance(k, str) and k.strip() for k in keywords), (record.id, keywords)


@pytest.mark.parametrize("spelling", FAN_THREES_SPELLINGS)
@pytest.mark.parametrize("record_id", THREES_IDS)
def test_every_threes_record_matches_the_spellings_fans_use(record_id, spelling):
    keywords = [k.lower() for k in RECORDS_BY_ID[record_id].keywords]

    assert any(spelling in keyword for keyword in keywords), (record_id, spelling, keywords)


def test_exactly_sixteen_records_are_featured_in_the_briefs_order():
    featured = {r.id: r.featured_rank for r in RECORDS if r.featured_rank is not None}

    assert len(featured) == 16, featured
    assert sorted(featured, key=lambda i: featured[i]) == list(FEATURED)
    assert sorted(featured.values()) == list(range(1, 17))


def test_every_other_record_has_no_featured_rank():
    others = [r.id for r in RECORDS if r.id not in FEATURED and r.featured_rank is not None]

    assert others == []


@pytest.mark.parametrize(("stat", "scope"), list(SHOOTING))
def test_each_shot_and_scope_has_a_made_total_and_a_shot_pct(stat, scope):
    made_id, pct_id = SHOOTING[(stat, scope)]

    assert RECORDS_BY_ID[made_id].value_kind == "made_total"
    assert RECORDS_BY_ID[pct_id].value_kind == "shot_pct"


@pytest.mark.parametrize(("stat", "scope"), list(SHOOTING))
def test_each_shot_pct_rule_states_its_minimum_of_attempts(stat, scope):
    _, pct_id = SHOOTING[(stat, scope)]
    rule = RECORDS_BY_ID[pct_id].rule

    assert rule_states(rule, SHOT_MINIMUMS[(stat, scope)]), rule
    assert "attempt" in rule.lower(), rule


@pytest.mark.parametrize(
    ("record_id", "games"),
    [(i, SEASON_AVERAGE_GAMES) for i in SEASON_AVERAGES]
    + [(i, CAREER_AVERAGE_GAMES) for i in CAREER_AVERAGES],
)
def test_each_player_average_is_an_average_stating_its_minimum_of_games(record_id, games):
    record = RECORDS_BY_ID[record_id]

    assert record.value_kind == "average"
    assert rule_states(record.rule, games), record.rule
    assert "game" in record.rule.lower(), record.rule
