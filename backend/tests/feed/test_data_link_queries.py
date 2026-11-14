"""POSTS-006: the previews stay batched. assemble_post_views collects a
page's links -- the reposted originals' included -- and calls events/'
game_final_previews, player_game_previews and player_career_previews once
each, skipping a call whose set is empty. So:

- a page of 2 and a page of 20 that between them carry all three link
  types, plus reposts of linked originals, issue the same number of
  statements, on GET /feed, GET /search/posts and GET /feed/thread/{id};
- a page with no links issues no preview statement at all (none reads
  games, player_game_stats, players or teams).

Counted with tests/feed/test_post_view_queries.py's statement recorder, and
equality, not an upper bound (task brief "Traps"). Each count also asserts
the previews are actually filled in, so an equal count cannot come from the
field being absent. Written before data_link_preview exists.
"""

from __future__ import annotations

import re
from datetime import date

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import (
    add_game,
    add_line,
    add_player,
    add_team,
    make_players_engine,
)
from tests.feed.data_link_support import (
    game_final,
    make_user,
    player_career,
    player_game,
    publish,
    read_client,
)
from tests.feed.test_post_view_queries import _record_statements

# A statement reading events/' tables: only the preview reads do, on these
# routes (a guest's feed asks for no team's games).
_PREVIEW_TABLES = re.compile(r"\b(games|player_game_stats|players|teams)\b", re.IGNORECASE)
_TYPES = {"game_final", "player_game", "player_career"}
_WORD = "countword"


@pytest.fixture()
def engine(postgres_url):
    engine = make_players_engine(postgres_url)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def client(session_factory):
    return read_client(session_factory)


def _targets(session, n: int) -> list[tuple[int, int, int]]:
    """`n` (game, line, player) triples: a completed game each, one played
    line in it, and that line's player (who therefore has a regular-season
    career)."""
    home, away = add_team(session, "BOS"), add_team(session, "LAL")
    triples = []
    for i in range(n):
        game = add_game(session, home=home, away=away, when=date(2024, 1, 1 + i), season="2023-24")
        player = add_player(session, "Player", f"N{i}")
        line = add_line(session, game=game, team=home, player=player, points=10 + i)
        triples.append((game.id, line.id, player.id))
    session.commit()
    return triples


def _links(triple: tuple[int, int, int]):
    game, line, player = triple
    return [game_final(game), player_game(line), player_career(player)]


def _seed_linked_page(session) -> None:
    """Linked originals (all three types), then 30 newer posts mixing direct
    linked posts, quote reposts with their own link and plain reposts of the
    linked originals. Every searchable text is exactly _WORD, so search
    ranks them equally and orders newest first. The two newest -- the page
    of 2 everywhere -- are a direct player_game post and, newest, a quote
    repost with its own career link of a game_final original: all three
    types between them."""
    author = make_user(session, "q_author")
    other = make_user(session, "q_other")
    targets = _targets(session, 12)

    originals = []  # (post id, link type)
    for i, triple in enumerate(targets[:9]):
        link = _links(triple)[i % 3]
        originals.append((publish(session, author.id, text=f"original {i}", link=link), link.type))

    for i in range(30):
        triple = targets[i % len(targets)]
        original_id, _ = originals[i % len(originals)]
        shape = i % 5
        if shape in (0, 1, 2):
            publish(session, other.id, text=_WORD, link=_links(triple)[shape])
        elif shape == 3:
            publish(
                session,
                other.id,
                text=_WORD,
                is_repost=True,
                original_post_id=original_id,
                link=_links(triple)[i % 3],
            )
        else:
            publish(session, other.id, is_repost=True, original_post_id=original_id)

    game_original = next(post_id for post_id, kind in originals if kind == "game_final")
    publish(session, other.id, text=_WORD, link=player_game(targets[0][1]))
    publish(
        session,
        other.id,
        text=_WORD,
        is_repost=True,
        original_post_id=game_original,
        link=player_career(targets[1][2]),
    )


def _carried_types(items: list[dict]) -> set[str]:
    """The link types a page carries, its reposted originals' included;
    asserts every link on the page has its preview filled in."""
    found = set()
    for item in items:
        for view in (item, item["reposted_post"]):
            if view is None or view["data_link"] is None:
                continue
            preview = view["data_link_preview"]
            assert preview is not None, view["id"]
            assert preview["type"] == view["data_link"]["type"]
            found.add(view["data_link"]["type"])
    return found


def _count(engine, client, path: str, params: dict) -> tuple[int, dict, list[str]]:
    statements, stop = _record_statements(engine)
    try:
        response = client.get(path, params=params)
    finally:
        stop()
    assert response.status_code == 200, response.text
    return len(statements), response.json(), statements


@pytest.mark.parametrize("path", ["/feed", "/search/posts"])
def test_a_linked_page_of_2_and_of_20_issue_the_same_number_of_statements(
    engine, session_factory, client, path
):
    with session_factory() as session:
        _seed_linked_page(session)
    extra = {"q": _WORD} if path == "/search/posts" else {}

    counts = {}
    for limit in (2, 20):
        n, body, _ = _count(engine, client, path, {"limit": limit, **extra})
        assert len(body["items"]) == limit
        assert _carried_types(body["items"]) == _TYPES, limit
        if limit == 20:
            assert any(
                item["reposted_post"] is not None and item["reposted_post"]["data_link"]
                for item in body["items"]
            )
        counts[limit] = n

    assert counts[20] == counts[2]


def _seed_thread(session, replies: int) -> int:
    """A quote repost with its own career link, of a game_final original,
    and `replies` replies to it."""
    author = make_user(session, f"t_author_{replies}")
    other = make_user(session, f"t_other_{replies}")
    [(game, _, player)] = _targets(session, 1)
    original = publish(session, author.id, text="original", link=game_final(game))
    root = publish(
        session,
        author.id,
        text="root",
        is_repost=True,
        original_post_id=original,
        link=player_career(player),
    )
    for n in range(replies):
        publish(session, other.id, text=f"reply {n}", is_reply=True, parent_post_id=root)
    return root


def test_a_linked_thread_of_2_and_of_20_replies_issue_the_same_number_of_statements(
    engine, session_factory, client
):
    with session_factory() as session:
        small_root = _seed_thread(session, 2)
        large_root = _seed_thread(session, 20)

    counts = {}
    for root, replies in ((small_root, 2), (large_root, 20)):
        n, body, _ = _count(engine, client, f"/feed/thread/{root}", {})
        assert len(body["replies"]) == replies
        assert _carried_types([body["root"]]) == {"player_career", "game_final"}
        assert all(reply["data_link_preview"] is None for reply in body["replies"])
        counts[replies] = n

    assert counts[20] == counts[2]


def _seed_unlinked(session) -> int:
    """Linkable targets exist, but no post links one: originals, direct
    posts, quote and plain reposts, and a root with replies. Returns the
    root's id."""
    _targets(session, 3)
    author = make_user(session, "u_author")
    other = make_user(session, "u_other")
    originals = [publish(session, author.id, text=f"original {i}") for i in range(5)]
    for i in range(20):
        original = originals[i % len(originals)]
        if i % 3 == 0:
            publish(session, other.id, text=_WORD)
        elif i % 3 == 1:
            publish(session, other.id, text=_WORD, is_repost=True, original_post_id=original)
        else:
            publish(session, other.id, is_repost=True, original_post_id=original)
    root = publish(session, author.id, text=_WORD)
    for n in range(3):
        publish(session, other.id, text=f"reply {n}", is_reply=True, parent_post_id=root)
    return root


def test_a_page_without_links_issues_no_preview_statement(engine, session_factory, client):
    with session_factory() as session:
        root = _seed_unlinked(session)

    for path, params, key in (
        ("/feed", {"limit": 20}, "items"),
        ("/search/posts", {"q": _WORD, "limit": 20}, "items"),
        (f"/feed/thread/{root}", {}, "replies"),
    ):
        _, body, statements = _count(engine, client, path, params)
        views = body[key] + ([body["root"]] if key == "replies" else [])
        assert views
        for view in views:
            assert view["data_link"] is None
            assert view["data_link_preview"] is None
        previews = [s for s in statements if _PREVIEW_TABLES.search(s)]
        assert previews == [], path
