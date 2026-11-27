"""Which host testcontainers' own containers are reached on.

The suite runs inside `backend-test` and starts sibling containers through the
mounted host socket. On a Linux engine (CI) testcontainers reaches them through
the bridge gateway and needs nothing. On Docker Desktop that gateway does not
route to published ports, and every database test failed until
`TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` was passed by hand. The
default is now decided here, before testcontainers reads its configuration.
"""

from __future__ import annotations

import socket

import pytest

from tests.testcontainers_host import OVERRIDE, default_host_override


def _resolves(name: str) -> str:
    return "192.168.65.254"


def _does_not_resolve(name: str) -> str:
    raise socket.gaierror(name)


def test_docker_desktop_defaults_to_host_docker_internal():
    environ: dict[str, str] = {}

    default_host_override(environ, in_container=True, resolve=_resolves)

    assert environ == {OVERRIDE: "host.docker.internal"}


def test_a_linux_engine_is_left_alone_as_in_ci():
    environ: dict[str, str] = {}

    default_host_override(environ, in_container=True, resolve=_does_not_resolve)

    assert environ == {}


def test_a_run_on_the_host_is_left_alone():
    environ: dict[str, str] = {}
    looked_up: list[str] = []

    default_host_override(
        environ, in_container=False, resolve=lambda name: looked_up.append(name) or ""
    )

    assert environ == {}
    assert looked_up == []


@pytest.mark.parametrize("name", [OVERRIDE, "TC_HOST"])
def test_an_explicit_setting_always_wins(name):
    environ = {name: "10.0.0.5"}

    default_host_override(environ, in_container=True, resolve=_resolves)

    assert environ == {name: "10.0.0.5"}


def test_the_override_is_the_name_testcontainers_reads():
    assert OVERRIDE == "TESTCONTAINERS_HOST_OVERRIDE"
