"""The pipeline version check (metrics deliverable 4). Stdlib, deterministic.

A change to the pipeline itself (`PIPELINE_PATHS`) must bump `.ai/VERSION` to a
valid semver strictly greater than the base's, and touch `.ai/CHANGELOG.md`.
A newly added VERSION counts as changed. Nothing relevant changed: pass.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

VERSION_FILE = ".ai/VERSION"
CHANGELOG_FILE = ".ai/CHANGELOG.md"
PIPELINE_PREFIXES = (".ai/agentlib/", ".ai/bin/", ".ai/prompts/", ".ai/skills/")
PIPELINE_FILES = (".ai/policy.json", ".ai/config.json")
_AGENT_WORKFLOW = re.compile(r"\.github/workflows/agent-[^/]+\.yml\Z")

_NUM = r"(0|[1-9]\d*)"
_PRE_ID = r"(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
_SEMVER = re.compile(
    rf"{_NUM}\.{_NUM}\.{_NUM}(?:-({_PRE_ID}(?:\.{_PRE_ID})*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\Z"
)


class VersionError(Exception):
    pass


def parse(text: str):
    """A sortable precedence key (semver 2.0.0 section 11), or None if invalid."""
    match = _SEMVER.fullmatch(text.strip())
    if not match:
        return None
    major, minor, patch, pre = match.groups()
    core = (int(major), int(minor), int(patch))
    if pre is None:
        return (core, 1, ())
    ids = tuple((0, int(i), "") if i.isdigit() else (1, 0, i) for i in pre.split("."))
    return (core, 0, ids)


def is_pipeline_path(path: str) -> bool:
    return (
        path.startswith(PIPELINE_PREFIXES)
        or path in PIPELINE_FILES
        or bool(_AGENT_WORKFLOW.fullmatch(path))
    )


def _git(root: Path, *args: str, check: bool = True) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    done = subprocess.run(
        ["git", *args], cwd=root, env=env, capture_output=True, text=True, encoding="utf-8"
    )
    if check and done.returncode != 0:
        raise VersionError(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout if done.returncode == 0 else ""


def _show(root: Path, ref: str, path: str) -> str | None:
    done = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        cwd=root,
        env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return done.stdout if done.returncode == 0 else None


def check(root: str | Path, base: str) -> list[str]:
    """Problems found between `base` and HEAD; empty means the check passes."""
    root = Path(root)
    changed = set(_git(root, "diff", "--name-only", f"{base}...HEAD").split("\n")) - {""}
    touched = sorted(p for p in changed if is_pipeline_path(p))
    if not touched:
        return []
    shown = ", ".join(touched[:5]) + (" ..." if len(touched) > 5 else "")
    problems: list[str] = []

    head = _show(root, "HEAD", VERSION_FILE)
    old = _show(root, base, VERSION_FILE)
    if VERSION_FILE not in changed:
        problems.append(f"pipeline paths changed ({shown}) but {VERSION_FILE} did not")
    elif head is None:
        problems.append(f"{VERSION_FILE} was deleted")
    elif parse(head) is None:
        problems.append(f"{VERSION_FILE} is not valid semver: {head.strip()!r}")
    elif old is not None and parse(old) is not None and parse(head) <= parse(old):
        problems.append(
            f"{VERSION_FILE} must be greater than the base's: {head.strip()} <= {old.strip()}"
        )
    if CHANGELOG_FILE not in changed:
        problems.append(f"pipeline paths changed ({shown}) but {CHANGELOG_FILE} did not")
    return problems
