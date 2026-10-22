"""POSTS-006's migration: posts gains linked_line_game_id (bigint, nullable,
FK games.id), backfilled from player_game_stats.game_id for every row with
linked_player_game_stats_id set, then CHECK ck_posts_line_game_pairing and
two partial indexes, ix_posts_linked_game_id and ix_posts_linked_line_game_id
(each WHERE its column IS NOT NULL). Written before the revision exists.

The parent is named explicitly (POSTS-005's data-link columns, the head
before POSTS-006), not "-1", so this test keeps meaning "undo this
migration" after a later revision becomes head -- the lesson
tests/test_migrations.py records.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "c7e3a5d9f1b4"  # add_posts_data_link_columns, head before POSTS-006

_COLUMN = "linked_line_game_id"
_CHECK = "ck_posts_line_game_pairing"
_INDEXES = {
    "ix_posts_linked_game_id": "linked_game_id",
    "ix_posts_linked_line_game_id": "linked_line_game_id",
}


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def _posts_columns(engine) -> dict[str, tuple[str, str, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns WHERE table_name = 'posts'"
            )
        ).all()
    return {name: (data_type, nullable, default) for name, data_type, nullable, default in rows}


def _posts_foreign_keys(engine) -> set[tuple[str, str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT a.attname, rt.relname, ra.attname "
                "FROM pg_constraint c "
                "JOIN pg_class t ON t.oid = c.conrelid "
                "JOIN pg_class rt ON rt.oid = c.confrelid "
                "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] "
                "JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1] "
                "WHERE c.contype = 'f' AND t.relname = 'posts'"
            )
        ).all()
    return {tuple(row) for row in rows}


def _posts_checks(engine) -> dict[str, str]:
    """posts' CHECK constraints: name -> pg_get_constraintdef."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c "
                "JOIN pg_class t ON t.oid = c.conrelid "
                "WHERE c.contype = 'c' AND t.relname = 'posts'"
            )
        ).all()
    return dict(rows)


def _posts_indexes(engine) -> dict[str, str]:
    """posts' indexes: name -> indexdef."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'posts'")
        ).all()
    return dict(rows)


def _at_parent(alembic_config) -> None:
    """The database at the parent revision, whatever an earlier test in this
    module left it at: upgrade reaches it from empty, downgrade from head."""
    command.upgrade(alembic_config, _PARENT_REVISION)
    command.downgrade(alembic_config, _PARENT_REVISION)


_LINE_STATS = (
    "field_goals_made, field_goals_attempted, three_pointers_made, three_pointers_attempted, "
    "free_throws_made, free_throws_attempted, offensive_rebounds, defensive_rebounds, "
    "rebounds, assists, steals, blocks, turnovers, personal_fouls, points, plus_minus"
)


def _seed_links(engine) -> dict[str, int]:
    """At the parent revision: two teams, two games, a player with a line in
    the second game, and four posts -- a player_game link, a game_final
    link, a player_career link and none. Returns their ids."""
    with engine.begin() as conn:

        def one(sql: str, **params) -> int:
            return conn.execute(text(sql), params).scalar_one()

        user = one(
            "INSERT INTO users (cognito_sub, username, date_of_birth) "
            "VALUES ('sub-mig-line-game', 'mig_line_game', '1990-01-01') RETURNING id"
        )
        home = one(
            "INSERT INTO teams (nba_team_id, name, abbreviation, conference, division) "
            "VALUES (1610612801, 'Home', 'HOM', 'East', 'Atlantic') RETURNING id"
        )
        away = one(
            "INSERT INTO teams (nba_team_id, name, abbreviation, conference, division) "
            "VALUES (1610612802, 'Away', 'AWY', 'West', 'Pacific') RETURNING id"
        )
        games = [
            one(
                "INSERT INTO games (nba_game_id, home_team_id, away_team_id, date, season, "
                "home_score, away_score, game_type) "
                "VALUES (:n, :h, :a, '2024-01-10 19:30', '2023-24', 100, 90, 'regular') "
                "RETURNING id",
                n=n,
                h=home,
                a=away,
            )
            for n in (29_000_001, 29_000_002)
        ]
        player = one(
            "INSERT INTO players (nba_person_id, first_name, last_name) "
            "VALUES (2_900_001, 'Line', 'Owner') RETURNING id"
        )
        line = one(
            f"INSERT INTO player_game_stats (game_id, player_id, team_id, starter, "
            f"seconds_played, dnp_reason, {_LINE_STATS}) "
            f"VALUES (:g, :p, :t, true, 1800, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "
            f"20, 0) RETURNING id",
            g=games[1],
            p=player,
            t=home,
        )
        line_post = one(
            "INSERT INTO posts (author_id, text, linked_player_game_stats_id) "
            "VALUES (:a, 'the line', :l) RETURNING id",
            a=user,
            l=line,
        )
        game_post = one(
            "INSERT INTO posts (author_id, text, linked_game_id) "
            "VALUES (:a, 'the final', :g) RETURNING id",
            a=user,
            g=games[0],
        )
        career_post = one(
            "INSERT INTO posts (author_id, text, linked_player_id, linked_player_scope) "
            "VALUES (:a, 'the career', :p, 'regular') RETURNING id",
            a=user,
            p=player,
        )
        plain_post = one(
            "INSERT INTO posts (author_id, text) VALUES (:a, 'no link') RETURNING id", a=user
        )
    return {
        "line_game": games[1],
        "line_post": line_post,
        "game_post": game_post,
        "career_post": career_post,
        "plain_post": plain_post,
    }


def _line_game_ids(engine, post_ids) -> dict[int, int | None]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, linked_line_game_id FROM posts WHERE id = ANY(:ids)"),
            {"ids": list(post_ids)},
        ).all()
    return dict(rows)


def test_upgrade_adds_a_nullable_bigint_linked_line_game_id(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    assert _posts_columns(engine).get(_COLUMN) == ("bigint", "YES", None)


def test_upgrade_adds_the_foreign_key_to_games(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    assert (_COLUMN, "games", "id") in _posts_foreign_keys(engine)


def test_upgrade_adds_the_pairing_check_and_nothing_else_of_its_kind(alembic_config, engine):
    _at_parent(alembic_config)
    before = _posts_checks(engine)

    command.upgrade(alembic_config, "head")

    after = _posts_checks(engine)
    assert set(after) - set(before) == {_CHECK}
    definition = after[_CHECK]
    assert "linked_player_game_stats_id IS NULL" in definition
    assert "linked_line_game_id IS NULL" in definition


def test_upgrade_adds_both_partial_indexes(alembic_config, engine):
    _at_parent(alembic_config)
    assert set(_INDEXES).isdisjoint(_posts_indexes(engine))

    command.upgrade(alembic_config, "head")

    indexes = _posts_indexes(engine)
    for name, column in _INDEXES.items():
        assert name in indexes, sorted(indexes)
        definition = indexes[name]
        assert f"({column})" in definition
        assert "WHERE" in definition
        assert f"{column} IS NOT NULL" in definition


def test_upgrade_backfills_the_line_game_and_leaves_other_rows_null(alembic_config, engine):
    _at_parent(alembic_config)
    seeded = _seed_links(engine)

    command.upgrade(alembic_config, "head")

    assert _line_game_ids(
        engine,
        [seeded["line_post"], seeded["game_post"], seeded["career_post"], seeded["plain_post"]],
    ) == {
        seeded["line_post"]: seeded["line_game"],
        seeded["game_post"]: None,
        seeded["career_post"]: None,
        seeded["plain_post"]: None,
    }


def test_upgrade_then_downgrade_then_upgrade(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    assert _COLUMN in _posts_columns(engine)

    command.downgrade(alembic_config, _PARENT_REVISION)
    assert _COLUMN not in _posts_columns(engine)
    assert _CHECK not in _posts_checks(engine)
    assert set(_INDEXES).isdisjoint(_posts_indexes(engine))
    assert "linked_player_game_stats_id" in _posts_columns(engine)  # the parent's own column

    command.upgrade(alembic_config, "head")
    assert _posts_columns(engine).get(_COLUMN) == ("bigint", "YES", None)
    assert _CHECK in _posts_checks(engine)
    assert set(_INDEXES) <= set(_posts_indexes(engine))
