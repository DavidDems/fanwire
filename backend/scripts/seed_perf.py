"""Seeds the local load test's database (PERF-001, perf/README.md).

perf/run.ps1 runs this against backend-perf's own empty Postgres
(postgres-perf, no volume, so every run seeds from empty and runs stay
comparable). It writes, in a handful of bulk `INSERT ... SELECT ...
generate_series` statements rather than one ORM insert per row, so the whole
seed takes seconds:

- 30 synthetic teams and 600 synthetic games (two seasons);
- 300 users, `perf-user-1` .. `perf-user-300`, whose cognito subs match the
  tokens scripts/mint_perf_tokens.py mints, each created 30+ days ago so the
  spam scorer's new-account rule (SPAM_NEW_ACCOUNT_HOURS) never applies, and
  each with a preferred team;
- follows (every user follows the next 20);
- 20,500 posts: 16,000 originals (every tenth mentions a game as
  `#GameId<id>`, with its event_mentions row), 3,000 replies and 1,500
  plain reposts;
- 30,000 likes.

Reserved id range. Teams and games are keyed by nba.com's id
(app.events.models). Those are real keys, and fake data must never sit under
one (scripts/seed_dev.py's docstring), so the synthetic rows use ids no
nba.com id uses: nba.com team ids are 1610612737-1610612766, and nba.com game
ids are ten-digit strings with two leading zeros ("0022300061"), so below
100,000,000 as integers. This script uses
    nba_team_id = 9_000_000_000 + n   (n = 1..30)
    nba_game_id = 9_100_000_000 + n   (n = 1..600)
and nothing else may ever write into 9_000_000_000-9_199_999_999.

Idempotent: if `perf-user-1` already exists the seed is a no-op, so a second
run adds no rows. Everything else is one transaction.

Fail-closed by design: refuses to run unless `ENVIRONMENT` is exactly
`"development"` or `"perf"`, so it can never be pointed at a deployed
database by accident.

Usage (inside the backend-perf container, or backend-dev):
    python scripts/seed_perf.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# scripts/ has no __init__.py (same as scripts/export_openapi.py) -- Python's
# implicit namespace package support picks it up once BACKEND_ROOT is on
# sys.path, inserted the same defensive way export_openapi.py inserts it.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import os
import time

from sqlalchemy import text

from app.db import make_engine
from app.dependencies import get_settings

ALLOWED_ENVIRONMENTS = ("development", "perf")
MARKER_SUB = "perf-user-1"

TEAM_ID_BASE = 9_000_000_000
GAME_ID_BASE = 9_100_000_000

USERS = 300
TEAMS = 30
GAMES = 600
ORIGINAL_POSTS = 16_000
REPLIES = 3_000
REPOSTS = 1_500
FOLLOWS_PER_USER = 20
LIKES_PER_USER = 100
MENTION_EVERY = 10

# Words the post text is built from, so GET /search/posts has real matches
# (k6's search scenario queries some of them).
VOCABULARY = (
    "dunk",
    "rebound",
    "buzzer",
    "defense",
    "playoffs",
    "rookie",
    "overtime",
    "assist",
    "comeback",
    "triple",
    "bench",
    "fastbreak",
)

_STATEMENTS: tuple[tuple[str, str], ...] = (
    (
        "teams",
        """
        INSERT INTO teams (nba_team_id, name, abbreviation, conference, division)
        SELECT :team_base + n,
               'Perf Team ' || lpad(n::text, 2, '0'),
               'P' || lpad(n::text, 2, '0'),
               CASE WHEN n <= :teams / 2 THEN 'East' ELSE 'West' END,
               'Perf Division ' || ((n - 1) / 5 + 1)
        FROM generate_series(1, :teams) AS n
        """,
    ),
    (
        "perf_teams",
        """
        CREATE TEMP TABLE perf_teams ON COMMIT DROP AS
        SELECT (nba_team_id - :team_base)::int AS rn, id FROM teams
        WHERE nba_team_id BETWEEN :team_base + 1 AND :team_base + :teams
        """,
    ),
    (
        "games",
        """
        INSERT INTO games (nba_game_id, home_team_id, away_team_id, date, season,
                           home_score, away_score, venue, game_type)
        SELECT :game_base + n,
               home.id,
               away.id,
               timestamp '2024-10-20 19:00' + (n * interval '13 hours'),
               CASE WHEN n <= :games / 2 THEN '2024-25' ELSE '2025-26' END,
               90 + (n * 7) % 40,
               88 + (n * 11) % 40,
               'Perf Arena ' || home.rn,
               'regular'
        FROM generate_series(1, :games) AS n
        JOIN perf_teams AS home ON home.rn = (n % :teams) + 1
        JOIN perf_teams AS away ON away.rn = ((n % :teams) + 1 + (n / :teams) % (:teams - 1))
                                             % :teams + 1
        """,
    ),
    (
        "perf_games",
        """
        CREATE TEMP TABLE perf_games ON COMMIT DROP AS
        SELECT (nba_game_id - :game_base)::int AS rn, id FROM games
        WHERE nba_game_id BETWEEN :game_base + 1 AND :game_base + :games
        """,
    ),
    (
        "users",
        """
        INSERT INTO users (cognito_sub, username, description, date_of_birth,
                           preferred_team_id, created_at, updated_at)
        SELECT 'perf-user-' || n,
               'perfuser' || n,
               'Synthetic load-test account ' || n,
               date '1990-01-01' + (n % 3650),
               t.id,
               now() - interval '30 days' - n * interval '1 minute',
               now() - interval '30 days'
        FROM generate_series(1, :users) AS n
        JOIN perf_teams AS t ON t.rn = (n % :teams) + 1
        """,
    ),
    (
        "perf_users",
        """
        CREATE TEMP TABLE perf_users ON COMMIT DROP AS
        SELECT substring(cognito_sub FROM 11)::int AS rn, id FROM users
        WHERE cognito_sub ~ '^perf-user-[0-9]+$'
        """,
    ),
    (
        "follows",
        """
        INSERT INTO follows (follower_user_id, followed_user_id)
        SELECT follower.id, followed.id
        FROM perf_users AS follower
        CROSS JOIN generate_series(1, :follows_per_user) AS k
        JOIN perf_users AS followed ON followed.rn = (follower.rn - 1 + k) % :users + 1
        ON CONFLICT DO NOTHING
        """,
    ),
    (
        "perf_posts",
        "CREATE TEMP TABLE perf_posts (rn bigint PRIMARY KEY, id bigint NOT NULL) ON COMMIT DROP",
    ),
    (
        "original posts",
        """
        WITH inserted AS (
            INSERT INTO posts (author_id, text, created_at)
            SELECT u.id,
                   format('Perf post %s: that %s in the %s was something',
                          n,
                          (CAST(:vocabulary AS text[]))[n % :vocab_len + 1],
                          (CAST(:vocabulary AS text[]))[(n / 7) % :vocab_len + 1])
                   || CASE WHEN n % :mention_every = 0 THEN ' #GameId' || g.id ELSE '' END,
                   now() - interval '25 days' + n * interval '2 minutes'
            FROM generate_series(1, :original_posts) AS n
            JOIN perf_users AS u ON u.rn = (n % :users) + 1
            JOIN perf_games AS g ON g.rn = (n % :games) + 1
            ORDER BY n
            RETURNING id
        )
        INSERT INTO perf_posts (rn, id)
        SELECT row_number() OVER (ORDER BY id), id FROM inserted
        """,
    ),
    (
        "event mentions",
        """
        INSERT INTO event_mentions (post_id, game_id, raw_token)
        SELECT p.id,
               substring(p.text FROM '#GameId([0-9]+)')::bigint,
               substring(p.text FROM '#GameId[0-9]+')
        FROM posts AS p
        JOIN perf_posts AS pp ON pp.id = p.id
        WHERE p.text LIKE '%#GameId%'
        """,
    ),
    (
        "replies",
        """
        INSERT INTO posts (author_id, text, is_reply, parent_post_id, created_at)
        SELECT u.id,
               format('Perf reply %s: agreed, what a %s',
                      n, (CAST(:vocabulary AS text[]))[n % :vocab_len + 1]),
               true,
               parent.id,
               now() - interval '20 days' + n * interval '5 minutes'
        FROM generate_series(1, :replies) AS n
        JOIN perf_users AS u ON u.rn = ((n * 7) % :users) + 1
        JOIN perf_posts AS parent ON parent.rn = ((n * 11) % :original_posts) + 1
        """,
    ),
    (
        "reposts",
        """
        INSERT INTO posts (author_id, text, is_repost, original_post_id, created_at)
        SELECT u.id,
               NULL,
               true,
               original.id,
               now() - interval '15 days' + n * interval '7 minutes'
        FROM generate_series(1, :reposts) AS n
        JOIN perf_users AS u ON u.rn = (n % :users) + 1
        JOIN perf_posts AS original ON original.rn = ((n * 13) % :original_posts) + 1
        """,
    ),
    (
        "likes",
        """
        INSERT INTO post_likes (user_id, post_id)
        SELECT u.id, p.id
        FROM perf_users AS u
        CROSS JOIN generate_series(1, :likes_per_user) AS k
        JOIN perf_posts AS p ON p.rn = ((u.rn * 37 + k * 157) % :original_posts) + 1
        ON CONFLICT DO NOTHING
        """,
    ),
)

_PARAMS = {
    "team_base": TEAM_ID_BASE,
    "game_base": GAME_ID_BASE,
    "users": USERS,
    "teams": TEAMS,
    "games": GAMES,
    "original_posts": ORIGINAL_POSTS,
    "replies": REPLIES,
    "reposts": REPOSTS,
    "follows_per_user": FOLLOWS_PER_USER,
    "likes_per_user": LIKES_PER_USER,
    "mention_every": MENTION_EVERY,
    "vocabulary": list(VOCABULARY),
    "vocab_len": len(VOCABULARY),
}


def main() -> int:
    environment = os.environ.get("ENVIRONMENT")
    if environment not in ALLOWED_ENVIRONMENTS:
        print(
            f"refusing to run: ENVIRONMENT={environment!r}, but this script only ever "
            f"runs in one of {ALLOWED_ENVIRONMENTS!r} -- it writes synthetic users and "
            "posts that must never reach a real database",
            file=sys.stderr,
        )
        return 1

    engine = make_engine(get_settings().database_url)
    try:
        with engine.begin() as conn:
            if conn.execute(
                text("SELECT 1 FROM users WHERE cognito_sub = :sub"), {"sub": MARKER_SUB}
            ).first():
                print(f"already seeded ({MARKER_SUB} exists); nothing to do")
                return 0

            started = time.monotonic()
            for name, sql in _STATEMENTS:
                # Each statement only binds the parameters it names.
                params = {key: value for key, value in _PARAMS.items() if f":{key}" in sql}
                result = conn.execute(text(sql), params)
                if result.rowcount is not None and result.rowcount >= 0:
                    print(f"  {name}: {result.rowcount} rows")
            print(f"seeded the perf dataset in {time.monotonic() - started:.1f}s")
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
