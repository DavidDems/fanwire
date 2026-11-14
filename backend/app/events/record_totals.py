"""EVENTS-012: rebuild_record_totals, the one writer of the records library's
two aggregate tables, player_season_totals and team_game_totals
(app.events.models).

Both are derived from games and player_game_stats and replaced whole: a
DELETE then one INSERT ... SELECT each, in the caller's transaction. It never
commits, so a load that fails after it leaves the old totals, and another
connection keeps reading the old rows until the caller commits (DELETE, not
TRUNCATE, whose lock would block those readers).

Every path that writes games or box scores calls it before its commit:
app.events.nba_history.load_nba_history (and so the load Lambda,
app.events.load_handler), scripts/generate_scale_fixture.py and
scripts/seed_perf.py. The migration that creates the tables
(alembic/versions/a8d3e5f1c2b7) runs a frozen copy of the same statements.

Only `regular` and `playoffs` games count; the play-in and the NBA Cup final
never do. A player-season row sums played lines (minutes on the court); a
team-game row is a completed game (any score).
"""

from __future__ import annotations

from sqlalchemy import Connection, text
from sqlalchemy.orm import Session

# Counted as a double-double (2) or a triple-double (3): 10 or more in that
# many of these, as models.TRIPLE_DOUBLE_STATS.
_TENS = (
    "(s.points >= 10)::int + (s.rebounds >= 10)::int + (s.assists >= 10)::int"
    " + (s.steals >= 10)::int + (s.blocks >= 10)::int"
)

# The box-score stats both tables sum.
_SHOOTING = (
    "field_goals_made",
    "field_goals_attempted",
    "three_pointers_made",
    "three_pointers_attempted",
    "free_throws_made",
    "free_throws_attempted",
)
_PLAYER_SUMS = (
    "seconds_played",
    "points",
    "rebounds",
    "offensive_rebounds",
    "defensive_rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    *_SHOOTING,
)
_TEAM_SUMS = (*_SHOOTING, "rebounds", "assists", "steals", "blocks", "turnovers")

PLAYER_SEASON_TOTALS_SQL = f"""
INSERT INTO player_season_totals
    (player_id, season, game_type, team_id, games, {", ".join(_PLAYER_SUMS)},
     double_doubles, triple_doubles)
SELECT s.player_id, g.season, g.game_type,
       (array_agg(s.team_id ORDER BY g.date DESC, g.id DESC))[1],
       count(*), {", ".join(f"sum(s.{c})" for c in _PLAYER_SUMS)},
       count(*) FILTER (WHERE {_TENS} >= 2),
       count(*) FILTER (WHERE {_TENS} >= 3)
FROM player_game_stats AS s
JOIN games AS g ON g.id = s.game_id
WHERE s.seconds_played IS NOT NULL AND g.game_type IN ('regular', 'playoffs')
GROUP BY s.player_id, g.season, g.game_type
"""

TEAM_GAME_TOTALS_SQL = f"""
INSERT INTO team_game_totals
    (game_id, team_id, opponent_id, season, date, game_type, score, opponent_score,
     won, streak, {", ".join(_TEAM_SUMS)})
WITH sides AS (
    SELECT id AS game_id, home_team_id AS team_id, away_team_id AS opponent_id, season,
           date, game_type, home_score AS score, away_score AS opponent_score
    FROM games
    WHERE game_type IN ('regular', 'playoffs') AND home_score + away_score > 0
    UNION ALL
    SELECT id, away_team_id, home_team_id, season, date, game_type, away_score, home_score
    FROM games
    WHERE game_type IN ('regular', 'playoffs') AND home_score + away_score > 0
),
runs AS (
    SELECT sides.*, score > opponent_score AS won,
           row_number() OVER (PARTITION BY team_id, season, game_type
                              ORDER BY date, game_id)
           - row_number() OVER (PARTITION BY team_id, season, game_type,
                                score > opponent_score
                                ORDER BY date, game_id) AS run
    FROM sides
),
box AS (
    SELECT game_id, team_id, {", ".join(f"sum({c}) AS {c}" for c in _TEAM_SUMS)}
    FROM player_game_stats
    GROUP BY game_id, team_id
)
SELECT r.game_id, r.team_id, r.opponent_id, r.season, r.date, r.game_type, r.score,
       r.opponent_score, r.won,
       row_number() OVER (PARTITION BY r.team_id, r.season, r.game_type, r.won, r.run
                          ORDER BY r.date, r.game_id),
       {", ".join(f"b.{c}" for c in _TEAM_SUMS)}
FROM runs AS r
LEFT JOIN box AS b ON b.game_id = r.game_id AND b.team_id = r.team_id
"""

REBUILD_STATEMENTS: tuple[str, ...] = (
    "DELETE FROM player_season_totals",
    PLAYER_SEASON_TOTALS_SQL,
    "DELETE FROM team_game_totals",
    TEAM_GAME_TOTALS_SQL,
)


def rebuild_record_totals(session: Session | Connection) -> None:
    """Replace both tables' contents from the stored games and box scores,
    in the caller's transaction. Never commits. Four statements."""
    for statement in REBUILD_STATEMENTS:
        session.execute(text(statement))
