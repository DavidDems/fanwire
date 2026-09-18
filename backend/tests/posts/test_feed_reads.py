"""Tests for the feed/-facing public read functions added to
app.posts.service (per AGENTS.md's connection rule: feed/ never queries
another module's tables directly, so posts/ exposes these instead),
per AGENTS.md TDD workflow. Written before the functions exist.

query_feed_posts: top-level posts only (is_reply=false; reposts included),
newest-first by id, `id < before_id` when given. author_ids/mentioned_game_ids
are OR'd (no duplicates); both None means all posts (guest). Posts whose
author is soft-deleted are excluded.

like_counts / liked_post_ids / mentioned_game_ids_by_post: batch lookups
keyed by post id, for feed/'s view assembly to call once per page (no N+1).

replies_to: direct replies only, oldest first, excluding soft-deleted
authors.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team
from app.posts.models import EventMention, Post
from app.posts.service import (
    like_counts,
    liked_post_ids,
    mentioned_game_ids_by_post,
    query_feed_posts,
    replies_to,
)
from app.users.models import User


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
        "username": "feed_reads_user",
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
        "api_sports_team_id": overrides.pop("api_sports_team_id", 1),
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


# --- query_feed_posts --------------------------------------------------


def test_query_feed_posts_excludes_replies(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="qfp_author1")
        top = _make_post(session, author, text="top level")
        _make_post(session, author, text="a reply", is_reply=True, parent_post_id=top.id)

        result = query_feed_posts(
            session, author_ids=None, mentioned_game_ids=None, before_id=None, limit=20
        )

        assert [p.text for p in result] == ["top level"]


def test_query_feed_posts_includes_reposts(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="qfp_author2")
        original = _make_post(session, author, text="original")
        repost = Post(author_id=author.id, is_repost=True, original_post_id=original.id)
        session.add(repost)
        session.commit()

        result = query_feed_posts(
            session, author_ids=None, mentioned_game_ids=None, before_id=None, limit=20
        )

        ids = {p.id for p in result}
        assert repost.id in ids
        assert original.id in ids


def test_query_feed_posts_both_none_returns_all_top_level_posts(session_factory):
    with session_factory() as session:
        author1 = _make_user(session, username="qfp_all1")
        author2 = _make_user(session, username="qfp_all2")
        _make_post(session, author1)
        _make_post(session, author2)

        result = query_feed_posts(
            session, author_ids=None, mentioned_game_ids=None, before_id=None, limit=20
        )

        assert len(result) == 2


def test_query_feed_posts_filters_by_author_ids(session_factory):
    with session_factory() as session:
        included = _make_user(session, username="qfp_included")
        excluded = _make_user(session, username="qfp_excluded")
        wanted = _make_post(session, included, text="wanted")
        _make_post(session, excluded, text="not wanted")

        result = query_feed_posts(
            session,
            author_ids=[included.id],
            mentioned_game_ids=None,
            before_id=None,
            limit=20,
        )

        assert [p.id for p in result] == [wanted.id]


def test_query_feed_posts_filters_by_mentioned_game_ids(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="qfp_mention_author")
        home = _make_team(session, api_sports_team_id=101)
        away = _make_team(session, api_sports_team_id=102)
        game = _make_game(session, home, away, api_sports_game_id=6001)
        other_game = _make_game(session, home, away, api_sports_game_id=6002)

        mentioning = _make_post(session, author, text="mentions the game")
        session.add(EventMention(post_id=mentioning.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        not_mentioning = _make_post(session, author, text="mentions a different game")
        session.add(
            EventMention(post_id=not_mentioning.id, game_id=other_game.id, raw_token="#GameId")
        )
        session.commit()

        no_mention = _make_post(session, author, text="no mention at all")

        result = query_feed_posts(
            session,
            author_ids=None,
            mentioned_game_ids=[game.id],
            before_id=None,
            limit=20,
        )

        ids = {p.id for p in result}
        assert ids == {mentioning.id}
        assert not_mentioning.id not in ids
        assert no_mention.id not in ids


def test_query_feed_posts_ors_author_and_mention_filters_without_duplicates(session_factory):
    with session_factory() as session:
        followed_author = _make_user(session, username="qfp_or_followed")
        other_author = _make_user(session, username="qfp_or_other")
        home = _make_team(session, api_sports_team_id=201)
        away = _make_team(session, api_sports_team_id=202)
        game = _make_game(session, home, away, api_sports_game_id=7001)

        # Satisfies BOTH conditions -- must appear exactly once.
        both = _make_post(session, followed_author, text="both")
        session.add(EventMention(post_id=both.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        author_only = _make_post(session, followed_author, text="author only")
        mention_only = _make_post(session, other_author, text="mention only")
        session.add(EventMention(post_id=mention_only.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        neither = _make_post(session, other_author, text="neither")

        result = query_feed_posts(
            session,
            author_ids=[followed_author.id],
            mentioned_game_ids=[game.id],
            before_id=None,
            limit=20,
        )

        ids = [p.id for p in result]
        assert sorted(ids) == sorted([both.id, author_only.id, mention_only.id])
        assert len(ids) == len(set(ids))  # no duplicates
        assert neither.id not in ids


def test_query_feed_posts_excludes_soft_deleted_author(session_factory):
    with session_factory() as session:
        active = _make_user(session, username="qfp_active")
        deleted = _make_user(session, username="qfp_deleted", deleted_at=datetime.now(UTC))
        _make_post(session, active, text="from active author")
        _make_post(session, deleted, text="from deleted author")

        result = query_feed_posts(
            session, author_ids=None, mentioned_game_ids=None, before_id=None, limit=20
        )

        assert [p.text for p in result] == ["from active author"]


def test_query_feed_posts_orders_newest_first_and_paginates_with_before_id(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="qfp_page_author")
        first = _make_post(session, author, text="first")
        second = _make_post(session, author, text="second")
        third = _make_post(session, author, text="third")

        page1 = query_feed_posts(
            session, author_ids=None, mentioned_game_ids=None, before_id=None, limit=2
        )
        assert [p.id for p in page1] == [third.id, second.id]

        page2 = query_feed_posts(
            session,
            author_ids=None,
            mentioned_game_ids=None,
            before_id=page1[-1].id,
            limit=2,
        )
        assert [p.id for p in page2] == [first.id]


# --- like_counts / liked_post_ids ---------------------------------------


def test_like_counts_counts_likes_per_post(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="lc_author")
        liker1 = _make_user(session, username="lc_liker1")
        liker2 = _make_user(session, username="lc_liker2")
        liked_twice = _make_post(session, author, text="liked twice")
        liked_once = _make_post(session, author, text="liked once")
        unliked = _make_post(session, author, text="unliked")

        from app.posts.service import like_post

        like_post(session, user_id=liker1.id, post_id=liked_twice.id)
        like_post(session, user_id=liker2.id, post_id=liked_twice.id)
        like_post(session, user_id=liker1.id, post_id=liked_once.id)

        result = like_counts(session, [liked_twice.id, liked_once.id, unliked.id])

        assert result == {liked_twice.id: 2, liked_once.id: 1}


def test_like_counts_empty_post_ids_returns_empty_dict(session_factory):
    with session_factory() as session:
        assert like_counts(session, []) == {}


def test_liked_post_ids_returns_only_posts_liked_by_given_user(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="lpi_author")
        viewer = _make_user(session, username="lpi_viewer")
        other = _make_user(session, username="lpi_other")
        liked_by_viewer = _make_post(session, author, text="liked by viewer")
        liked_by_other = _make_post(session, author, text="liked by other")

        from app.posts.service import like_post

        like_post(session, user_id=viewer.id, post_id=liked_by_viewer.id)
        like_post(session, user_id=other.id, post_id=liked_by_other.id)

        result = liked_post_ids(session, viewer.id, [liked_by_viewer.id, liked_by_other.id])

        assert result == {liked_by_viewer.id}


# --- mentioned_game_ids_by_post ------------------------------------------


def test_mentioned_game_ids_by_post_groups_by_post(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="mgibp_author")
        home = _make_team(session, api_sports_team_id=301)
        away = _make_team(session, api_sports_team_id=302)
        game1 = _make_game(session, home, away, api_sports_game_id=8001)
        game2 = _make_game(session, home, away, api_sports_game_id=8002)

        post = _make_post(session, author, text="mentions two games")
        session.add_all(
            [
                EventMention(post_id=post.id, game_id=game1.id, raw_token="#GameId"),
                EventMention(post_id=post.id, game_id=game2.id, raw_token="#GameId"),
            ]
        )
        session.commit()
        unmentioned = _make_post(session, author, text="no mention")

        result = mentioned_game_ids_by_post(session, [post.id, unmentioned.id])

        assert set(result[post.id]) == {game1.id, game2.id}
        assert unmentioned.id not in result


# --- replies_to -----------------------------------------------------------


def test_replies_to_returns_direct_replies_oldest_first(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="rt_author")
        root = _make_post(session, author, text="root")
        base = datetime(2026, 1, 1, tzinfo=UTC)
        newer = Post(
            author_id=author.id,
            text="newer",
            is_reply=True,
            parent_post_id=root.id,
            created_at=base + timedelta(minutes=5),
        )
        older = Post(
            author_id=author.id,
            text="older",
            is_reply=True,
            parent_post_id=root.id,
            created_at=base,
        )
        session.add_all([newer, older])
        session.commit()

        result = replies_to(session, root.id)

        assert [p.text for p in result] == ["older", "newer"]


def test_replies_to_excludes_soft_deleted_authors(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="rt_sd_author")
        deleted_replier = _make_user(
            session, username="rt_sd_replier", deleted_at=datetime.now(UTC)
        )
        root = _make_post(session, author, text="root")
        session.add(
            Post(
                author_id=deleted_replier.id,
                text="reply from deleted author",
                is_reply=True,
                parent_post_id=root.id,
            )
        )
        session.commit()

        result = replies_to(session, root.id)

        assert result == []
