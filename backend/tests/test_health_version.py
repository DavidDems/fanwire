from fastapi.testclient import TestClient

from app.main import app


def test_health_version_returns_ok():
    client = TestClient(app)
    response = client.get("/health/version")
    assert response.status_code == 200


def test_health_version_body_has_nonempty_version_string():
    client = TestClient(app)
    response = client.get("/health/version")
    body = response.json()
    assert set(body.keys()) == {"version"}
    assert isinstance(body["version"], str)
    assert body["version"] != ""


def test_health_check_still_returns_ok():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
