"""`backend-dev` must receive the Cognito ids from `backend/.env`.

`docker-compose.yml` listed `COGNITO_REGION`, `COGNITO_USER_POOL_ID` and
`COGNITO_APP_CLIENT_ID` as bare names under `environment:`, meant to forward a
host-shell value and otherwise fall through to `env_file`. Docker Compose
v5.5.1 does not fall through. A bare name with no host value is *unset* in the
container, and `environment` outranks `env_file`, so the values in
`backend/.env` never arrived. Settings then defaulted to `us-east-1` and an
empty pool id. The JWKS fetch got HTTP 400, and every signed-in request to
`backend-dev` was a 500, measured 2026-10-07: `GET /users/me` -> 500.

`env_file` alone supplies them now. No dependency, so a line scan over the one
service block rather than a YAML parser.
"""

import re
from pathlib import Path

import pytest

COMPOSE = Path(__file__).resolve().parents[2] / "docker-compose.yml"
BARE_NAME = re.compile(r"^\s+-\s+([A-Z][A-Z0-9_]*)\s*$")


def _service_block(text: str, service: str) -> list[str]:
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line == f"  {service}:")
    block = []
    for line in lines[start + 1 :]:
        if re.match(r"^  \S", line):
            break
        block.append(line)
    return block


@pytest.fixture(scope="module")
def backend_dev() -> list[str]:
    if not COMPOSE.exists():
        pytest.skip("docker-compose.yml not present")
    return _service_block(COMPOSE.read_text(encoding="utf-8"), "backend-dev")


def test_backend_dev_reads_backend_env(backend_dev):
    assert any("backend/.env" in line for line in backend_dev)


def test_no_bare_name_masks_an_env_file_value(backend_dev):
    bare = [m.group(1) for line in backend_dev if (m := BARE_NAME.match(line))]
    assert bare == [], (
        f"bare environment names {bare} are unset in the container when the host "
        "shell lacks them, and outrank backend/.env"
    )
