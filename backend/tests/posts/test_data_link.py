"""POSTS-005: a non-reply post carries one sports-data attachment
(`data_link` on POST /posts), stored as nullable foreign keys on posts
(linked_game_id, linked_player_game_stats_id, linked_player_id,
linked_player_scope) behind four CHECK constraints, shape-checked at the
boundary and target-checked through app.events.service's EVENTS-009
validators. Written before the columns, the request field or PostOut's
`data_link` exist.

Spec: .ai/tasks/POSTS-005/task.json. Runs end to end on app.main's app, the
harness of tests/posts/test_soft_delete.py: get_token_verifier,
get_session, get_event_bus and get_moderation_chain are overridden, the
chain with a pass-through so this file tests attachments, not the spam
scorer or the post rate limit (tests/posts/test_rate_limit_routes.py and
test_spam_routes.py keep those). The in-memory publisher is kept so a test
can tell nothing was published.

The new Post attributes are only ever passed as constructor keywords or
read with getattr inside a test, so a missing column fails its own tests
(a TypeError or AttributeError), never the module.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db import Base, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.main import app as main_app
from app.media.models import Media, MediaStatus
from app.posts.dependencies import get_moderation_chain
from app.posts.models import EventMention, Post
from app.posts.moderation import ModerationCheck, ModerationContext
from app.users.auth import FakeTokenVerifier, VerifiedIdentity
from app.users.dependencies import get_token_verifier
from app.users.service import create_user
from tests.events.players_support import (
    add_game,
    add_line,
    add_player,
    add_team,
    make_players_engine,
)

TOKEN = {"Authorization": "Bearer unchanged-token"}
LINK_COLUMNS = (
    "linked_game_id",
    "linked_player_game_stats_id",
    "linked_player_id",
    "linked_player_scope",
)
MISSING = 987_654_321  # no game, box-score line or player has this id


class _PassThrough(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_players_engine(postgres_url)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def publisher():
    return InMemoryEventPublisher()


@pytest.fixture()
def app(session_factory, publisher):
    saved = dict(main_app.dependency_overrides)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    main_app.dependency_overrides[get_session] = _get_session_override
    main_app.dependency_overrides[get_event_bus] = lambda: PostEventBus(publisher)
    main_app.dependency_overrides[get_moderation_chain] = lambda: _PassThrough()
    yield main_app
    main_app.dependency_overrides.clear()
    main_app.dependency_overrides.update(saved)


@pytest.fixture()
def client(app):
    return TestClient(app)


@dataclass(frozen=True)
class Targets:
    """Ids of one of each attachment target, valid and refused."""

    author_id: int
    author_sub: str
    completed_game: int
    unplayed_game: int  # 0-0: Game.completed is false
    played_line: int
    dnp_line: int
    career_player: int  # played regular and playoff games
    regular_only_player: int  # played regular games only


@pytest.fixture()
def targets(session_factory, app) -> Targets:
    with session_factory() as session:
        user = create_user(
            session,
            cognito_sub="sub-linker",
            username="linker",
            date_of_birth=date(1990, 1, 1),
        )
        home, away = add_team(session, "BOS"), add_team(session, "LAL")
        regular = add_game(session, home=home, away=away, when=date(2024, 1, 10), season="2023-24")
        playoff = add_game(
            session,
            home=home,
            away=away,
            when=date(2024, 4, 25),
            season="2023-24",
            game_type="playoffs",
        )
        unplayed = add_game(
            session,
            home=home,
            away=away,
            when=date(2024, 1, 12),
            season="2023-24",
            home_score=0,
            away_score=0,
        )
        career = add_player(session, "Jayson", "Tatum")
        regular_only = add_player(session, "Bench", "Guy")
        benched = add_player(session, "Never", "Played")
        played_line = add_line(session, game=regular, team=home, player=career, points=30)
        add_line(session, game=playoff, team=home, player=career, points=25)
        add_line(session, game=regular, team=home, player=regular_only)
        dnp_line = add_line(
            session,
            game=regular,
            team=home,
            player=benched,
            seconds_played=None,
            dnp_reason="DNP - Coach's Decision",
        )
        session.commit()
        found = Targets(
            author_id=user.id,
            author_sub="sub-linker",
            completed_game=regular.id,
            unplayed_game=unplayed.id,
            played_line=played_line.id,
            dnp_line=dnp_line.id,
            career_player=career.id,
            regular_only_player=regular_only.id,
        )
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub=found.author_sub)
    )
    return found


def _post_count(session_factory) -> int:
    with session_factory() as session:
        return session.scalar(select(func.count()).select_from(Post))


def _links(session_factory, post_id: int) -> dict[str, object]:
    with session_factory() as session:
        post = session.get(Post, post_id)
        return {column: getattr(post, column) for column in LINK_COLUMNS}


def _a_post(session_factory, author_id: int, **fields) -> int:
    with session_factory() as session:
        post = Post(author_id=author_id, **fields)
        session.add(post)
        session.commit()
        return post.id


def _processed_media(session_factory, uploader_id: int) -> int:
    with session_factory() as session:
        media = Media(uploader_id=uploader_id, status=MediaStatus.PROCESSED)
        session.add(media)
        session.commit()
        return media.id


def _media_post_id(session_factory, media_id: int) -> int | None:
    with session_factory() as session:
        return session.get(Media, media_id).post_id


def _game_final(t: Targets) -> dict:
    return {"type": "game_final", "ref_id": t.completed_game}


# ------------------------------------------------- criterion 2: the database


@pytest.fixture()
def db_targets(targets, session_factory):
    """`targets`, plus an original post to reply to."""
    parent = _a_post(session_factory, targets.author_id, text="the original")
    return targets, parent


def _insert(session_factory, author_id: int, **fields) -> None:
    with session_factory() as session:
        session.add(Post(author_id=author_id, text="a post", **fields))
        session.commit()


def test_a_post_stores_each_kind_of_link_directly(db_targets, session_factory):
    t, _ = db_targets
    for fields in (
        {"linked_game_id": t.completed_game},
        {"linked_player_game_stats_id": t.played_line},
        {"linked_player_id": t.career_player, "linked_player_scope": "regular"},
        {"linked_player_id": t.career_player, "linked_player_scope": "playoffs"},
    ):
        post_id = _a_post(session_factory, t.author_id, text="linked", **fields)
        assert _links(session_factory, post_id) == {
            column: fields.get(column) for column in LINK_COLUMNS
        }


def _violations(t: Targets, parent: int) -> dict[str, dict]:
    return {
        "game_and_line": {
            "linked_game_id": t.completed_game,
            "linked_player_game_stats_id": t.played_line,
        },
        "game_and_player": {
            "linked_game_id": t.completed_game,
            "linked_player_id": t.career_player,
            "linked_player_scope": "regular",
        },
        "line_and_player": {
            "linked_player_game_stats_id": t.played_line,
            "linked_player_id": t.career_player,
            "linked_player_scope": "regular",
        },
        "game_on_reply": {
            "is_reply": True,
            "parent_post_id": parent,
            "linked_game_id": t.completed_game,
        },
        "line_on_reply": {
            "is_reply": True,
            "parent_post_id": parent,
            "linked_player_game_stats_id": t.played_line,
        },
        "player_on_reply": {
            "is_reply": True,
            "parent_post_id": parent,
            "linked_player_id": t.career_player,
            "linked_player_scope": "regular",
        },
        "player_without_scope": {"linked_player_id": t.career_player},
        "scope_without_player": {"linked_player_scope": "regular"},
        "play_in_scope": {"linked_player_id": t.career_player, "linked_player_scope": "play-in"},
        "unknown_game": {"linked_game_id": MISSING},
        "unknown_line": {"linked_player_game_stats_id": MISSING},
        "unknown_player": {"linked_player_id": MISSING, "linked_player_scope": "regular"},
    }


@pytest.mark.parametrize(
    "violation",
    [
        "game_and_line",
        "game_and_player",
        "line_and_player",
        "game_on_reply",
        "line_on_reply",
        "player_on_reply",
        "player_without_scope",
        "scope_without_player",
        "play_in_scope",
        "unknown_game",
        "unknown_line",
        "unknown_player",
    ],
)
def test_a_direct_insert_that_breaks_a_link_constraint_raises_integrity_error(
    db_targets, session_factory, violation
):
    t, parent = db_targets
    fields = _violations(t, parent)[violation]

    with pytest.raises(IntegrityError):
        _insert(session_factory, t.author_id, **fields)


# ------------------------------------------ criterion 3: the request's shape


def _malformed(t: Targets) -> dict[str, object]:
    return {
        "unknown_type": {"type": "box_score", "ref_id": t.completed_game},
        "missing_type": {"ref_id": t.completed_game},
        "missing_ref_id": {"type": "game_final"},
        "zero_ref_id": {"type": "game_final", "ref_id": 0},
        "negative_ref_id": {"type": "player_game", "ref_id": -1},
        "scope_on_game_final": {
            "type": "game_final",
            "ref_id": t.completed_game,
            "scope": "regular",
        },
        "scope_on_player_game": {
            "type": "player_game",
            "ref_id": t.played_line,
            "scope": "regular",
        },
        "career_without_scope": {"type": "player_career", "ref_id": t.career_player},
        "career_null_scope": {"type": "player_career", "ref_id": t.career_player, "scope": None},
        "career_unknown_scope": {
            "type": "player_career",
            "ref_id": t.career_player,
            "scope": "play-in",
        },
        "extra_key": {"type": "game_final", "ref_id": t.completed_game, "note": "hi"},
        "extra_key_on_career": {
            "type": "player_career",
            "ref_id": t.career_player,
            "scope": "regular",
            "season": "2023-24",
        },
        "not_an_object": "game_final",
    }


@pytest.mark.parametrize(
    "variant",
    [
        "unknown_type",
        "missing_type",
        "missing_ref_id",
        "zero_ref_id",
        "negative_ref_id",
        "scope_on_game_final",
        "scope_on_player_game",
        "career_without_scope",
        "career_null_scope",
        "career_unknown_scope",
        "extra_key",
        "extra_key_on_career",
        "not_an_object",
    ],
)
def test_a_malformed_data_link_answers_422_and_creates_nothing(
    client, targets, session_factory, publisher, variant
):
    data_link = _malformed(targets)[variant]

    response = client.post(
        "/posts", json={"text": "a linked post", "data_link": data_link}, headers=TOKEN
    )

    assert response.status_code == 422, response.text
    # A shape error is Pydantic's: a list of errors, not a machine code.
    assert isinstance(response.json()["detail"], list)
    assert _post_count(session_factory) == 0
    assert publisher.published == []


# --------------------------------------------- criterion 4: a valid link


def _valid(t: Targets) -> dict[str, tuple[dict, dict]]:
    """name -> (data_link sent, the link columns expected on the row)."""
    return {
        "game_final": (
            {"type": "game_final", "ref_id": t.completed_game},
            {"linked_game_id": t.completed_game},
        ),
        "player_game": (
            {"type": "player_game", "ref_id": t.played_line},
            {"linked_player_game_stats_id": t.played_line},
        ),
        "player_career_regular": (
            {"type": "player_career", "ref_id": t.career_player, "scope": "regular"},
            {"linked_player_id": t.career_player, "linked_player_scope": "regular"},
        ),
        "player_career_playoffs": (
            {"type": "player_career", "ref_id": t.career_player, "scope": "playoffs"},
            {"linked_player_id": t.career_player, "linked_player_scope": "playoffs"},
        ),
    }


VALID = ["game_final", "player_game", "player_career_regular", "player_career_playoffs"]


@pytest.mark.parametrize("kind", VALID)
def test_a_valid_data_link_answers_201_and_stores_exactly_its_column(
    client, targets, session_factory, kind
):
    data_link, columns = _valid(targets)[kind]

    response = client.post(
        "/posts", json={"text": "look at this", "data_link": data_link}, headers=TOKEN
    )

    assert response.status_code == 201, response.text
    assert _links(session_factory, response.json()["id"]) == {
        column: columns.get(column) for column in LINK_COLUMNS
    }


@pytest.mark.parametrize("kind", VALID)
def test_post_out_echoes_the_data_link_with_scope_null_except_for_a_career(client, targets, kind):
    data_link, _ = _valid(targets)[kind]
    expected = {"scope": None, **data_link}

    created = client.post(
        "/posts", json={"text": "look at this", "data_link": data_link}, headers=TOKEN
    )

    assert created.status_code == 201, created.text
    assert created.json()["data_link"] == expected
    fetched = client.get(f"/posts/{created.json()['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["data_link"] == expected


def test_a_post_without_a_data_link_has_data_link_null(client, targets, session_factory):
    created = client.post("/posts", json={"text": "no attachment"}, headers=TOKEN)

    assert created.status_code == 201, created.text
    body = created.json()
    assert "data_link" in body
    assert body["data_link"] is None
    fetched = client.get(f"/posts/{body['id']}").json()
    assert "data_link" in fetched
    assert fetched["data_link"] is None
    assert _links(session_factory, body["id"]) == dict.fromkeys(LINK_COLUMNS)


# ------------------------------------------ criterion 5: a refused target


def _refused(t: Targets) -> dict[str, tuple[dict, str]]:
    """name -> (data_link sent, the 422's detail)."""
    return {
        "unknown_game": ({"type": "game_final", "ref_id": MISSING}, "link_target_not_found"),
        "unknown_line": ({"type": "player_game", "ref_id": MISSING}, "link_target_not_found"),
        "unknown_player": (
            {"type": "player_career", "ref_id": MISSING, "scope": "regular"},
            "link_target_not_found",
        ),
        "unplayed_game": (
            {"type": "game_final", "ref_id": t.unplayed_game},
            "game_not_completed",
        ),
        "dnp_line": ({"type": "player_game", "ref_id": t.dnp_line}, "player_did_not_play"),
        "no_playoff_games": (
            {"type": "player_career", "ref_id": t.regular_only_player, "scope": "playoffs"},
            "no_games_in_scope",
        ),
    }


@pytest.mark.parametrize(
    "case",
    [
        "unknown_game",
        "unknown_line",
        "unknown_player",
        "unplayed_game",
        "dnp_line",
        "no_playoff_games",
    ],
)
def test_a_refused_target_answers_422_with_its_code_and_writes_nothing(
    client, targets, session_factory, publisher, case
):
    data_link, detail = _refused(targets)[case]
    media_id = _processed_media(session_factory, targets.author_id)

    response = client.post(
        "/posts",
        json={"text": "look at this", "data_link": data_link, "media_ids": [media_id]},
        headers=TOKEN,
    )

    assert response.status_code == 422, response.text
    assert response.json() == {"detail": detail}
    assert _post_count(session_factory) == 0
    assert _media_post_id(session_factory, media_id) is None
    assert publisher.published == []


# ---------------------------------------- criterion 6: replies and reposts


def test_a_data_link_on_a_reply_answers_422_data_link_on_reply(
    client, targets, session_factory, publisher
):
    parent = _a_post(session_factory, targets.author_id, text="the original")

    response = client.post(
        "/posts",
        json={
            "text": "my reply",
            "is_reply": True,
            "parent_post_id": parent,
            "data_link": _game_final(targets),
        },
        headers=TOKEN,
    )

    assert response.status_code == 422, response.text
    assert response.json() == {"detail": "data_link_on_reply"}
    assert _post_count(session_factory) == 1
    assert publisher.published == []


def test_the_reply_rule_is_checked_before_the_target(client, targets, session_factory):
    parent = _a_post(session_factory, targets.author_id, text="the original")

    response = client.post(
        "/posts",
        json={
            "text": "my reply",
            "is_reply": True,
            "parent_post_id": parent,
            "data_link": {"type": "game_final", "ref_id": MISSING},
        },
        headers=TOKEN,
    )

    assert response.status_code == 422, response.text
    assert response.json() == {"detail": "data_link_on_reply"}


@pytest.mark.parametrize("text", [None, ""])
def test_a_data_link_on_a_plain_repost_answers_422_data_link_needs_quote_text(
    client, targets, session_factory, publisher, text
):
    original = _a_post(session_factory, targets.author_id, text="the original")

    response = client.post(
        "/posts",
        json={
            "text": text,
            "is_repost": True,
            "original_post_id": original,
            "data_link": _game_final(targets),
        },
        headers=TOKEN,
    )

    assert response.status_code == 422, response.text
    assert response.json() == {"detail": "data_link_needs_quote_text"}
    assert _post_count(session_factory) == 1
    assert publisher.published == []


def test_a_quote_repost_with_a_data_link_answers_201(client, targets, session_factory):
    original = _a_post(session_factory, targets.author_id, text="the original")

    response = client.post(
        "/posts",
        json={
            "text": "this, and the box score",
            "is_repost": True,
            "original_post_id": original,
            "data_link": _game_final(targets),
        },
        headers=TOKEN,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["is_repost"] is True
    assert body["original_post_id"] == original
    assert body["data_link"] == {
        "type": "game_final",
        "ref_id": targets.completed_game,
        "scope": None,
    }
    assert _links(session_factory, body["id"])["linked_game_id"] == targets.completed_game


# ------------------------------------------- criterion 7: #GameId tokens


@pytest.mark.parametrize("resolves", [True, False])
def test_a_game_mention_with_a_data_link_answers_422_and_creates_nothing(
    client, targets, session_factory, publisher, resolves
):
    game_id = targets.completed_game if resolves else MISSING

    response = client.post(
        "/posts",
        json={
            "text": f"what a night #GameId{game_id}",
            "data_link": {"type": "player_game", "ref_id": targets.played_line},
        },
        headers=TOKEN,
    )

    assert response.status_code == 422, response.text
    assert response.json() == {"detail": "data_link_with_game_mention"}
    assert _post_count(session_factory) == 0
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(EventMention)) == 0
    assert publisher.published == []


def test_game_mentions_without_a_data_link_still_create_event_mentions(
    client, targets, session_factory
):
    """Passes before POSTS-005: the legacy path is unchanged."""
    text = f"what a night #GameId{targets.completed_game} and #GameId{targets.unplayed_game}"

    response = client.post("/posts", json={"text": text}, headers=TOKEN)

    assert response.status_code == 201, response.text
    with session_factory() as session:
        mentions = session.scalars(
            select(EventMention).where(EventMention.post_id == response.json()["id"])
        ).all()
        assert sorted((m.game_id, m.raw_token) for m in mentions) == sorted(
            [
                (targets.completed_game, f"#GameId{targets.completed_game}"),
                (targets.unplayed_game, f"#GameId{targets.unplayed_game}"),
            ]
        )


# -------------------------------------------------- criterion 8: an image


def test_a_data_link_and_a_processed_image_are_both_stored(client, targets, session_factory):
    media_id = _processed_media(session_factory, targets.author_id)

    response = client.post(
        "/posts",
        json={
            "text": "the line and the photo",
            "data_link": {"type": "player_game", "ref_id": targets.played_line},
            "media_ids": [media_id],
        },
        headers=TOKEN,
    )

    assert response.status_code == 201, response.text
    post_id = response.json()["id"]
    assert _media_post_id(session_factory, media_id) == post_id
    assert _links(session_factory, post_id)["linked_player_game_stats_id"] == targets.played_line
    assert response.json()["data_link"] == {
        "type": "player_game",
        "ref_id": targets.played_line,
        "scope": None,
    }


# ------------------------------------------- criterion 9: the import scan

_POSTS_PACKAGE = Path(__file__).resolve().parents[2] / "app" / "posts"
_FORBIDDEN = "app.events.models"
# mentions.py resolves #GameId tokens against Game (the existing resolver);
# models.py imports Game only to register the FK targets on Base.metadata, a
# schema fact rather than a read (POSTS-005 brief).
_ALLOWED = {_POSTS_PACKAGE / "mentions.py", _POSTS_PACKAGE / "models.py"}


def _imported_modules(path: Path) -> set[str]:
    """Every module `path` imports, absolute, with `from a import b` counted
    as both `a` and `a.b` (b may be a submodule)."""
    package = "app.posts" + "".join(
        "." + part for part in path.parent.relative_to(_POSTS_PACKAGE).parts
    )
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path))):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base_parts = package.split(".")[: len(package.split(".")) - node.level + 1]
                base = ".".join(base_parts + ([node.module] if node.module else []))
            else:
                base = node.module or ""
            found.add(base)
            found.update(f"{base}.{alias.name}" for alias in node.names)
    return found


def test_posts_reaches_events_models_only_from_the_mention_resolver():
    offenders = sorted(
        str(path.relative_to(_POSTS_PACKAGE))
        for path in _POSTS_PACKAGE.rglob("*.py")
        if path not in _ALLOWED
        and any(
            name == _FORBIDDEN or name.startswith(_FORBIDDEN + ".")
            for name in _imported_modules(path)
        )
    )

    assert offenders == []


def test_the_import_scan_sees_both_import_forms(tmp_path, monkeypatch):
    """The scan itself: `import app.events.models`, `from app.events.models
    import X`, `from app.events import models` and a relative
    `from ..events.models import X` are all caught."""
    package = tmp_path / "app" / "posts"
    package.mkdir(parents=True)
    monkeypatch.setattr(f"{__name__}._POSTS_PACKAGE", package)
    sources = {
        "a.py": "import app.events.models\n",
        "b.py": "from app.events.models import Game\n",
        "c.py": "from app.events import models\n",
        "d.py": "from ..events.models import Game\n",
        "e.py": "from app.events.service import validate_game_final\n",
    }
    for name, source in sources.items():
        (package / name).write_text(source, encoding="utf-8")

    caught = {
        name
        for name in sources
        if any(
            found == _FORBIDDEN or found.startswith(_FORBIDDEN + ".")
            for found in _imported_modules(package / name)
        )
    }

    assert caught == {"a.py", "b.py", "c.py", "d.py"}
