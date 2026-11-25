"""The pipeline version check: pipeline paths changed => VERSION bumped and CHANGELOG touched."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from agentlib import version

ROOT = Path(__file__).resolve().parents[2]
AGENTCTL = ROOT / ".ai/bin/agentctl.py"


def git(root, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return subprocess.run(
        ["git", "-c", f"core.hooksPath={root / '.git/disabled-hooks'}", *args],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def write(root, rel, text):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def commit(root, message="c"):
    git(root, "add", "-A")
    git(
        root,
        "-c", "user.name=t", "-c", "user.email=t@example.invalid",
        "commit", "-q", "-m", message,
    )


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    write(tmp_path, ".ai/VERSION", "1.0.0\n")
    write(tmp_path, ".ai/CHANGELOG.md", "- 2026-11-24 first\n")
    write(tmp_path, ".ai/agentlib/x.py", "x = 1\n")
    write(tmp_path, "README.md", "r\n")
    commit(tmp_path, "base")
    git(tmp_path, "checkout", "-q", "-b", "pr")
    return tmp_path


def check(root):
    return version.check(root, "main")


def test_no_pipeline_path_changed_passes(repo):
    write(repo, "README.md", "changed\n")
    write(repo, ".ai/tests/test_x.py", "pass\n")
    write(repo, ".ai/docs/a.md", "doc\n")
    commit(repo)
    assert check(repo) == []


@pytest.mark.parametrize(
    "path",
    [
        ".ai/agentlib/x.py",
        ".ai/bin/agentctl.py",
        ".ai/prompts/p.md",
        ".ai/skills/s/SKILL.md",
        ".ai/policy.json",
        ".ai/config.json",
        ".github/workflows/agent-guard.yml",
    ],
)
def test_pipeline_path_without_bump_fails(repo, path):
    write(repo, path, "changed\n")
    commit(repo)
    problems = check(repo)
    assert any("VERSION" in p for p in problems)
    assert any("CHANGELOG" in p for p in problems)


@pytest.mark.parametrize("path", [".github/workflows/test-agent.yml", ".github/workflows/deploy.yml"])
def test_non_agent_workflows_are_not_pipeline(repo, path):
    write(repo, path, "changed\n")
    commit(repo)
    assert check(repo) == []


def test_bump_and_changelog_passes(repo):
    write(repo, ".ai/agentlib/x.py", "x = 2\n")
    write(repo, ".ai/VERSION", "1.0.1\n")
    write(repo, ".ai/CHANGELOG.md", "- 2026-11-24 first\n- 2026-11-25 second\n")
    commit(repo)
    assert check(repo) == []


def test_bump_without_changelog_fails(repo):
    write(repo, ".ai/agentlib/x.py", "x = 2\n")
    write(repo, ".ai/VERSION", "1.1.0\n")
    commit(repo)
    problems = check(repo)
    assert problems and all("CHANGELOG" in p for p in problems)


@pytest.mark.parametrize("new", ["1.0.0", "0.9.9", "1.0.0-rc.1", "banana", ""])
def test_version_must_be_valid_and_strictly_greater(repo, new):
    write(repo, ".ai/agentlib/x.py", "x = 2\n")
    write(repo, ".ai/VERSION", new + "\n")
    write(repo, ".ai/CHANGELOG.md", "- more\n")
    commit(repo)
    assert any("VERSION" in p for p in check(repo))


def test_numeric_not_lexical_ordering(repo):
    write(repo, ".ai/VERSION", "1.0.9\n")
    commit(repo, "bump")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--ff-only", "pr")
    git(repo, "checkout", "-q", "-b", "pr2")
    write(repo, ".ai/agentlib/x.py", "x = 2\n")
    write(repo, ".ai/VERSION", "1.0.10\n")
    write(repo, ".ai/CHANGELOG.md", "- more\n")
    commit(repo)
    assert check(repo) == []


def test_new_version_file_counts_as_changed(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    write(tmp_path, "README.md", "r\n")
    commit(tmp_path, "base")
    git(tmp_path, "checkout", "-q", "-b", "pr")
    write(tmp_path, ".ai/agentlib/x.py", "x = 1\n")
    write(tmp_path, ".ai/VERSION", "1.0.0\n")
    write(tmp_path, ".ai/CHANGELOG.md", "- first\n")
    commit(tmp_path)
    assert version.check(tmp_path, "main") == []


def test_deleted_version_fails(repo):
    write(repo, ".ai/agentlib/x.py", "x = 2\n")
    (repo / ".ai/VERSION").unlink()
    write(repo, ".ai/CHANGELOG.md", "- more\n")
    commit(repo)
    assert any("VERSION" in p for p in check(repo))


def test_cli_exit_codes(repo):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["AGENTCTL_DATA_ROOT"] = str(repo)
    ok = subprocess.run(
        [sys.executable, str(AGENTCTL), "version", "check", "--base", "main"],
        capture_output=True, text=True, env=env,
    )
    assert ok.returncode == 0, ok.stderr
    write(repo, ".ai/agentlib/x.py", "x = 2\n")
    commit(repo)
    bad = subprocess.run(
        [sys.executable, str(AGENTCTL), "version", "check", "--base", "main"],
        capture_output=True, text=True, env=env,
    )
    assert bad.returncode != 0
    assert "VERSION" in bad.stderr


def test_repository_has_a_valid_version_and_changelog():
    text = (ROOT / ".ai/VERSION").read_text(encoding="utf-8").strip()
    assert version.parse(text) is not None
    log = (ROOT / ".ai/CHANGELOG.md").read_text(encoding="utf-8")
    assert f"{text}" in log
