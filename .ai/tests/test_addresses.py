"""CUT-00: no personal email address in any tracked file.

The repository moves to a new public repository (Prompts/25). Anything a
tracked file says goes with it, so an address that is not on the allowlist
fails CI. The real test-account addresses live in the gitignored
`.env.test-accounts.local`; docs use placeholders such as `<owner-email>+fw1`.

No literal address that the check bans appears in this file: every banned
fixture is assembled at runtime, so the scan of the real tree (the last test)
never finds this file.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

from agentlib import addresses

ROOT = Path(__file__).resolve().parents[2]
AGENTCTL = ROOT / ".ai" / "bin" / "agentctl.py"
AT = "@"


def banned(local: str = "someone", domain: str = "mailhost.com") -> str:
    return local + AT + domain


def git(root, *args):
    return subprocess.run(
        ["git", *args],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init")
    return tmp_path


def put(repo, path, body):
    p = repo / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")
    git(repo, "add", path)


class TestWhatIsFound:
    def test_a_plain_address_is_found_with_its_line(self, repo):
        put(repo, "docs/a.md", "one\ncontact " + banned() + " now\n")
        [hit] = addresses.scan(repo)
        assert (hit.path, hit.line) == ("docs/a.md", 2)

    def test_a_plus_alias_and_a_templated_alias_are_found(self, repo):
        put(repo, "a.md", banned("owner+fw1") + "\n" + banned("owner+fw<n>") + "\n")
        assert [h.line for h in addresses.scan(repo)] == [1, 2]

    def test_an_address_in_angle_brackets_is_found(self, repo):
        put(repo, "a.md", "Author: Some One <" + banned() + ">\n")
        assert len(addresses.scan(repo)) == 1

    def test_any_tracked_file_is_scanned_not_only_markdown(self, repo):
        put(repo, "backend/x.py", 'FROM = "' + banned() + '"\n')
        put(repo, "infra/y.json", '{"to": "' + banned() + '"}\n')
        assert {h.path for h in addresses.scan(repo)} == {"backend/x.py", "infra/y.json"}

    def test_an_untracked_file_is_not_scanned(self, repo):
        (repo / ".env.test-accounts.local").write_text(banned() + "\n", encoding="utf-8")
        assert addresses.scan(repo) == []

    def test_a_binary_file_is_skipped(self, repo):
        p = repo / "logo.png"
        p.write_bytes(b"\x89PNG\x00\x00" + banned().encode())
        git(repo, "add", "logo.png")
        assert addresses.scan(repo) == []


class TestTheAllowlist:
    @pytest.mark.parametrize(
        "domain",
        [
            "example.com",
            "example.org",
            "mail.example.net",
            "accounts.test",
            "nobody.invalid",
            "fanwire.app",
            "fanwire.daviddems.com",
            "users.noreply.github.com",
        ],
    )
    def test_allowed_domains_pass(self, repo, domain):
        put(repo, "a.md", banned("x", domain) + "\n")
        assert addresses.scan(repo) == []

    @pytest.mark.parametrize("local", ["noreply", "git"])
    def test_githubs_own_service_addresses_pass(self, repo, local):
        put(repo, "wf.yml", banned(local, "github.com") + "\n")
        assert addresses.scan(repo) == []

    def test_another_github_address_is_found(self, repo):
        put(repo, "a.md", banned("someone", "github.com") + "\n")
        assert len(addresses.scan(repo)) == 1

    @pytest.mark.parametrize("domain", ["notexample.com", "myfanwire.com", "test.com"])
    def test_lookalike_domains_are_found(self, repo, domain):
        put(repo, "a.md", banned("x", domain) + "\n")
        assert len(addresses.scan(repo)) == 1

    @pytest.mark.parametrize(
        "path",
        ["package-lock.json", "infra/package-lock.json", "yarn.lock", "uv.lock", "pnpm-lock.yaml"],
    )
    def test_lockfiles_are_skipped(self, repo, path):
        put(repo, path, '{"author": "' + banned() + '"}\n')
        assert addresses.scan(repo) == []


class TestWhatIsNotAnAddress:
    @pytest.mark.parametrize(
        "text",
        [
            '+@router.get("/players")',
            "npx @playwright/mcp@latest",
            "react@18.3.1",
            "a @ b.com",
            "`@DavidDems`",
            "<owner-email>+fw1",
        ],
    )
    def test_not_flagged(self, repo, text):
        put(repo, "a.md", text + "\n")
        assert addresses.scan(repo) == []


class TestTheReport:
    def test_the_report_masks_the_address(self, repo):
        put(repo, "a.md", banned("someone+fw1", "mailhost.com") + "\n")
        [hit] = addresses.scan(repo)
        assert addresses.format_hit(hit) == "a.md:1: s***" + AT + "mailhost.com"

    def test_the_cli_fails_on_a_hit_and_passes_without_one(self, repo):
        cmd = [sys.executable, str(AGENTCTL), "addresses", "--root", str(repo)]
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        put(repo, "a.md", "clean\n")
        ok = subprocess.run(cmd, capture_output=True, text=True, env=env)
        assert ok.returncode == 0, ok.stderr
        assert "0 personal addresses" in ok.stdout
        put(repo, "b.md", banned() + "\n")
        bad = subprocess.run(cmd, capture_output=True, text=True, env=env)
        assert bad.returncode == 1
        assert "b.md:1:" in bad.stdout
        assert "1 personal address" in bad.stdout


def test_the_real_tree_holds_no_personal_address():
    """The tree this suite runs in. CI also runs the CLI in its own job."""
    # Compared as masked strings: a failing assert prints both sides, and a
    # Hit's repr would put the address it caught into the CI log.
    assert [addresses.format_hit(h) for h in addresses.scan(ROOT)] == []


class TestTheGateRunsTheScan:
    """`gate` is the one required check on `main`; a job outside its `needs:`
    can fail and still merge."""

    @pytest.fixture
    def workflow(self) -> str:
        return (ROOT / ".github/workflows/test-agent.yml").read_text(encoding="utf-8")

    def block(self, text: str, name: str) -> str:
        body = text.split("\njobs:\n", 1)[1]
        jobs = re.split(r"^  (?=[A-Za-z0-9_-]+:\s*$)", body, flags=re.MULTILINE)
        [job] = [j for j in jobs if j.startswith(f"{name}:")]
        return job

    def test_the_job_always_runs_and_calls_the_cli(self, workflow):
        job = self.block(workflow, "address-scan")
        top = [
            ln.split(":", 1)[0]
            for ln in job.splitlines()
            if ln.startswith("    ") and not ln.startswith("     ")
        ]
        assert "    if" not in top
        assert "    needs" not in top
        assert "python .ai/bin/agentctl.py addresses" in job

    def test_the_gate_needs_the_job(self, workflow):
        gate = self.block(workflow, "gate")
        needs = gate.split("needs:", 1)[1].split("runs-on:", 1)[0]
        assert "- address-scan" in needs
