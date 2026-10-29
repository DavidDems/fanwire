"""Prompt 10: fixture documents, exact debt and a base-relative ratchet.

Do not weaken the workflow's pinned non-test-job rationale: docs failures
must route a worker baseline to manager review, never authorize coding.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from agentlib import doclint

ROOT = Path(__file__).resolve().parents[2]


def git(root, *args):
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True,
        env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init")
    git(tmp_path, "config", "user.email", "fixture@example.invalid")
    git(tmp_path, "config", "user.name", "Fixture")
    skill = tmp_path / ".claude/skills/wiki-update/SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text((ROOT / skill.relative_to(tmp_path)).read_text(encoding="utf-8"), encoding="utf-8")
    return tmp_path


def put(repo, path, body, kind="reference"):
    p = repo / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text((f"---\ntype: {kind}\n---\n" if kind else "") + body, encoding="utf-8")
    git(repo, "add", path)
    return p


def codes(repo, **kwargs):
    return {v.rule for v in doclint.scan(repo, **kwargs)}


def commit(repo):
    git(repo, "add", ".")
    git(repo, "commit", "-m", "fixture")
    return git(repo, "rev-parse", "HEAD")


def test_types_budgets_and_body_count_use_shared_skill(repo):
    budgets = doclint.load_budgets(repo)
    assert budgets == dict(reference=2500, decision=1800, runbook=1500, prompt=1500, changelog=1000)
    put(repo, "wiki/good.md", "word " * 2500)
    assert not codes(repo)
    put(repo, "wiki/good.md", "word " * 2501)
    assert "budget" in codes(repo)
    put(repo, "wiki/bad.md", "text", "made-up")
    put(repo, "wiki/missing.md", "text", None)
    assert "frontmatter" in codes(repo)


def test_malformed_and_duplicate_type_are_rejected(repo):
    put(repo, "wiki/a.md", "---\ntype: reference\ntype: prompt\n---\nbody", None)
    assert "frontmatter" in codes(repo)


def test_links_anchors_wikilinks_references_and_citations(repo):
    put(repo, "wiki/target.md", "# Hello world\n## 2. Choice\n## Hello world\n")
    put(repo, "wiki/source.md", "[ok](target.md#hello-world-1)\n[ref][x]\n[x]: target.md#hello-world\n"
        "[[wiki/target#hello-world|target]]\n`wiki/target.md:2` and `wiki/target.md` §2\n"
        "[web](https://example.invalid)\n[mail](mailto:a@example.invalid)\n")
    assert not codes(repo)
    put(repo, "wiki/source.md", "[bad](target.md#absent)\n[missing](no.md)\n[bad][absent]\n"
        "`wiki/target.md:999`\n`wiki/target.md` §9\n[[wiki/missing|missing]]\n")
    assert {"link", "citation"} <= codes(repo)
    put(repo, "app.py", '# See wiki/target.md §99\n', None)
    assert any(v.path == "app.py" and v.rule == "citation" for v in doclint.scan(repo))


def test_fences_are_examples_but_real_links_cannot_escape_repo(repo):
    put(repo, "wiki/a.md", "```md\n[example](missing.md)\n```\n[escape](../../outside.md)\n")
    violations = doclint.scan(repo)
    assert len(violations) == 1 and violations[0].rule == "link"


@pytest.mark.parametrize("text", ["> **Status, 2026-10-12**", "**Update, 2026**", "As of 2026-10-12", "## Current status\nold"])
def test_reference_status_debt(repo, text):
    put(repo, "wiki/a.md", text)
    assert "reference-history" in codes(repo)
    put(repo, "wiki/a.md", text, "prompt")
    assert "reference-history" not in codes(repo)


def test_forty_word_runs_are_case_insensitive_and_stable_under_line_moves(repo):
    words = " ".join(f"word{i}" for i in range(40))
    put(repo, "wiki/a.md", words)
    put(repo, "wiki/b.md", words.upper())
    first = {v.key for v in doclint.scan(repo) if v.rule == "duplicate"}
    assert first
    put(repo, "wiki/a.md", "\n\n" + words)
    assert first == {v.key for v in doclint.scan(repo) if v.rule == "duplicate"}
    put(repo, "wiki/b.md", " ".join(words.split()[:39]))
    assert "duplicate" not in codes(repo)


def test_merged_decision_only_allows_supersession(repo):
    p = put(repo, "wiki/001-choice.md", "# Choice\nOriginal\n", "decision")
    base = commit(repo)
    p.write_text(p.read_text().replace("type: decision", "type: decision\nsuperseded_by: 002-next.md"))
    put(repo, "wiki/002-next.md", "# Next\nReplacement", "decision")
    assert "decision-changed" not in codes(repo, base=base)
    p.write_text(p.read_text().replace("Original", "Rewritten"))
    assert "decision-changed" in codes(repo, base=base)
    p.unlink()
    assert "decision-changed" in codes(repo, base=base)


def test_exact_baseline_and_base_subset(repo):
    put(repo, "wiki/a.md", "legacy", None)
    keys = {v.key for v in doclint.scan(repo)}
    assert not doclint.ratchet(keys, keys, keys)
    assert doclint.ratchet(keys | {"new"}, keys, keys)
    assert doclint.ratchet(set(), keys, keys)  # stale entry must be removed
    assert doclint.ratchet(keys | {"new"}, keys | {"new"}, keys)
    assert not doclint.ratchet(set(), set(), keys)


def test_cli_and_ci_require_base_ratchet(repo):
    put(repo, "wiki/a.md", "legacy", None)
    baseline = repo / ".ai/docs-baseline.json"
    baseline.parent.mkdir(exist_ok=True)
    baseline.write_text(json.dumps(sorted(v.key for v in doclint.scan(repo))))
    base = commit(repo)
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["AGENTCTL_DATA_ROOT"] = str(repo)
    def run():
        return subprocess.run([sys.executable, str(ROOT / ".ai/bin/agentctl.py"), "docs", "lint", "--base", base, "--json"], env=env, capture_output=True, text=True)
    assert run().returncode == 0
    put(repo, "wiki/b.md", "new debt", None)
    baseline.write_text(json.dumps(sorted(v.key for v in doclint.scan(repo))))
    result = run()
    assert result.returncode == 1
    assert json.loads(result.stdout)["errors"]
    wf = (ROOT / ".github/workflows/test-agent.yml").read_text()
    block = wf.split("\n  docs-lint:\n")[1].split("\n  #", 1)[0]
    assert "fetch-depth: 0" in block
    assert "docs lint --base" in block
    assert "github.event.pull_request.base.sha" in block
    assert "github.event.before" in block
    assert "      - docs-lint\n" in wf.split("\n  gate:\n")[1]


def test_shortcut_links_setext_headings_and_exact_sections(repo):
    put(repo, "wiki/a.md", "A heading\n=========\n## 2.1 Child\n<a name=\"legacy\"></a>\n")
    put(repo, "wiki/b.md", "[shortcut]\n[shortcut]: a.md#a-heading\n[html](a.md#legacy)\n")
    assert not codes(repo)
    put(repo, "wiki/b.md", "[broken]\n[broken]: missing.md\n`wiki/a.md` §2\n`wiki/a.md:1-999`\n")
    assert sum(v.rule == "citation" for v in doclint.scan(repo)) == 2


def test_merged_decision_frontmatter_cannot_be_rewritten(repo):
    p = put(repo, "wiki/001-choice.md", "# Choice", "decision")
    base = commit(repo)
    p.write_text(p.read_text().replace("type: decision", 'type: "decision"'))
    assert "decision-changed" in codes(repo, base=base)


def test_missing_base_baseline_cannot_reset_existing_linter(repo):
    put(repo, "wiki/a.md", "# A")
    put(repo, ".ai/agentlib/doclint.py", "# existing linter", None)
    base = commit(repo)
    (repo / ".ai/docs-baseline.json").write_text("[]")
    with pytest.raises(ValueError, match="no documentation baseline"):
        doclint.lint(repo, base=base)


def test_baseline_parser_rejects_duplicates_and_unordered_entries():
    for bad in ['{}', '["b", "a"]', '["a", "a"]', '[1]']:
        with pytest.raises(ValueError):
            doclint.read_baseline(bad)
