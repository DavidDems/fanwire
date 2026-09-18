"""Tests for app.feed.strategies -- FeedRankingStrategy (Strategy pattern,
wiki/CodeContext/Standards/gof-patterns.md "Strategy"), per AGENTS.md TDD
workflow. Written before app/feed/strategies.py exists.

FollowsAndPreferredTeamStrategy: reverse-chronological; authors = the
viewer's followed ids plus the viewer themself; mentioned_game_ids =
game_ids_for_team(preferred_team_id) when one is set.

GuestRecentStrategy: most-recent top-level posts globally -- resolves
wiki/CodeContext/Modules/0x06-feed.md's previously-open "guest-feed
algorithm" decision.

strategy_for(viewer) picks between them -- callers never branch on the
concrete type.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team
from app.feed.strategies import (
    FeedRankingStrategy,
    FollowsAndPreferredTeamStrategy,
    GuestRecentStrategy,
    strategy_for,
)
from app.posts.models import EventMention, Post
from app.users.models import Follow, User


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


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-{overrides.get('username', 'u')}",
        "username": "strategy_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


def _make_post(session, author, **overrides) -> Post:
    defaults = {"author_id": author.id, "text": "a post"}
    defaults.update(overrides)
    post = Post(**defaults)
    session.add(post)
    session.commit()
    return post


def _make_team(session, **overrides) -> Team:
    defaults = {
        "api_sports_team_id": 1,
        "name": "Team",
        "abbreviation": "TM",
        "conference": "Eastern",
        "division": "Atlantic",
    }
    defaults.update(overrides)
    team = Team(**defaults)
    session.add(team)
    session.commit()
    return team


def _make_game(session, home, away, **overrides) -> Game:
    defaults = {
        "api_sports_game_id": 5001,
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


def test_follows_and_preferred_team_strategy_is_a_feed_ranking_strategy(session_factory):
    with session_factory() as session:
        viewer = _make_user(session, username="fpts_viewer")

        strategy = FollowsAndPreferredTeamStrategy(viewer.id, None)

        assert isinstance(strategy, FeedRankingStrategy)


def test_follows_and_preferred_team_strategy_includes_followed_authors_and_self(session_factory):
    with session_factory() as session:
        viewer = _make_user(session, username="fpts_v1")
        followed = _make_user(session, username="fpts_followed1")
        stranger = _make_user(session, username="fpts_stranger1")
        session.add(Follow(follower_user_id=viewer.id, followed_user_id=followed.id))
        session.commit()

        own_post = _make_post(session, viewer, text="own post")
        followed_post = _make_post(session, followed, text="followed post")
        stranger_post = _make_post(session, stranger, text="stranger post")

        strategy = FollowsAndPreferredTeamStrategy(viewer.id, None)
        result = strategy.select_posts(session, before_id=None, limit=20)

        ids = {p.id for p in result}
        assert ids == {own_post.id, followed_post.id}
        assert stranger_post.id not in ids


def test_follows_and_preferred_team_strategy_includes_preferred_team_mentions(session_factory):
    with session_factory() as session:
        viewer = _make_user(session, username="fpts_v2")
        stranger = _make_user(session, username="fpts_stranger2")
        home = _make_team(session, api_sports_team_id=201)
        away = _make_team(session, api_sports_team_id=202)
        game = _make_game(session, home, away, api_sports_game_id=6001)

        mentioning_post = _make_post(session, stranger, text="mentions preferred team's game")
        session.add(
            EventMention(post_id=mentioning_post.id, game_id=game.id, raw_token="#GameId")
        )
        session.commit()

        unrelated_post = _make_post(session, stranger, text="unrelated stranger post")

        strategy = FollowsAndPreferredTeamStrategy(viewer.id, home.id)
        result = strategy.select_posts(session, before_id=None, limit=20)

        ids = {p.id for p in result}
        assert mentioning_post.id in ids
        assert unrelated_post.id not in ids


def test_follows_and_preferred_team_strategy_without_preferred_team_ignores_mentions(
    session_factory,
):
    with session_factory() as session:
        viewer = _make_user(session, username="fpts_v3")
        stranger = _make_user(session, username="fpts_stranger3")
        home = _make_team(session, api_sports_team_id=301)
        away = _make_team(session, api_sports_team_id=302)
        game = _make_game(session, home, away, api_sports_game_id=7001)

        mentioning_post = _make_post(session, stranger, text="mentions a game")
        session.add(
            EventMention(post_id=mentioning_post.id, game_id=game.id, raw_token="#GameId")
        )
        session.commit()

        strategy = FollowsAndPreferredTeamStrategy(viewer.id, None)
        result = strategy.select_posts(session, before_id=None, limit=20)

        assert mentioning_post.id not in {p.id for p in result}


def test_guest_recent_strategy_is_a_feed_ranking_strategy():
    assert isinstance(GuestRecentStrategy(), FeedRankingStrategy)


def test_guest_recent_strategy_returns_all_top_level_posts_newest_first(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="grs_author")
        first = _make_post(session, author, text="first")
        second = _make_post(session, author, text="second")

        strategy = GuestRecentStrategy()
        result = strategy.select_posts(session, before_id=None, limit=20)

        assert [p.id for p in result] == [second.id, first.id]


def test_strategy_for_returns_guest_strategy_for_none_viewer():
    assert isinstance(strategy_for(None), GuestRecentStrategy)


def test_strategy_for_returns_follows_and_preferred_team_strategy_for_a_viewer(session_factory):
    with session_factory() as session:
        viewer = _make_user(session, username="sf_viewer")

        strategy = strategy_for(viewer)

        assert isinstance(strategy, FollowsAndPreferredTeamStrategy)
