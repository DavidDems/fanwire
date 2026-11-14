"""No personal email address in any tracked file (CUT-00, Prompts/25).

The repository is public and moves to a fresh one; whatever a tracked file
says moves with it. Every address found by `ADDRESS` fails the scan unless its
domain or the whole address is on the allowlist below. Real test-account
addresses live in the gitignored `.env.test-accounts.local`; documents use
placeholders such as `<owner-email>+fw1`.

This module names no banned address, only the shape of one, so it never
finds itself. Reports mask the local part, so a CI log does not repeat what it
caught.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

# A local part starts with a letter or digit, so `+@router.get` and
# `@playwright/mcp@latest` are not addresses. `<` and `>` are allowed inside
# it so a templated alias (`name+fw<n>`, then the domain) is still caught.
ADDRESS = re.compile(
    r"(?<![A-Za-z0-9._%+-])"
    r"([A-Za-z0-9][A-Za-z0-9._%+<>-]*)@"
    r"((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])"
)

# Reserved for documentation and tests (RFC 2606 / 6761), or the project's own.
_ALLOWED_TLDS = frozenset({"test", "invalid"})
_ALLOWED_SUFFIXES = ("users.noreply.github.com",)
# GitHub's own service addresses: the bot commit identity and the SSH remote.
_ALLOWED_ADDRESSES = frozenset({"noreply@github.com", "git@github.com"})

# Package authors in generated lockfiles are not ours to scrub.
_LOCKFILES = frozenset(
    {
        "package-lock.json",
        "npm-shrinkwrap.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "uv.lock",
        "poetry.lock",
    }
)


@dataclass(frozen=True)
class Hit:
    path: str
    line: int
    local: str
    domain: str


def allowed(local: str, domain: str) -> bool:
    domain = domain.lower()
    labels = domain.split(".")
    if f"{local.lower()}@{domain}" in _ALLOWED_ADDRESSES:
        return True
    if labels[-1] in _ALLOWED_TLDS:
        return True
    if "example" in labels or labels[0] == "fanwire":
        return True
    return domain.endswith(_ALLOWED_SUFFIXES)


def tracked_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
        env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
    ).stdout
    return [p for p in out.decode("utf-8").split("\0") if p]


def scan(root: Path) -> list[Hit]:
    root = Path(root)
    hits: list[Hit] = []
    for rel in tracked_files(root):
        if rel.rsplit("/", 1)[-1] in _LOCKFILES:
            continue
        try:
            data = (root / rel).read_bytes()
        except OSError:
            continue  # deleted in the working tree, or a submodule
        if b"\0" in data:
            continue  # binary
        text = data.decode("utf-8", errors="replace")
        for number, line in enumerate(text.splitlines(), start=1):
            for m in ADDRESS.finditer(line):
                if not allowed(m.group(1), m.group(2)):
                    hits.append(Hit(rel, number, m.group(1), m.group(2)))
    return hits


def format_hit(hit: Hit) -> str:
    return f"{hit.path}:{hit.line}: {hit.local[0]}***@{hit.domain}"
