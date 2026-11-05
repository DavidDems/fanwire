"""Seed 100 synthetic 2025-26 regular-season posts for screenshot demos.

This script assumes a separate account seeder has created the symbolic users
listed in ``DEMO_USERS`` and provides their DB ids in ``--users-json`` as a
mapping such as {"user_001": 123, ...}. It only writes posts and post_likes.
It never creates accounts, games, box scores, or playoff-linked content.

Run from backend/ against a migrated development database:
    python scripts/seed_demo_posts.py --users-json demo_user_ids.json
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from datetime import UTC, date, datetime
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.events.models import Game, PlayerGameStats, Team
from app.posts.models import Post, PostLike
from app.users.models import User

SEED = 20261103
SEASON = "2025-26"
DEMO_USERS = tuple(f"user_{i:03d}" for i in range(1, 401))
TEAMS = ("Knicks", "Thunder", "Nuggets", "Spurs", "Celtics", "Cavaliers", "Timberwolves", "Lakers")
NAMES = ("Brunson", "SGA", "Jokic", "Wembanyama", "Tatum", "Edwards", "Cunningham", "Mitchell")
TAKES = (
    "The {team} have been quietly excellent in the half court lately.",
    "{name} is making the MVP conversation impossible to ignore.",
    "That {team} rotation looks deeper every week.",
    "People are sleeping on how much {name} controls the pace.",
    "The {team} need a better answer when the threes stop falling.",
    "I still don't buy the {team} as a real contender; too many rough stretches.",
    "{name} gets away with a lot of empty numbers and the box scores hide it.",
    "The {team} look cooked whenever their starters sit. This won't hold up.",
)
HATER_TAKES = (
    "The {team} are wildly overrated; {name} disappears whenever the game tightens.",
    "MVP talk for {name} is a joke when the {team} keep giving away these games.",
    "The {team} bench is a disaster and this roster has no chance against real teams.",
    "{name} puts up numbers, but the impact is nowhere near the hype.",
)
REPLIES = (
    "The film backs this up; watch the weak-side rotations.",
    "I see it differently. The pace is doing more than the scoring.",
    "Exactly, and the bench minutes are where the story is.",
    "That take is wild. One cold shooting night doesn't prove anything.",
    "Fair point, but the schedule has been brutal lately.",
    "No chance. Their defense has been getting exposed for weeks.",
    "I think the MVP race is closer than people want to admit.",
    "Box score says one thing; the fourth quarter said another.",
)


def build_posts() -> list[dict[str, object]]:
    rng = random.Random(SEED)
    # Exact distribution over 100: 11x1, 22x2, 34x3, 22x4, 11x5.
    reply_counts = [1] * 11 + [2] * 22 + [3] * 34 + [4] * 22 + [5] * 11
    rng.shuffle(reply_counts)
    rows = []
    for i in range(100):
        is_hater = i % 4 == 0
        template = (HATER_TAKES if is_hater else TAKES)[
            i % (len(HATER_TAKES) if is_hater else len(TAKES))
        ]
        rows.append(
            {
                "author": DEMO_USERS[i],
                "text": template.format(
                    team=TEAMS[(i * 3) % len(TEAMS)], name=NAMES[(i * 5) % len(NAMES)]
                ),
                "reply_count": reply_counts[i],
                "hater": is_hater,
                "link_kind": "game" if i % 4 == 0 else "player_game" if i % 4 == 1 else None,
                "link_index": i // 2,
                "replies": [
                    {
                        "author": DEMO_USERS[100 + (i * 5 + j) % 300],
                        "text": (
                            HATER_TAKES[(i + j) % len(HATER_TAKES)].format(
                                team=TEAMS[(i + j) % len(TEAMS)], name=NAMES[(i + j) % len(NAMES)]
                            )
                            if (i + j) % 4 == 0
                            else REPLIES[(i + j) % len(REPLIES)]
                        ),
                        "hater": (i + j) % 4 == 0,
                    }
                    for j in range(reply_counts[i])
                ],
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if os.getenv("ENVIRONMENT") not in {"development", "demo"}:
        parser.error('refusing to seed unless ENVIRONMENT is "development" or "demo"')
    if args.dry_run:
        rows = build_posts()
        print(
            f"Prepared {len(rows)} originals, {sum(int(r['reply_count']) for r in rows)} replies; no DB writes."
        )
        return
    engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
    rng = random.Random(SEED)
    with Session(engine) as session, session.begin():
        regular_games = list(
            session.scalars(
                select(Game)
                .where(Game.season == SEASON, Game.game_type == "regular")
                .order_by(Game.date)
            )
        )
        lines = list(
            session.scalars(
                select(PlayerGameStats)
                .join(Game, Game.id == PlayerGameStats.game_id)
                .where(
                    Game.season == SEASON,
                    Game.game_type == "regular",
                    PlayerGameStats.seconds_played.is_not(None),
                )
                .order_by(Game.date)
            )
        )
        if len(regular_games) < 50 or len(lines) < 50:
            raise RuntimeError(
                "Expected loaded 2025-26 regular-season games and box scores before seeding"
            )
        teams = list(session.scalars(select(Team).order_by(Team.id)))
        abbrev = {
            "Knicks": "NYK",
            "Thunder": "OKC",
            "Nuggets": "DEN",
            "Spurs": "SAS",
            "Celtics": "BOS",
            "Cavaliers": "CLE",
            "Timberwolves": "MIN",
            "Lakers": "LAL",
        }
        team_ids = {team.abbreviation: team.id for team in teams}
        if any(code not in team_ids for code in abbrev.values()):
            raise RuntimeError("Required NBA teams are missing; load NBA history first")
        user_ids: dict[str, int] = {}
        for i, symbolic in enumerate(DEMO_USERS, start=1):
            user = session.scalar(select(User).where(User.cognito_sub == f"demo-seed:{symbolic}"))
            if user is None:
                user = User(
                    cognito_sub=f"demo-seed:{symbolic}",
                    username=f"demo_{i:03d}",
                    description=f"NBA fan sharing takes on the {TEAMS[(i - 1) % len(TEAMS)]}.",
                    date_of_birth=date(1980 + i % 25, 1 + i % 12, 1 + i % 27),
                    preferred_team_id=None
                    if i % 5 == 0
                    else team_ids[abbrev[TEAMS[(i - 1) % len(TEAMS)]]],
                )
                session.add(user)
                session.flush()
            user_ids[symbolic] = user.id
        rows = build_posts()
        inserted: list[Post] = []
        for row in rows:
            kwargs: dict[str, object] = {}
            if row["link_kind"] == "game":
                game = regular_games[int(row["link_index"]) % len(regular_games)]
                kwargs["linked_game_id"] = game.id
            elif row["link_kind"] == "player_game":
                line = lines[int(row["link_index"]) % len(lines)]
                kwargs.update(linked_player_game_stats_id=line.id, linked_line_game_id=line.game_id)
            post = Post(
                author_id=user_ids[str(row["author"])],
                text=str(row["text"]),
                created_at=datetime(2025, 10, 21, tzinfo=UTC),
                **kwargs,
            )
            session.add(post)
            session.flush()
            inserted.append(post)
            for reply in row["replies"]:  # type: ignore[union-attr]
                session.add(
                    Post(
                        author_id=user_ids[str(reply["author"])],
                        text=str(reply["text"]),
                        is_reply=True,
                        parent_post_id=post.id,
                        created_at=post.created_at,
                    )
                )
        session.flush()
        # Likes per original: replies*20 +/- uniform 1..10. Distinct users per post.
        for post, spec in zip(inserted, rows):
            count = int(spec["reply_count"]) * 20 + rng.choice((-1, 1)) * rng.randint(1, 10)
            likers = rng.sample(list(DEMO_USERS), count)
            session.add_all(PostLike(user_id=user_ids[u], post_id=post.id) for u in likers)
    print(
        f"Seeded 100 original posts and {sum(int(r['reply_count']) for r in build_posts())} replies."
    )


if __name__ == "__main__":
    main()
