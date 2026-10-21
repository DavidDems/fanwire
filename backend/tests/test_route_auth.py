"""Every write route is on the active-account path, enforced by a test rather
than by review (USERS-003).

Walks every APIRoute registered on app.main's app (fastapi.routing.APIRoute,
reached through the included routers). Any route answering a
method other than GET/HEAD must have app.users.dependencies.get_current_user
somewhere in its dependency tree, so a deactivated caller is refused with
403 "account_deactivated" on every write. The only exceptions are the
allowlist below, each with its reason. The allowlist is checked both ways: an
entry for a route that no longer exists fails, and an allowlisted route must
still resolve its caller from a verified token (get_current_identity or
get_own_account).

get_own_account is looked up lazily (getattr on the module), so the walk's
other assertions still run before it exists.
"""

from __future__ import annotations

import importlib

from fastapi import routing
from fastapi.routing import APIRoute

from app.main import app
from app.users.dependencies import get_current_identity, get_current_user

_READ_METHODS = frozenset({"GET", "HEAD"})

# (method, path) -> why this write route is not on the active-account path.
ALLOWLIST: dict[tuple[str, str], str] = {
    # Creates the account: no User row exists yet, so only the verified
    # identity (get_current_identity) can be required.
    ("POST", "/users"): "identity only: no account exists yet",
    # Reactivates the caller's own deactivated account, which the
    # active-account path would refuse by design (get_own_account).
    ("POST", "/users/me/recover"): "own-account path: a deactivated caller must reach it",
    # Deactivates the caller's own account; a repeat by the now-deactivated
    # caller is a 204 no-op (get_own_account).
    ("DELETE", "/users/me"): "own-account path: a repeat deactivation is a no-op",
}


def _dependency_calls(dependant) -> list:
    calls = []
    for sub in dependant.dependencies:
        if sub.call is not None:
            calls.append(sub.call)
        calls.extend(_dependency_calls(sub))
    return calls


def _api_routes() -> list:
    """Every APIRoute on the app, with its effective (prefixed) path.

    FastAPI 0.156 keeps an included router as one `_IncludedRouter` entry in
    `app.routes` rather than copying its APIRoutes in, so a plain walk of
    `app.routes` sees no API route at all. `fastapi.routing.
    iter_route_contexts` flattens those entries into per-route contexts that
    expose the effective path, methods and dependant; older FastAPI has no
    such helper and lists the APIRoutes directly.
    """
    iter_route_contexts = getattr(routing, "iter_route_contexts", None)
    if iter_route_contexts is None:
        return [route for route in app.routes if isinstance(route, APIRoute)]
    return [
        context
        for context in iter_route_contexts(app.routes)
        if isinstance(context.original_route, APIRoute)
    ]


def _write_routes() -> list:
    found = []
    for route in _api_routes():
        for method in sorted(set(route.methods) - _READ_METHODS):
            found.append((method, route.path, route))
    return found


def _contains(calls: list, target) -> bool:
    return any(call is target for call in calls)


def test_the_walk_finds_write_routes_at_all():
    """Guards the walk itself: an empty walk would pass every other test."""
    keys = {(method, path) for method, path, _ in _write_routes()}

    assert ("POST", "/posts") in keys
    assert ("POST", "/users/{user_id}/follow") in keys


def test_every_write_route_depends_on_get_current_user_unless_allowlisted():
    offenders = [
        f"{method} {path}"
        for method, path, route in _write_routes()
        if (method, path) not in ALLOWLIST
        and not _contains(_dependency_calls(route.dependant), get_current_user)
    ]

    assert offenders == [], (
        "write routes whose dependency tree lacks get_current_user (add it, or "
        f"allowlist the route with a reason): {offenders}"
    )


def test_every_allowlist_entry_names_an_existing_route():
    existing = {(method, path) for method, path, _ in _write_routes()}

    stale = sorted(key for key in ALLOWLIST if key not in existing)

    assert stale == [], f"allowlist entries for routes that do not exist: {stale}"


def test_every_allowlisted_route_still_resolves_its_caller_from_a_verified_token():
    dependencies = importlib.import_module("app.users.dependencies")
    accepted = [get_current_identity]
    get_own_account = getattr(dependencies, "get_own_account", None)
    if get_own_account is not None:
        accepted.append(get_own_account)

    unauthenticated = [
        f"{method} {path}"
        for method, path, route in _write_routes()
        if (method, path) in ALLOWLIST
        and not any(_contains(_dependency_calls(route.dependant), dep) for dep in accepted)
    ]

    assert unauthenticated == [], (
        "allowlisted routes with neither get_current_identity nor get_own_account "
        f"in their dependency tree: {unauthenticated}"
    )
