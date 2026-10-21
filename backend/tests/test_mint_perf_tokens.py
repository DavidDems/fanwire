"""PERF-001: backend/scripts/mint_perf_tokens.py, per AGENTS.md TDD workflow.
Written before the script exists.

Run the way perf/run.ps1 runs it (`python scripts/mint_perf_tokens.py
--count N --out-dir DIR`, cwd backend/). It refuses to run unless
ENVIRONMENT is exactly "perf". Otherwise it generates a fresh RSA key pair,
writes the public JWKS to DIR/jwks.json and one ID token per perf user to
DIR/tokens.json, and nothing else: the private key lives only in the
script's memory, and no token is ever printed.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import jwt
import pytest

from app.users import dependencies as users_dependencies
from app.users.auth import CognitoTokenVerifier

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPT = _BACKEND_DIR / "scripts" / "mint_perf_tokens.py"
_PRIVATE_JWK_MEMBERS = ("d", "p", "q", "dp", "dq", "qi")


# Read at use, not imported by name: a missing constant then fails the tests
# that need it instead of stopping the whole suite at collection.
def _issuer() -> str:
    return users_dependencies.PERF_ISSUER


def _audience() -> str:
    return users_dependencies.PERF_AUDIENCE


def _run(out_dir: Path, *, count: int, environment: str | None):
    # A missing script also exits non-zero and writes nothing; that is not a
    # refusal, so it must not pass as one.
    assert _SCRIPT.is_file(), f"{_SCRIPT} does not exist"
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.pop("ENVIRONMENT", None)
    env.pop("PERF_JWKS_PATH", None)
    if environment is not None:
        env["ENVIRONMENT"] = environment
    return subprocess.run(
        [sys.executable, str(_SCRIPT), "--count", str(count), "--out-dir", str(out_dir)],
        check=False,
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.mark.parametrize("environment", [None, "", "development", "production", "Perf", " perf"])
def test_refuses_outside_the_perf_environment_and_writes_nothing(tmp_path, environment):
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    result = _run(out_dir, count=3, environment=environment)

    assert result.returncode != 0
    assert "ENVIRONMENT" in result.stdout + result.stderr
    assert list(out_dir.iterdir()) == []


@pytest.fixture(scope="module")
def minted(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("minted")
    result = _run(out_dir, count=5, environment="perf")
    assert result.returncode == 0, result.stderr
    jwks = json.loads((out_dir / "jwks.json").read_text(encoding="utf-8"))
    tokens = json.loads((out_dir / "tokens.json").read_text(encoding="utf-8"))
    return {"dir": out_dir, "result": result, "jwks": jwks, "tokens": tokens}


def test_writes_only_jwks_and_tokens(minted):
    assert sorted(p.name for p in minted["dir"].iterdir()) == ["jwks.json", "tokens.json"]


def test_jwks_holds_one_public_rsa_key_with_a_kid(minted):
    keys = minted["jwks"]["keys"]

    assert len(keys) == 1
    (key,) = keys
    assert key["kty"] == "RSA"
    assert key.get("kid")
    assert "n" in key
    assert "e" in key
    for member in _PRIVATE_JWK_MEMBERS:
        assert member not in key, f"private JWK member {member!r} written to jwks.json"


def test_tokens_is_a_list_of_count_strings(minted):
    tokens = minted["tokens"]

    assert isinstance(tokens, list)
    assert len(tokens) == 5
    assert all(isinstance(token, str) and token for token in tokens)


def _decode(token: str, jwks: dict) -> tuple[dict, dict]:
    header = jwt.get_unverified_header(token)
    (jwk,) = [k for k in jwks["keys"] if k["kid"] == header["kid"]]
    claims = jwt.decode(
        token,
        jwt.PyJWK(jwk, algorithm="RS256").key,
        algorithms=["RS256"],
        audience=_audience(),
        issuer=_issuer(),
    )
    return header, claims


def test_each_token_is_an_rs256_perf_id_token_for_its_user(minted):
    for index, token in enumerate(minted["tokens"]):
        header, claims = _decode(token, minted["jwks"])

        assert header["alg"] == "RS256"
        assert claims["sub"] == f"perf-user-{index + 1}"
        assert claims["iss"] == _issuer()
        assert claims["aud"] == _audience()
        assert claims["token_use"] == "id"
        assert claims["exp"] - claims["iat"] >= 2 * 60 * 60


def test_cognito_token_verifier_accepts_every_minted_token(minted):
    verifier = CognitoTokenVerifier(minted["jwks"], audience=_audience(), issuer=_issuer())

    subs = [verifier.verify(token).sub for token in minted["tokens"]]

    assert subs == [f"perf-user-{n}" for n in range(1, 6)]


def test_never_prints_a_token_or_the_private_key(minted):
    output = minted["result"].stdout + minted["result"].stderr

    for token in minted["tokens"]:
        assert token not in output
        # A token's signature alone is just as much of a leak.
        assert token.rsplit(".", 1)[1] not in output
    assert "PRIVATE KEY" not in output


def test_a_second_run_generates_a_different_key(minted, tmp_path):
    out_dir = tmp_path / "again"
    out_dir.mkdir()

    result = _run(out_dir, count=1, environment="perf")

    assert result.returncode == 0, result.stderr
    first = minted["jwks"]["keys"][0]
    second = json.loads((out_dir / "jwks.json").read_text(encoding="utf-8"))["keys"][0]
    assert first["n"] != second["n"]
