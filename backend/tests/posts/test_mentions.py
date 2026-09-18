"""Tests for app.posts.mentions — the Interpreter piece (MentionParser, per
wiki/CodeContext/Standards/gof-patterns.md) restricted to `#GameId<digits>`
tokens only, per AGENTS.md TDD workflow. Written before
app/posts/mentions.py exists.

See wiki/CodeContext/Modules/0x03-posts.md EventMention section: only
`#GameId<digits>` is implemented (no `@user`, no `$TEAM` — YAGNI, no schema/
business rule calls for either), and unresolved mention tokens are silently
dropped, post text kept as-authored.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team
from app.posts.mentions import MentionToken, parse_mentions, resolve_mentions

# --- parse_mentions: pure function, no DB needed ---


def test_parse_mentions_extracts_single_token():
    tokens = parse_mentions("check out #GameId123 last night")

    assert tokens == [MentionToken(raw_token="#GameId123", game_id=123)]


def test_parse_mentions_extracts_multiple_tokens():
    tokens = parse_mentions("#GameId1 was wild, and so was #GameId42")

    assert tokens == [
        MentionToken(raw_token="#GameId1", game_id=1),
        MentionToken(raw_token="#GameId42", game_id=42),
    ]


def test_parse_mentions_returns_empty_list_when_no_match():
    assert parse_mentions("just some plain text, no mentions here") == []


def test_parse_mentions_returns_empty_list_for_empty_string():
    assert parse_mentions("") == []


def test_parse_mentions_returns_empty_list_for_none():
    assert parse_mentions(None) == []


def test_parse_mentions_ignores_gameid_with_no_digits():
    assert parse_mentions("this is not a mention: #GameId") == []


def test_parse_mentions_is_case_sensitive_and_ignores_lowercase_variant():
    assert parse_mentions("lowercase doesn't count: #gameid123") == []


# --- resolve_mentions: real Postgres session ---


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _seed_game(session, **overrides) -> Game:
    home = Team(
        api_sports_team_id=101,
        name="Boston Celtics",
        abbreviation="BOS",
        conference="Eastern",
        division="Atlantic",
    )
    away = Team(
        api_sports_team_id=102,
        name="Los Angeles Lakers",
        abbreviation="LAL",
        conference="Western",
        division="Pacific",
    )
    session.add_all([home, away])
    session.commit()

    defaults = {
        "api_sports_game_id": 555,
        "home_team_id": home.id,
        "away_team_id": away.id,
        "date": datetime(2026, 1, 1, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 100,
        "away_score": 98,
    }
    defaults.update(overrides)
    game = Game(**defaults)
    session.add(game)
    session.commit()
    return game


def test_resolve_mentions_resolves_token_to_real_seeded_game(session_factory):
    with session_factory() as session:
        game = _seed_game(session)
        token = MentionToken(raw_token=f"#GameId{game.id}", game_id=game.id)

        resolved = resolve_mentions(session, [token])

        assert resolved == [(token, game)]


def test_resolve_mentions_silently_drops_unresolvable_token(session_factory):
    with session_factory() as session:
        game = _seed_game(session)
        good_token = MentionToken(raw_token=f"#GameId{game.id}", game_id=game.id)
        bad_token = MentionToken(raw_token="#GameId999999", game_id=999_999)

        resolved = resolve_mentions(session, [good_token, bad_token])

        assert resolved == [(good_token, game)]


def test_resolve_mentions_returns_empty_list_when_no_tokens_resolve(session_factory):
    with session_factory() as session:
        _seed_game(session)
        bad_token = MentionToken(raw_token="#GameId999999", game_id=999_999)

        assert resolve_mentions(session, [bad_token]) == []


def test_resolve_mentions_returns_empty_list_for_empty_token_list(session_factory):
    with session_factory() as session:
        assert resolve_mentions(session, []) == []
