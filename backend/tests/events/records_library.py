"""The records library of EVENTS-012, as its brief settles it
(.ai/tasks/EVENTS-012/brief.md): every id by category, the featured sixteen
in order, the shooting pairs and the minimums. Shared by the library's tests
(test_records_library.py, test_records_catalog.py, test_records_minimums.py,
test_record_totals.py). Plain data: never derived from app code.
"""

from __future__ import annotations

CATEGORIES: tuple[str, ...] = (
    "team-franchise",
    "team-season",
    "team-game",
    "player-game",
    "player-season",
    "player-career",
    "player-playoffs",
)

# category -> the brief's ids, in the brief's order.
LIBRARY: dict[str, tuple[str, ...]] = {
    "player-game": (
        "player-points-game",
        "player-rebounds-game",
        "player-offensive-rebounds-game",
        "player-defensive-rebounds-game",
        "player-assists-game",
        "player-steals-game",
        "player-blocks-game",
        "player-threes-game",
        "player-three-pct-game",
        "player-field-goals-game",
        "player-field-goal-pct-game",
        "player-free-throws-game",
        "player-free-throw-pct-game",
        "player-minutes-game",
        "player-plus-minus-game",
    ),
    "player-season": (
        "player-points-season",
        "player-rebounds-season",
        "player-offensive-rebounds-season",
        "player-assists-season",
        "player-steals-season",
        "player-blocks-season",
        "player-minutes-season",
        "player-triple-doubles-season",
        "player-double-doubles-season",
        "player-threes-season",
        "player-three-pct-season",
        "player-field-goals-season",
        "player-field-goal-pct-season",
        "player-free-throws-season",
        "player-free-throw-pct-season",
        "player-ppg-season",
        "player-rpg-season",
        "player-apg-season",
        "player-spg-season",
        "player-bpg-season",
        "player-mpg-season",
    ),
    "player-career": (
        "player-career-points",
        "player-career-rebounds",
        "player-career-assists",
        "player-career-steals",
        "player-career-blocks",
        "player-career-minutes",
        "player-career-games",
        "player-career-triple-doubles",
        "player-career-double-doubles",
        "player-career-threes",
        "player-career-three-pct",
        "player-career-field-goals",
        "player-career-field-goal-pct",
        "player-career-free-throws",
        "player-career-free-throw-pct",
        "player-career-ppg",
        "player-career-rpg",
        "player-career-apg",
        "player-career-spg",
        "player-career-bpg",
    ),
    "player-playoffs": (
        "player-championships",
        "player-playoff-points-game",
        "player-playoff-rebounds-game",
        "player-playoff-assists-game",
        "player-playoff-threes-game",
        "player-playoff-steals-game",
        "player-playoff-blocks-game",
        "player-playoff-career-points",
        "player-playoff-career-rebounds",
        "player-playoff-career-assists",
        "player-playoff-career-threes",
        "player-playoff-career-steals",
        "player-playoff-career-blocks",
        "player-playoff-career-games",
    ),
    "team-franchise": (
        "team-championships",
        "team-finals-appearances",
        "team-playoff-appearances",
        "team-most-wins-all-time",
        "team-best-win-pct-all-time",
    ),
    "team-season": (
        "team-best-season",
        "team-worst-season",
        "team-most-wins-season",
        "team-most-losses-season",
        "team-longest-win-streak",
        "team-longest-losing-streak",
        "team-highest-ppg-season",
        "team-lowest-opp-ppg-season",
        "team-best-point-diff-season",
        "team-most-threes-season",
        "team-three-pct-season",
        "team-field-goal-pct-season",
        "team-free-throw-pct-season",
        "team-apg-season",
        "team-rpg-season",
        "team-spg-season",
        "team-bpg-season",
        "team-fewest-turnovers-season",
    ),
    "team-game": (
        "team-most-points-game",
        "team-fewest-points-game",
        "team-largest-win",
        "team-most-threes-game",
        "team-most-assists-game",
        "team-most-rebounds-game",
        "team-most-steals-game",
        "team-most-blocks-game",
        "team-highest-combined-points-game",
        "team-playoff-most-points-game",
        "team-playoff-largest-win",
    ),
}

LIBRARY_IDS: tuple[str, ...] = tuple(i for ids in LIBRARY.values() for i in ids)
CATEGORY_OF: dict[str, str] = {i: category for category, ids in LIBRARY.items() for i in ids}

FEATURED: tuple[str, ...] = (
    "team-best-season",
    "player-points-game",
    "team-championships",
    "player-career-points",
    "player-threes-season",
    "player-three-pct-season",
    "player-ppg-season",
    "team-worst-season",
    "player-rebounds-game",
    "player-assists-game",
    "player-threes-game",
    "team-longest-win-streak",
    "player-career-triple-doubles",
    "player-championships",
    "team-most-points-game",
    "team-largest-win",
)

# (stat, scope) -> (the made_total record, the shot_pct record)
SHOOTING: dict[tuple[str, str], tuple[str, str]] = {
    ("fg", "game"): ("player-field-goals-game", "player-field-goal-pct-game"),
    ("3pt", "game"): ("player-threes-game", "player-three-pct-game"),
    ("ft", "game"): ("player-free-throws-game", "player-free-throw-pct-game"),
    ("fg", "season"): ("player-field-goals-season", "player-field-goal-pct-season"),
    ("3pt", "season"): ("player-threes-season", "player-three-pct-season"),
    ("ft", "season"): ("player-free-throws-season", "player-free-throw-pct-season"),
    ("fg", "career"): ("player-career-field-goals", "player-career-field-goal-pct"),
    ("3pt", "career"): ("player-career-threes", "player-career-three-pct"),
    ("ft", "career"): ("player-career-free-throws", "player-career-free-throw-pct"),
}

# The brief's attempt minimums, flat across seasons.
SHOT_MINIMUMS: dict[tuple[str, str], int] = {
    ("fg", "game"): 15,
    ("3pt", "game"): 8,
    ("ft", "game"): 10,
    ("fg", "season"): 500,
    ("3pt", "season"): 200,
    ("ft", "season"): 150,
    ("fg", "career"): 3000,
    ("3pt", "career"): 1000,
    ("ft", "career"): 1000,
}

# Player averages and the games they need.
SEASON_AVERAGES: tuple[str, ...] = (
    "player-ppg-season",
    "player-rpg-season",
    "player-apg-season",
    "player-spg-season",
    "player-bpg-season",
    "player-mpg-season",
)
CAREER_AVERAGES: tuple[str, ...] = (
    "player-career-ppg",
    "player-career-rpg",
    "player-career-apg",
    "player-career-spg",
    "player-career-bpg",
)
SEASON_AVERAGE_GAMES = 58
CAREER_AVERAGE_GAMES = 400

# Every record about threes, and how fans spell them.
THREES_IDS: tuple[str, ...] = tuple(i for i in LIBRARY_IDS if "three" in i)
FAN_THREES_SPELLINGS: tuple[str, ...] = ("3pt", "three", "threes", "3-pointer")

# The holders route's cap.
HOLDERS_CAP = 24


def rule_states(rule: str, number: int) -> bool:
    """Whether `rule` states `number`, written plainly or with a thousands
    comma (3000 or 3,000)."""
    return str(number) in rule or f"{number:,}" in rule
