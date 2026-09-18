"""Confirms app.main actually wires in every module's router — the gap
this whole Phase 2a unit closes (per wiki/GeneralContext/Prompts/
phase-2-manager-agent.md: "events/, users/, media/, and posts/ each have
real FastAPI routes wired into app.main, and GET /openapi.json ... reflects
all of them"). Written before app.main includes any router.

Checks the live OpenAPI schema (FastAPI's own auto-generated
/openapi.json) rather than re-asserting each route's own behavior --
that's each module's own test_routes.py's job. This test only proves the
routers are actually registered on the one shared `app` instance, not
just importable/working in isolation.
"""

from fastapi.testclient import TestClient

from app.main import app


def test_openapi_schema_includes_events_routes():
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]

    assert "/events/teams" in paths
    assert "/events/teams/{team_id}" in paths
    assert "/events/games" in paths
    assert "/events/games/{game_id}" in paths


def test_openapi_schema_includes_users_routes():
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]

    assert "/users" in paths
    assert "/users/{user_id}" in paths
    assert "/users/me" in paths
    assert "/users/{user_id}/follow" in paths


def test_openapi_schema_includes_media_routes():
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]

    assert "/media/uploads" in paths
    assert "/media/{media_id}" in paths


def test_openapi_schema_includes_posts_routes():
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]

    assert "/posts" in paths
    assert "/posts/{post_id}" in paths
    assert "/posts/{post_id}/replies" in paths
    assert "/posts/{post_id}/like" in paths
    assert "/posts/{post_id}/report" in paths


def test_openapi_schema_includes_feed_routes():
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]

    assert "/feed" in paths
    assert "/feed/thread/{post_id}" in paths


def test_health_check_still_works_alongside_the_new_routers():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
