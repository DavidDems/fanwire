"""POSTS-006: preferred-team relevance counts a post's attachment. For a
viewer with preferred_team_id, GET /feed includes an unfollowed author's
post whose linked_game_id -- or, for a player_game link, the stored
linked_line_game_id -- is a game of that team, alongside a legacy
EventMention of one as before. A player_career link never counts (a career
isn't a fact about one team), nor does a link to another team's game. Each
post appears once. Written before relevance reads either column.

Linked posts are created through PublishPostFacade, so the line's game is
stored the way POST /posts stores it.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db import Base, make_session_factory
from app.posts.models import EventMention, Post
from app.users.models import Follow
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


@pytest.fixture()
def engine(postgres_url):
    engine = make_players_engine(postgres_url)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


def _legacy_mention(session, author_id: int, game_id: int, **fields) -> int:
    post = Post(author_id=author_id, text="old mention", **fields)
    session.add(post)
    session.flush()
    session.add(EventMention(post_id=post.id, game_id=game_id, raw_token=f"#GameId{game_id}"))
    session.commit()
    return post.id


@pytest.fixture()
def seeded(session_factory):
    """BOS is the viewer's team. BOS plays LAL; NYK plays MIA. The authors
    are strangers to the viewer except `friend`."""
    with session_factory() as session:
        bos, lal = add_team(session, "BOS"), add_team(session, "LAL")
        nyk, mia = add_team(session, "NYK"), add_team(session, "MIA")
        team_game = add_game(session, home=bos, away=lal, when=date(2024, 1, 10), season="2023-24")
        away_team_game = add_game(
            session, home=lal, away=bos, when=date(2024, 1, 20), season="2023-24"
        )
        other_game = add_game(session, home=nyk, away=mia, when=date(2024, 1, 11), season="2023-24")
        bos_player = add_player(session, "Bos", "Player")
        lal_player = add_player(session, "Lal", "Player")
        nyk_player = add_player(session, "Nyk", "Player")
        bos_line = add_line(session, game=team_game, team=bos, player=bos_player, points=20)
        # The opponent's line in a BOS game: the game is BOS's, so it counts.
        lal_line = add_line(session, game=away_team_game, team=lal, player=lal_player, points=15)
        nyk_line = add_line(session, game=other_game, team=nyk, player=nyk_player, points=10)
        session.commit()

        viewer = make_user(session, "rel_viewer", preferred_team_id=bos.id)
        stranger = make_user(session, "rel_stranger")
        friend = make_user(session, "rel_friend")
        session.add(Follow(follower_user_id=viewer.id, followed_user_id=friend.id))
        session.commit()

        included = {
            "game_final_of_team": publish(
                session, stranger.id, text="final", link=game_final(team_game.id)
            ),
            "game_final_of_team_away": publish(
                session, stranger.id, text="final away", link=game_final(away_team_game.id)
            ),
            "line_in_team_game": publish(
                session, stranger.id, text="line", link=player_game(bos_line.id)
            ),
            "opponent_line_in_team_game": publish(
                session, stranger.id, text="opp line", link=player_game(lal_line.id)
            ),
            "quote_with_line_in_team_game": publish(
                session,
                stranger.id,
                text="quote",
                is_repost=True,
                original_post_id=publish(session, stranger.id, text="unrelated original"),
                link=player_game(bos_line.id),
            ),
            "legacy_mention": _legacy_mention(session, stranger.id, team_game.id),
            # Followed and relevant: still once.
            "friend_game_final_of_team": publish(
                session, friend.id, text="friend final", link=game_final(team_game.id)
            ),
        }
        excluded = {
            "career_of_team_player": publish(
                session, stranger.id, text="career", link=player_career(bos_player.id)
            ),
            "game_final_of_other_team": publish(
                session, stranger.id, text="other final", link=game_final(other_game.id)
            ),
            "line_in_other_game": publish(
                session, stranger.id, text="other line", link=player_game(nyk_line.id)
            ),
            "legacy_mention_of_other_game": _legacy_mention(session, stranger.id, other_game.id),
            "no_link": publish(session, stranger.id, text="nothing"),
        }
        session.refresh(viewer)
        session.expunge(viewer)
    return viewer, included, excluded


def _feed_ids(session_factory, viewer) -> list[int]:
    client = read_client(session_factory, viewer)
    response = client.get("/feed", params={"limit": 50})
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


@pytest.mark.parametrize(
    "name",
    [
        "game_final_of_team",
        "game_final_of_team_away",
        "line_in_team_game",
        "opponent_line_in_team_game",
        "quote_with_line_in_team_game",
        "legacy_mention",
        "friend_game_final_of_team",
    ],
)
def test_the_preferred_team_feed_includes_a_link_to_a_game_of_that_team(
    session_factory, seeded, name
):
    viewer, included, _ = seeded

    assert included[name] in _feed_ids(session_factory, viewer)


@pytest.mark.parametrize(
    "name",
    [
        "career_of_team_player",
        "game_final_of_other_team",
        "line_in_other_game",
        "legacy_mention_of_other_game",
        "no_link",
    ],
)
def test_the_preferred_team_feed_excludes_careers_and_other_teams_games(
    session_factory, seeded, name
):
    viewer, _, excluded = seeded

    assert excluded[name] not in _feed_ids(session_factory, viewer)


def test_the_preferred_team_feed_is_exactly_the_relevant_posts_each_once(session_factory, seeded):
    viewer, included, _ = seeded

    ids = _feed_ids(session_factory, viewer)

    assert len(ids) == len(set(ids))
    assert set(ids) == set(included.values())


def test_a_post_with_both_a_link_and_a_legacy_mention_of_the_team_appears_once(
    session_factory, seeded
):
    """Not a shape POST /posts makes, but rows written directly can hold
    both: the OR of the conditions must not multiply the post."""
    viewer, included, _ = seeded
    post_id = included["game_final_of_team"]
    with session_factory() as session:
        game_id = session.get(Post, post_id).linked_game_id
        session.add(EventMention(post_id=post_id, game_id=game_id, raw_token=f"#GameId{game_id}"))
        session.commit()

    ids = _feed_ids(session_factory, viewer)

    assert ids.count(post_id) == 1
