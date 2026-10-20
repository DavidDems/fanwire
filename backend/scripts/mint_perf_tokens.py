"""Mints the ID tokens the local load test's virtual users sign in with
(PERF-001, perf/README.md).

The load test generates no Cognito traffic, so its virtual users cannot
hold real pool tokens. Instead this script generates a fresh RSA key pair,
writes the public half as a JWKS to `<out-dir>/jwks.json` and one RS256 ID
token per perf user to `<out-dir>/tokens.json` (a JSON list; the token at
index n-1 is `perf-user-<n>`'s). The backend under load reads that JWKS
through PERF_JWKS_PATH (app.users.dependencies.get_token_verifier), and the
tokens carry app.users.dependencies.PERF_ISSUER / PERF_AUDIENCE, imported
from there so the two cannot drift apart.

The private key exists only in this process's memory: it signs the tokens
and is gone. It is never written anywhere, and no token is ever printed.
Each run is a new key, so a token from an earlier run stops verifying the
moment the JWKS is re-minted.

Fail-closed by design: refuses to run unless `ENVIRONMENT` is exactly
`"perf"`, the same value app.settings.Settings requires before it accepts
PERF_JWKS_PATH at all.

Usage (perf/run.ps1 runs it in the backend-perf image, with a writable
mount of perf/results at /out):
    python scripts/mint_perf_tokens.py --count 300 --out-dir /out
"""

from __future__ import annotations

import sys
from pathlib import Path

# scripts/ has no __init__.py (same as scripts/export_openapi.py) -- Python's
# implicit namespace package support picks it up once BACKEND_ROOT is on
# sys.path, inserted the same defensive way export_openapi.py inserts it.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import argparse
import json
import os
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from app.users.dependencies import PERF_AUDIENCE, PERF_ISSUER

REQUIRED_ENVIRONMENT = "perf"
# Comfortably longer than the longest profile (stress) plus setup and seed.
TOKEN_LIFETIME = timedelta(hours=4)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mint local perf ID tokens and their JWKS.")
    parser.add_argument("--count", type=int, required=True, help="number of perf users")
    parser.add_argument("--out-dir", type=Path, required=True, help="directory to write into")
    args = parser.parse_args(argv)
    if args.count < 1:
        parser.error("--count must be at least 1")
    return args


def main(argv: list[str]) -> int:
    environment = os.environ.get("ENVIRONMENT")
    if environment != REQUIRED_ENVIRONMENT:
        print(
            f"refusing to run: ENVIRONMENT={environment!r}, but this script only ever "
            f"runs in a {REQUIRED_ENVIRONMENT!r} environment -- it mints tokens for a "
            "verifier that must never exist anywhere real",
            file=sys.stderr,
        )
        return 1

    args = _parse_args(argv)
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    kid = f"perf-{secrets.token_hex(8)}"
    jwk = RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk.update({"kid": kid, "alg": "RS256", "use": "sig"})

    now = datetime.now(UTC)
    tokens = [
        jwt.encode(
            {
                "sub": f"perf-user-{n}",
                "token_use": "id",
                "aud": PERF_AUDIENCE,
                "iss": PERF_ISSUER,
                "iat": now,
                "exp": now + TOKEN_LIFETIME,
            },
            private_key,
            algorithm="RS256",
            headers={"kid": kid},
        )
        for n in range(1, args.count + 1)
    ]

    (out_dir / "jwks.json").write_text(json.dumps({"keys": [jwk]}), encoding="utf-8")
    (out_dir / "tokens.json").write_text(json.dumps(tokens), encoding="utf-8")
    print(f"minted {len(tokens)} perf ID tokens and their JWKS into {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
