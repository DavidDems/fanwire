"""Default `TESTCONTAINERS_HOST_OVERRIDE` for a run inside Docker Desktop.

`conftest.py` calls `apply()` before it imports testcontainers, which reads
the variable once, at import. Inside a container on a Linux engine (CI) the
bridge gateway reaches sibling containers and nothing is set. Inside Docker
Desktop the gateway does not route to their published ports; Desktop's own
DNS name `host.docker.internal` does, and only Desktop resolves it. A run on
the host, or any value already set, is left alone.
"""

from __future__ import annotations

import os
import socket
from collections.abc import Callable, MutableMapping

OVERRIDE = "TESTCONTAINERS_HOST_OVERRIDE"
_DESKTOP_HOST = "host.docker.internal"


def default_host_override(
    environ: MutableMapping[str, str],
    *,
    in_container: bool,
    resolve: Callable[[str], str] = socket.gethostbyname,
) -> None:
    if not in_container or OVERRIDE in environ or "TC_HOST" in environ:
        return
    try:
        resolve(_DESKTOP_HOST)
    except OSError:
        return
    environ[OVERRIDE] = _DESKTOP_HOST


def apply() -> None:
    default_host_override(os.environ, in_container=os.path.exists("/.dockerenv"))
