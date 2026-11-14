"""USERS-008 public route contract. Runtime boundary behavior is covered by test_users_data_deletion_route.py."""

from app.main import app


def test_delete_my_data_route_is_identity_keyed_and_requires_recent_authentication():
    operation = app.openapi()["paths"]["/users/me/data"]["delete"]

    assert operation.get("parameters", []) == []
    assert "requestBody" not in operation
    assert "204" in operation["responses"]
    assert "403" in operation["responses"]
    assert "recent_auth_required" in str(operation["responses"]["403"])
