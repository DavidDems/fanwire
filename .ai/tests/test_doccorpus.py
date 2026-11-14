"""CUT-01: corpus tooling for the Context-Update-Track (Prompts/25).

`docs inventory` measures each Markdown file against its WikiUpdate budget and
lists what links to it. `docs dupes` finds repeated and near-repeated
paragraphs. `docs archive-refs` rewrites PR numbers and commit hashes to the
`fanwire-archive` form the new repository needs; it only ever reads and
writes tracked Markdown, and writes nothing unless asked.

Every fixture is built in a throwaway repository. Commit hashes come from that
repository's own history, so no test names a real one.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from agentlib import doccorpus

ROOT = Path(__file__).resolve().parents[2]
AGENTCTL = ROOT / ".ai" / "bin" / "agentctl.py"
SKILL = ".claude/skills/wiki-update/SKILL.md"


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
    git(tmp_path, "config", "user.email", "fixture@example.invalid")
    git(tmp_path, "config", "user.name", "Fixture")
    skill = tmp_path / SKILL
    skill.parent.mkdir(parents=True)
    skill.write_text((ROOT / SKILL).read_text(encoding="utf-8"), encoding="utf-8")
    git(tmp_path, "add", SKILL)
    return tmp_path


def put(repo, path, body, kind="reference"):
    p = repo / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(((f"---\ntype: {kind}\n---\n" if kind else "") + body).encode("utf-8"))
    git(repo, "add", path)
    return p


def commit(repo, message="fixture"):
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def run(*args):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return subprocess.run(
        [sys.executable, str(AGENTCTL), "docs", *args],
        capture_output=True,
        text=True,
        env=env,
    )


def row(rows, path):
    [found] = [r for r in rows if r["path"] == path]
    return found


SENTENCE = (
    "The feed service reads posts from the events table and orders them by the "
    "time each was created, newest first, before it applies the block list."
)


class TestInventory:
    def test_words_type_and_budget_come_from_the_skill(self, repo):
        put(repo, "wiki/a.md", "word " * 30)
        put(repo, "wiki/log.md", "word " * 1001, kind="changelog")
        put(repo, "wiki/untyped.md", "word " * 5, kind=None)
        rows = doccorpus.inventory(repo)
        a = row(rows, "wiki/a.md")
        assert (a["type"], a["words"], a["budget"], a["over"]) == ("reference", 30, 2500, False)
        log = row(rows, "wiki/log.md")
        assert (log["words"], log["budget"], log["over"]) == (1001, 1000, True)
        untyped = row(rows, "wiki/untyped.md")
        assert (untyped["type"], untyped["budget"], untyped["over"]) == (None, None, False)

    def test_only_tracked_markdown_is_listed(self, repo):
        put(repo, "wiki/a.md", "x")
        put(repo, "backend/notes.txt", "x", kind=None)
        (repo / "wiki/untracked.md").write_text("x", encoding="utf-8")
        assert {r["path"] for r in doccorpus.inventory(repo)} == {SKILL, "wiki/a.md"}

    def test_paths_limit_the_rows_by_prefix(self, repo):
        put(repo, "wiki/Modules/a.md", "x")
        put(repo, "wiki/Modules/b.md", "x")
        put(repo, "wiki/Other/c.md", "x")
        rows = doccorpus.inventory(repo, paths=["wiki/Modules/"])
        assert [r["path"] for r in rows] == ["wiki/Modules/a.md", "wiki/Modules/b.md"]
        rows = doccorpus.inventory(repo, paths=["wiki/Other/c.md"])
        assert [r["path"] for r in rows] == ["wiki/Other/c.md"]

    def test_inbound_links_resolve_relative_wiki_and_reference_forms(self, repo):
        put(repo, "wiki/Modules/target.md", "# Head\n")
        put(repo, "wiki/Modules/rel.md", "See [t](target.md#head).\n")
        put(repo, "wiki/up.md", "See [t](Modules/target.md).\n")
        put(repo, "wiki/wl.md", "See [[wiki/Modules/target|the target]].\n")
        put(repo, "wiki/def.md", "See [t][x].\n\n[x]: Modules/target.md\n")
        put(repo, "wiki/code.md", "Not a link: `[t](Modules/target.md)`.\n")
        put(repo, "wiki/elsewhere.md", "See [o](rel.md).\n")
        target = row(doccorpus.inventory(repo), "wiki/Modules/target.md")
        assert target["inbound"] == [
            {"source": "wiki/Modules/rel.md", "kind": "link"},
            {"source": "wiki/def.md", "kind": "link"},
            {"source": "wiki/up.md", "kind": "link"},
            {"source": "wiki/wl.md", "kind": "link"},
        ]

    def test_a_repository_path_named_in_any_tracked_text_file_is_a_mention(self, repo):
        put(repo, "wiki/Modules/target.md", "x")
        spec = '{"required_context": ["wiki/Modules/target.md"]}'
        put(repo, ".ai/tasks/T-1/spec.json", spec, kind=None)
        put(repo, "wiki/prose.md", "Read `wiki/Modules/target.md` first.\n")
        put(repo, "wiki/Modules/self.md", "Read [me](self.md) and wiki/Modules/self.md.\n")
        rows = doccorpus.inventory(repo)
        assert row(rows, "wiki/Modules/target.md")["inbound"] == [
            {"source": ".ai/tasks/T-1/spec.json", "kind": "mention"},
            {"source": "wiki/prose.md", "kind": "mention"},
        ]
        assert row(rows, "wiki/Modules/self.md")["inbound"] == []

    def test_last_commit_is_the_newest_that_touched_the_file(self, repo):
        put(repo, "wiki/a.md", "one")
        put(repo, "wiki/b.md", "one")
        commit(repo, "first")
        put(repo, "wiki/a.md", "two")
        second = commit(repo, "second")
        rows = doccorpus.inventory(repo)
        assert row(rows, "wiki/a.md")["last_commit"]["sha"] == second[:7]
        assert row(rows, "wiki/b.md")["last_commit"]["sha"] != second[:7]
        assert len(row(rows, "wiki/a.md")["last_commit"]["date"]) == len("2026-11-11")

    def test_a_staged_file_with_no_commit_has_none(self, repo):
        put(repo, "wiki/new.md", "x")
        assert row(doccorpus.inventory(repo), "wiki/new.md")["last_commit"] is None


class TestDupes:
    def test_an_exact_paragraph_repeat_is_grouped_with_its_lines(self, repo):
        put(repo, "wiki/a.md", "# A\n\n" + SENTENCE + "\n")
        put(repo, "wiki/b.md", "intro\n\n**" + SENTENCE.upper() + "**\n")
        result = doccorpus.dupes(repo)
        [group] = result["exact"]
        assert group["locations"] == ["wiki/a.md:6", "wiki/b.md:6"]
        assert group["words"] == len(SENTENCE.split())
        assert group["preview"].startswith("the feed service reads")

    def test_a_paragraph_spanning_lines_is_one_paragraph(self, repo):
        half = len(SENTENCE) // 2
        cut = SENTENCE.index(" ", half)
        put(repo, "wiki/a.md", SENTENCE[:cut] + "\n" + SENTENCE[cut + 1 :] + "\n")
        put(repo, "wiki/b.md", SENTENCE + "\n")
        [group] = doccorpus.dupes(repo)["exact"]
        assert group["locations"] == ["wiki/a.md:4", "wiki/b.md:4"]

    def test_short_paragraphs_and_fenced_code_are_ignored(self, repo):
        put(repo, "wiki/a.md", "## Steps\n\n```\n" + SENTENCE + "\n```\n")
        put(repo, "wiki/b.md", "## Steps\n\n```\n" + SENTENCE + "\n```\n")
        assert doccorpus.dupes(repo) == {"exact": [], "near": []}

    def test_a_near_duplicate_is_paired_with_its_similarity(self, repo):
        near = SENTENCE.replace("newest first", "newest at the top")
        put(repo, "wiki/a.md", SENTENCE + "\n")
        put(repo, "wiki/b.md", near + "\n")
        result = doccorpus.dupes(repo, threshold=0.6)
        assert result["exact"] == []
        [pair] = result["near"]
        assert (pair["a"], pair["b"]) == ("wiki/a.md:4", "wiki/b.md:4")
        assert 0.6 <= pair["similarity"] < 1.0

    def test_the_threshold_excludes_a_distant_paragraph(self, repo):
        put(repo, "wiki/a.md", SENTENCE + "\n")
        put(repo, "wiki/b.md", SENTENCE.replace("newest first", "newest at the top") + "\n")
        assert doccorpus.dupes(repo, threshold=0.95)["near"] == []

    def test_paths_limit_the_scan(self, repo):
        put(repo, "wiki/a.md", SENTENCE + "\n")
        put(repo, "other/b.md", SENTENCE + "\n")
        assert doccorpus.dupes(repo, paths=["wiki/"])["exact"] == []


class TestArchiveRefs:
    def test_pr_numbers_and_commit_hashes_are_rewritten_on_a_dry_run_only(self, repo):
        put(repo, "wiki/a.md", "seed\n")
        sha = commit(repo)[:7]
        body = f"Merged in #12 and PR `#384`, at {sha}.\n"
        p = put(repo, "wiki/a.md", body)
        changes = doccorpus.archive_refs(repo)
        assert [(c.path, c.line) for c in changes] == [("wiki/a.md", 4)]
        assert changes[0].new == (
            f"Merged in fanwire-archive#12 and PR `fanwire-archive#384`, "
            f"at fanwire-archive@{sha}.\n"
        )
        assert p.read_text(encoding="utf-8").endswith(body)

    def test_write_applies_the_change_and_a_second_run_finds_nothing(self, repo):
        put(repo, "wiki/a.md", "seed\n")
        sha = commit(repo)
        p = put(repo, "wiki/a.md", f"See #7 and {sha}.\r\nNext line.\r\n")
        doccorpus.archive_refs(repo, write=True)
        assert p.read_bytes().endswith(
            f"See fanwire-archive#7 and fanwire-archive@{sha}.\r\nNext line.\r\n".encode()
        )
        assert doccorpus.archive_refs(repo) == []

    @pytest.mark.parametrize(
        "text",
        [
            "# Heading",
            "a [link](#12-heading) and [b](page.md#3)",
            "colour #595959 and #0066FF",
            "issue#12 and &#123; and a/#12",
            "`#012`",
        ],
    )
    def test_what_is_not_a_pr_number(self, repo, text):
        put(repo, "wiki/a.md", text + "\n")
        assert doccorpus.archive_refs(repo) == []

    def test_a_hex_word_that_is_not_a_commit_is_left(self, repo):
        put(repo, "wiki/a.md", "seed\n")
        commit(repo)
        put(repo, "wiki/a.md", "migration `e6d7328e8881` and deadbeef1 and cafe123\n")
        assert doccorpus.archive_refs(repo) == []

    def test_fenced_code_is_left(self, repo):
        put(repo, "wiki/a.md", "seed\n")
        sha = commit(repo)[:7]
        put(repo, "wiki/a.md", f"```\ngit show {sha}  # 12 #12\n```\n")
        assert doccorpus.archive_refs(repo) == []

    def test_github_history_urls_move_to_the_archive(self, repo):
        put(repo, "wiki/a.md", "seed\n")
        sha = commit(repo)
        url = "https://github.com/Owner/fanwire/"
        put(
            repo,
            "wiki/a.md",
            f"[#5]({url}pull/5), {url}commit/{sha} and {url}blob/main/README.md\n",
        )
        [change] = doccorpus.archive_refs(repo)
        archive = "https://github.com/Owner/fanwire-archive/"
        assert change.new == (
            f"[fanwire-archive#5]({archive}pull/5), {archive}commit/{sha} "
            f"and {url}blob/main/README.md\n"
        )

    def test_only_tracked_markdown_is_touched(self, repo):
        put(repo, "wiki/a.md", "seed\n")
        commit(repo)
        put(repo, "backend/app.py", "# fixes #12\n", kind=None)
        put(repo, ".ai/tasks/T-1/spec.json", '{"why": "#12"}', kind=None)
        (repo / "wiki/untracked.md").write_text("#12\n", encoding="utf-8")
        assert doccorpus.archive_refs(repo, write=True) == []
        assert (repo / "backend/app.py").read_text(encoding="utf-8").endswith("# fixes #12\n")

    def test_paths_limit_the_rewrite(self, repo):
        put(repo, "wiki/a.md", "#1\n")
        put(repo, "TODO/b.md", "#2\n")
        assert [c.path for c in doccorpus.archive_refs(repo, paths=["TODO/"])] == ["TODO/b.md"]


class TestTheCli:
    def test_inventory_json_and_text(self, repo):
        put(repo, "wiki/a.md", "word " * 3)
        out = run("inventory", "--root", str(repo), "--json")
        assert out.returncode == 0, out.stderr
        assert row(json.loads(out.stdout), "wiki/a.md")["words"] == 3
        text = run("inventory", "--root", str(repo), "--paths", "wiki/")
        assert text.returncode == 0, text.stderr
        assert "wiki/a.md" in text.stdout
        assert text.stdout.splitlines()[-1] == "docs inventory: 1 files, 3 words, 0 over budget"

    def test_dupes_json(self, repo):
        put(repo, "wiki/a.md", SENTENCE + "\n")
        put(repo, "wiki/b.md", SENTENCE + "\n")
        out = run("dupes", "--root", str(repo), "--json")
        assert out.returncode == 0, out.stderr
        assert len(json.loads(out.stdout)["exact"]) == 1

    def test_archive_refs_is_a_dry_run_unless_write_is_given(self, repo):
        p = put(repo, "wiki/a.md", "#9\n")
        dry = run("archive-refs", "--root", str(repo))
        assert dry.returncode == 0, dry.stderr
        assert dry.stdout.splitlines()[-1] == (
            "docs archive-refs: 1 lines in 1 files would change (dry run; --write applies)"
        )
        assert p.read_text(encoding="utf-8").endswith("#9\n")
        wet = run("archive-refs", "--root", str(repo), "--write")
        assert wet.returncode == 0, wet.stderr
        assert p.read_text(encoding="utf-8").endswith("fanwire-archive#9\n")


def test_the_real_corpus_is_measurable():
    """Every tracked Markdown file in this repository parses."""
    rows = doccorpus.inventory(ROOT)
    assert {r["path"] for r in rows} >= {"AGENTS.md", ".ai/docs/doclint.md"}
