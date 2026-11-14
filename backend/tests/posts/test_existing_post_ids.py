"""POSTS-007: app.posts.service.existing_post_ids, how notifications/ learns
that a repost was undone. A plain repost's undo hard-deletes its row, which
deleted_post_ids cannot see: that one finds soft-deleted rows, and a
hard-deleted row is simply absent. Written before the function exists, so it
is imported inside each test and the rest of the suite still collects.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import event

from app.db import Base, make_engine, make_session_factory
from app.posts.models import Post
from app.posts.service import delete_post, deleted_post_ids
from app.users.models import User

NO_SUCH_POST = 999_000_000


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def posts(session_factory):
    with session_factory() as session:
        author = User(cognito_sub="sub-exists", username="exists", date_of_birth=date(1990, 1, 1))
        session.add(author)
        session.commit()
        live = Post(author_id=author.id, text="live")
        gone = Post(author_id=author.id, text="soft deleted")
        session.add_all([live, gone])
        session.commit()
        delete_post(session, user_id=author.id, post_id=gone.id)
    return {"live": live.id, "soft_deleted": gone.id}


def _statements_during(engine, action) -> list[str]:
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        action()
    finally:
        event.remove(engine, "before_cursor_execute", _record)
    return statements


def test_existing_post_ids_returns_the_rows_that_exist_soft_deleted_included(
    session_factory, posts
):
    from app.posts.service import existing_post_ids

    with session_factory() as session:
        found = existing_post_ids(session, [posts["live"], posts["soft_deleted"], NO_SUCH_POST])

    assert found == {posts["live"], posts["soft_deleted"]}


def test_existing_post_ids_runs_one_query(engine, session_factory, posts):
    from app.posts.service import existing_post_ids

    with session_factory() as session:
        statements = _statements_during(
            engine,
            lambda: existing_post_ids(
                session, [posts["live"], posts["soft_deleted"], NO_SUCH_POST]
            ),
        )

    assert len(statements) == 1


def test_existing_post_ids_runs_no_query_for_empty_input(engine, session_factory):
    from app.posts.service import existing_post_ids

    with session_factory() as session:
        results: list[set[int]] = []
        statements = _statements_during(
            engine, lambda: results.append(existing_post_ids(session, []))
        )

    assert statements == []
    assert results == [set()]


def test_deleted_post_ids_is_unchanged(session_factory, posts):
    with session_factory() as session:
        found = deleted_post_ids(session, [posts["live"], posts["soft_deleted"], NO_SUCH_POST])

    assert found == {posts["soft_deleted"]}
