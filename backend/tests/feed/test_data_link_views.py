"""POSTS-006: PostView -- on GET /feed, GET /search/posts and GET
/feed/thread/{id}, root and replies, and a repost's reposted_post -- gains
`data_link` (PostOut's {type, ref_id, scope} or null) and
`data_link_preview`: null without a link, else a discriminated union on
`type` carrying every field of events/' GameFinalPreview, PlayerGamePreview
or PlayerCareerPreview. Legacy EventMention rows keep producing
mentioned_game_ids and never populate either field. Written before either
field exists.

Spec: .ai/tasks/POSTS-006/task.json. Expected previews are read from
app.events.service's batch functions, the source the brief names, and each
response preview is compared with them field by field; a few concrete
figures are asserted too, so the comparison is never vacuous.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from itertools import count

import pytest
from sqlalchemy import update

from app.db import Base, make_session_factory
from app.events.models import Game, Player, PlayerGameStats
from app.events.service import (
    game_final_previews,
    player_career_previews,
    player_game_previews,
)
from app.posts.models import EventMention, Post
from tests.events.players_support import (
    add_game,
    add_line,
    add_player,
    add_team,
    make_players_engine,
)
from tests.feed.data_link_support import (
    assert_preview,
    game_final,
    link_json,
    make_user,
    player_career,
    player_game,
    publish,
    read_client,
)

_words = count(1)


def _word() -> str:
    """A searchable word unique to one post (letters only)."""
    n = next(_words)
    letters = ""
    while True:
        n, r = divmod(n, 26)
        letters += chr(ord("a") + r)
        if n == 0:
            break
    return f"previewword{letters}"


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


@dataclass(frozen=True)
class World:
    author_id: int
    other_id: int
    game: int  # completed regular-season game, BOS 100 - LAL 90
    other_game: int
    line: int  # the star's 30-point line in `game`
    star: int  # regular and playoff lines
    bench_line: int  # a played line, later turned into a DNP by a test
    bench: int  # one played regular line, the bench line


@pytest.fixture()
def world(session_factory) -> World:
    with session_factory() as session:
        author = make_user(session, "dlv_author")
        other = make_user(session, "dlv_other")
        home, away = add_team(session, "BOS"), add_team(session, "LAL")
        game = add_game(session, home=home, away=away, when=date(2024, 1, 10), season="2023-24")
        other_game = add_game(
            session, home=away, away=home, when=date(2024, 2, 1), season="2023-24"
        )
        playoff = add_game(
            session,
            home=home,
            away=away,
            when=date(2024, 4, 25),
            season="2023-24",
            game_type="playoffs",
        )
        star = add_player(session, "Jayson", "Tatum", position="F")
        bench = add_player(session, "Bench", "Guy")
        line = add_line(
            session,
            game=game,
            team=home,
            player=star,
            points=30,
            rebounds=8,
            assists=5,
            field_goals_made=11,
            field_goals_attempted=20,
            starter=True,
            seconds_played=2160,
        )
        add_line(session, game=other_game, team=home, player=star, points=20)
        add_line(session, game=playoff, team=home, player=star, points=25)
        bench_line = add_line(session, game=game, team=home, player=bench, points=4)
        session.commit()
        return World(
            author_id=author.id,
            other_id=other.id,
            game=game.id,
            other_game=other_game.id,
            line=line.id,
            star=star.id,
            bench_line=bench_line.id,
            bench=bench.id,
        )


# --------------------------------------------------------------- reading


def _feed_item(client, post_id: int) -> dict:
    response = client.get("/feed", params={"limit": 50})
    assert response.status_code == 200, response.text
    [item] = [item for item in response.json()["items"] if item["id"] == post_id]
    return item


def _search_item(client, word: str, post_id: int) -> dict:
    response = client.get("/search/posts", params={"q": word})
    assert response.status_code == 200, response.text
    [item] = [item for item in response.json()["items"] if item["id"] == post_id]
    return item


def _thread(client, post_id: int) -> dict:
    response = client.get(f"/feed/thread/{post_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _views(client, post_id: int, word: str | None) -> dict[str, dict]:
    """The post's view on every surface it appears on: feed, thread root,
    and search when it has text."""
    views = {"feed": _feed_item(client, post_id), "thread": _thread(client, post_id)["root"]}
    if word is not None:
        views["search"] = _search_item(client, word, post_id)
    return views


def _expected_preview(session_factory, kind: str, world: World):
    with session_factory() as session:
        if kind == "game_final":
            return "game_final", game_final_previews(session, [world.game])[world.game]
        if kind == "player_game":
            return "player_game", player_game_previews(session, [world.line])[world.line]
        scope = kind.removeprefix("player_career_")
        key = (world.star, scope)
        return "player_career", player_career_previews(session, [key])[key]


def _link(kind: str, world: World):
    if kind == "game_final":
        return game_final(world.game)
    if kind == "player_game":
        return player_game(world.line)
    return player_career(world.star, kind.removeprefix("player_career_"))


KINDS = ["game_final", "player_game", "player_career_regular", "player_career_playoffs"]


# ------------------------------------------------ criterion 4: each type


@pytest.mark.parametrize("kind", KINDS)
def test_each_surface_carries_the_data_link_and_its_full_preview(
    client, session_factory, world, kind
):
    word = _word()
    link = _link(kind, world)
    with session_factory() as session:
        post_id = publish(session, world.author_id, text=f"look {word}", link=link)
    type_, expected = _expected_preview(session_factory, kind, world)

    for surface, view in _views(client, post_id, word).items():
        assert view["data_link"] == link_json(link), surface
        assert_preview(view["data_link_preview"], type_, expected)


def test_the_previews_carry_the_destination_ids_and_real_figures(client, session_factory, world):
    with session_factory() as session:
        final_id = publish(session, world.author_id, text="final", link=game_final(world.game))
        line_id = publish(session, world.author_id, text="line", link=player_game(world.line))
        career_id = publish(
            session, world.author_id, text="career", link=player_career(world.star, "playoffs")
        )

    final = _feed_item(client, final_id)["data_link_preview"]
    assert (final["game_id"], final["home_score"], final["away_score"]) == (world.game, 100, 90)
    assert final["home_team"]["abbreviation"] == "BOS"

    line = _feed_item(client, line_id)["data_link_preview"]
    assert (line["line_id"], line["game_id"], line["player_id"]) == (
        world.line,
        world.game,
        world.star,
    )
    assert (line["points"], line["rebounds"], line["assists"]) == (30, 8, 5)
    assert line["field_goal_pct"] == pytest.approx(0.55)
    assert line["opponent"]["abbreviation"] == "LAL"

    career = _feed_item(client, career_id)["data_link_preview"]
    assert (career["player_id"], career["scope"], career["games_played"]) == (
        world.star,
        "playoffs",
        1,
    )
    assert career["points_per_game"] == pytest.approx(25.0)


def test_game_final_preview_exposes_stored_period_scores(client, session_factory, world):
    with session_factory() as session:
        game = session.get(Game, world.game)
        assert game is not None
        game.home_line_score = [25, 25, 25, 25]
        game.away_line_score = [20, 20, 25, 25]
        post_id = publish(session, world.author_id, text="periods", link=game_final(world.game))
        session.commit()

    preview = _feed_item(client, post_id)["data_link_preview"]

    assert preview["home_line_score"] == [25, 25, 25, 25]
    assert preview["away_line_score"] == [20, 20, 25, 25]


@pytest.mark.parametrize("surface", ["feed", "search", "thread"])
def test_a_post_without_a_link_has_both_fields_null(client, session_factory, world, surface):
    word = _word()
    with session_factory() as session:
        post_id = publish(session, world.author_id, text=f"nothing attached {word}")

    view = _views(client, post_id, word)[surface]

    assert "data_link" in view
    assert "data_link_preview" in view
    assert view["data_link"] is None
    assert view["data_link_preview"] is None


def test_thread_replies_carry_both_fields_null_under_a_linked_root(client, session_factory, world):
    with session_factory() as session:
        root = publish(session, world.author_id, text="root", link=game_final(world.game))
        publish(session, world.other_id, text="reply one", is_reply=True, parent_post_id=root)
        publish(session, world.other_id, text="reply two", is_reply=True, parent_post_id=root)

    body = _thread(client, root)

    assert body["root"]["data_link"] == link_json(game_final(world.game))
    assert body["root"]["data_link_preview"]["game_id"] == world.game
    assert len(body["replies"]) == 2
    for reply in body["replies"]:
        assert "data_link" in reply
        assert "data_link_preview" in reply
        assert reply["data_link"] is None
        assert reply["data_link_preview"] is None


# ----------------------------------------------- criterion 5: reposts


@pytest.mark.parametrize("surface", ["feed", "thread"])
def test_a_plain_repost_carries_null_and_its_reposted_post_the_originals(
    client, session_factory, world, surface
):
    with session_factory() as session:
        original = publish(session, world.author_id, text="the line", link=player_game(world.line))
        repost = publish(session, world.other_id, is_repost=True, original_post_id=original)
    _, expected = _expected_preview(session_factory, "player_game", world)

    view = _views(client, repost, None)[surface]

    assert view["data_link"] is None
    assert view["data_link_preview"] is None
    inner = view["reposted_post"]
    assert inner["id"] == original
    assert inner["data_link"] == link_json(player_game(world.line))
    assert_preview(inner["data_link_preview"], "player_game", expected)


@pytest.mark.parametrize("surface", ["feed", "search", "thread"])
def test_a_quote_repost_carries_its_own_link_and_its_reposted_post_the_originals(
    client, session_factory, world, surface
):
    word = _word()
    with session_factory() as session:
        original = publish(session, world.author_id, text="final", link=game_final(world.game))
        quote = publish(
            session,
            world.other_id,
            text=f"and his career {word}",
            is_repost=True,
            original_post_id=original,
            link=player_career(world.star, "regular"),
        )
    _, career = _expected_preview(session_factory, "player_career_regular", world)
    _, final = _expected_preview(session_factory, "game_final", world)

    view = _views(client, quote, word)[surface]

    assert view["data_link"] == link_json(player_career(world.star, "regular"))
    assert_preview(view["data_link_preview"], "player_career", career)
    inner = view["reposted_post"]
    assert inner["id"] == original
    assert inner["data_link"] == link_json(game_final(world.game))
    assert_preview(inner["data_link_preview"], "game_final", final)


# -------------------------------- criterion 6: as stored, computed live


def test_a_dnp_line_preview_is_returned_as_stored(client, session_factory, world):
    """A DNP line can't be linked at create (the validator refuses it), so
    the linked line is turned into a DNP afterwards."""
    with session_factory() as session:
        post_id = publish(
            session, world.author_id, text="bench", link=player_game(world.bench_line)
        )
        session.execute(
            update(PlayerGameStats)
            .where(PlayerGameStats.id == world.bench_line)
            .values(seconds_played=None, dnp_reason="DNP - Rest", points=0)
        )
        session.commit()
    with session_factory() as session:
        expected = player_game_previews(session, [world.bench_line])[world.bench_line]

    preview = _feed_item(client, post_id)["data_link_preview"]

    assert_preview(preview, "player_game", expected)
    assert preview["seconds_played"] is None
    assert preview["dnp_reason"] == "DNP - Rest"
    assert preview["points"] == 0
    assert preview["field_goal_pct"] is None


def test_a_career_preview_with_null_figures_is_returned_as_stored(client, session_factory, world):
    """The bench player's one played line becomes a DNP after the post: no
    played game left in scope, so the averages are null, not zero."""
    with session_factory() as session:
        post_id = publish(
            session, world.author_id, text="career", link=player_career(world.bench, "regular")
        )
        session.execute(
            update(PlayerGameStats)
            .where(PlayerGameStats.id == world.bench_line)
            .values(seconds_played=None, dnp_reason="DNP - Rest", points=0)
        )
        session.commit()
    key = (world.bench, "regular")
    with session_factory() as session:
        expected = player_career_previews(session, [key])[key]

    preview = _feed_item(client, post_id)["data_link_preview"]

    assert_preview(preview, "player_career", expected)
    assert preview["games_played"] == 0
    for figure in ("points_per_game", "rebounds_per_game", "assists_per_game", "field_goal_pct"):
        assert preview[figure] is None, figure


def test_a_career_preview_reflects_a_line_added_after_the_post(client, session_factory, world):
    with session_factory() as session:
        post_id = publish(
            session, world.author_id, text="career", link=player_career(world.star, "regular")
        )

    before = _feed_item(client, post_id)["data_link_preview"]
    assert before["games_played"] == 2
    assert before["points_per_game"] == pytest.approx(25.0)

    with session_factory() as session:
        home, away = add_team(session, "NYK"), add_team(session, "MIA")
        game = add_game(session, home=home, away=away, when=date(2024, 3, 1), season="2023-24")
        star = session.get_one(Player, world.star)
        add_line(session, game=game, team=home, player=star, points=55)
        session.commit()

    after = _feed_item(client, post_id)["data_link_preview"]
    assert after["games_played"] == 3
    assert after["points_per_game"] == pytest.approx(35.0)


# ----------------------------------- criterion 10: legacy EventMentions


def _legacy_post(session, author_id: int, text: str, game_ids, **fields) -> int:
    """A post as written before POSTS-006: its EventMention rows inserted
    directly, no link."""
    post = Post(author_id=author_id, text=text, **fields)
    session.add(post)
    session.flush()
    for game_id in game_ids:
        session.add(EventMention(post_id=post.id, game_id=game_id, raw_token=f"#GameId{game_id}"))
    session.commit()
    return post.id


@pytest.mark.parametrize("surface", ["feed", "search", "thread"])
def test_an_old_post_mentioning_several_games_keeps_them_and_no_link(
    client, session_factory, world, surface
):
    word = _word()
    with session_factory() as session:
        post_id = _legacy_post(
            session, world.author_id, f"two games {word}", [world.game, world.other_game]
        )

    view = _views(client, post_id, word)[surface]

    assert sorted(view["mentioned_game_ids"]) == sorted([world.game, world.other_game])
    assert view["data_link"] is None
    assert view["data_link_preview"] is None


@pytest.mark.parametrize("surface", ["search", "thread"])
def test_an_old_reply_with_a_mention_keeps_it_and_no_link(client, session_factory, world, surface):
    word = _word()
    with session_factory() as session:
        root = publish(session, world.author_id, text="root post")
        reply = _legacy_post(
            session,
            world.other_id,
            f"old reply {word}",
            [world.game],
            is_reply=True,
            parent_post_id=root,
        )

    if surface == "thread":
        [view] = [r for r in _thread(client, root)["replies"] if r["id"] == reply]
    else:
        view = _search_item(client, word, reply)

    assert view["mentioned_game_ids"] == [world.game]
    assert view["data_link"] is None
    assert view["data_link_preview"] is None


def test_a_linked_post_has_no_mentioned_game_ids(client, session_factory, world):
    """A link never turns into a mention: mentioned_game_ids reads rows only."""
    with session_factory() as session:
        post_id = publish(session, world.author_id, text="final", link=game_final(world.game))

    view = _feed_item(client, post_id)

    assert view["mentioned_game_ids"] == []
    assert view["data_link"] == link_json(game_final(world.game))
