"""Put `.ai/` on sys.path so `agentlib` imports without an install step.

The agent infrastructure is deliberately dependency-free stdlib Python (see
`.ai/docs/architecture.md`, "Zero-dependency deterministic core"), so there is
no package to `pip install -e`. Tests need pytest and nothing else.
"""

import os
import sys
from pathlib import Path

import pytest

AI_ROOT = Path(__file__).resolve().parents[1]
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))


@pytest.fixture(autouse=True)
def _no_inherited_git_environment(monkeypatch):
    """Git hooks run with `GIT_DIR`, `GIT_INDEX_FILE` and friends set, and
    `.ai/hooks/pre-commit` runs this suite. Inherited, those variables point
    every `git` a test starts at the repository being committed to, whatever
    its `cwd` — which is how a test's `git init` once marked the real
    repository bare and committed a temp directory onto a branch (D2b,
    2026-10-08). No test may ever see them. Tests that start git also scrub
    their subprocess environment explicitly, so this is the second layer."""
    for key in [k for k in os.environ if k.startswith("GIT_")]:
        monkeypatch.delenv(key)
