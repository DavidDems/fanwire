"""Docs graph, step 1 (Prompts/49): `agentctl docs graph` writes `.ai/graph.json`.

The graph maps how tracked Markdown, task specs and the code files docs name
link to each other, so an agent can ask "what links to or from X" instead of
grepping. It reuses doclint's and doccorpus's readers, so the three never
disagree about what a link or a citation is. The file is generated, sorted
and byte-identical on a re-run, on any OS and whatever the sources' line
endings.

Every fixture is built in a throwaway repository.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from agentlib import docgraph

ROOT = Path(__file__).resolve().parents[2]
AGENTCTL = ROOT / ".ai" / "bin" / "agentctl.py"
GRAPH = ".ai/graph.json"


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
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q")
    return root


def put(repo, path, body, *, newline="\n"):
    p = repo / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(body.replace("\n", newline).encode("utf-8"))
    git(repo, "add", path)
    return p


def spec(repo, task, **fields):
    put(repo, f".ai/tasks/{task}/task.json", json.dumps({"task_id": task, **fields}))


def nodes(graph):
    return {n["path"]: n["kind"] for n in graph["nodes"]}


def edges(graph, kind=None):
    return [
        tuple(e.values())
        for e in graph["edges"]
        if kind is None or e["kind"] == kind
    ]


class TestNodes:
    def test_markdown_is_doc_a_task_spec_is_spec_and_a_named_file_is_code(self, repo):
        put(repo, "wiki/a.md", "Edit `backend/app/posts/service.py`.\n")
        put(repo, "wiki/b.md", "Nothing here.\n")
        put(repo, "backend/app/posts/service.py", "x = 1\n")
        put(repo, "backend/app/posts/unnamed.py", "x = 1\n")
        spec(repo, "T-1")
        put(repo, ".ai/tasks/T-1/brief.md", "Brief.\n")
        (repo / "wiki/untracked.md").write_text("x", encoding="utf-8")
        assert nodes(docgraph.build(repo)) == {
            ".ai/tasks/T-1/brief.md": "doc",
            ".ai/tasks/T-1/task.json": "spec",
            "backend/app/posts/service.py": "code",
            "wiki/a.md": "doc",
            "wiki/b.md": "doc",
        }

    def test_a_tracked_text_file_that_is_only_a_source_is_code(self, repo):
        put(repo, "wiki/a.md", "x\n")
        put(repo, "backend/app/main.py", '"""See wiki/a.md."""\n')
        graph = docgraph.build(repo)
        assert nodes(graph)["backend/app/main.py"] == "code"
        assert edges(graph) == [("backend/app/main.py", "wiki/a.md", "mention")]

    def test_the_graph_file_is_neither_a_node_nor_scanned(self, repo):
        put(repo, "wiki/a.md", "See [the graph](../.ai/graph.json).\n")
        put(repo, "wiki/b.md", "x\n")
        put(repo, GRAPH, '{"edges": ["wiki/b.md"]}\n')
        graph = docgraph.build(repo)
        assert GRAPH not in nodes(graph)
        assert edges(graph) == []


class TestLinks:
    def test_inline_reference_and_angle_links_resolve_like_doclint(self, repo):
        put(repo, "wiki/Modules/target.md", "# Head\n")
        put(repo, "wiki/Modules/rel.md", "See [t](target.md#head).\n")
        put(repo, "wiki/up.md", "See [t](Modules/target.md).\n")
        put(repo, "wiki/root.md", "See [t](wiki/Modules/target.md).\n")
        put(repo, "wiki/def.md", "See [t][x].\n\n[x]: Modules/target.md\n")
        put(repo, "wiki/angle.md", "See <./Modules/target.md>.\n")
        put(repo, "wiki/code.md", "Not a link: `[t](Modules/target.md)`.\n")
        put(repo, "wiki/web.md", "See [w](https://example.com/wiki/Modules/target.md).\n")
        assert edges(docgraph.build(repo), "link") == [
            ("wiki/Modules/rel.md", "wiki/Modules/target.md", "link"),
            ("wiki/angle.md", "wiki/Modules/target.md", "link"),
            ("wiki/def.md", "wiki/Modules/target.md", "link"),
            ("wiki/root.md", "wiki/Modules/target.md", "link"),
            ("wiki/up.md", "wiki/Modules/target.md", "link"),
        ]

    def test_a_link_to_a_tracked_code_file_targets_a_code_node(self, repo):
        put(repo, "wiki/a.md", "See [main](../backend/app/main.py#L1).\n")
        put(repo, "backend/app/main.py", "x = 1\n")
        graph = docgraph.build(repo)
        assert edges(graph) == [("wiki/a.md", "backend/app/main.py", "link")]
        assert nodes(graph)["backend/app/main.py"] == "code"

    def test_a_wikilink_is_its_own_kind(self, repo):
        put(repo, "wiki/Modules/target.md", "x\n")
        put(repo, "wiki/wl.md", "See [[wiki/Modules/target|the target]] and [[wiki/Modules/target#a]].\n")
        assert edges(docgraph.build(repo)) == [
            ("wiki/wl.md", "wiki/Modules/target.md", "wikilink")
        ]

    def test_a_link_to_an_untracked_path_targets_a_missing_node(self, repo):
        put(repo, "wiki/a.md", "See [gone](gone.md) and [untracked](u.md).\n")
        (repo / "wiki/u.md").write_text("x", encoding="utf-8")
        graph = docgraph.build(repo)
        assert edges(graph) == [
            ("wiki/a.md", "wiki/gone.md", "link"),
            ("wiki/a.md", "wiki/u.md", "link"),
        ]
        assert nodes(graph)["wiki/gone.md"] == "missing"
        assert nodes(graph)["wiki/u.md"] == "missing"

    def test_self_local_anchor_directory_and_outside_links_are_not_edges(self, repo):
        put(repo, "wiki/a.md", "# Top\n\n[me](a.md) [top](#top) [dir](../backend/) [out](../../x.md)\n")
        put(repo, "backend/app.py", "x = 1\n")
        assert docgraph.build(repo)["edges"] == []


class TestMentions:
    def test_markdown_naming_a_tracked_path_mentions_it(self, repo):
        put(repo, "wiki/a.md", "Read `wiki/b.md`, then edit backend/app/posts/service.py.\n")
        put(repo, "wiki/b.md", "x\n")
        put(repo, "backend/app/posts/service.py", "x = 1\n")
        assert edges(docgraph.build(repo)) == [
            ("wiki/a.md", "backend/app/posts/service.py", "mention"),
            ("wiki/a.md", "wiki/b.md", "mention"),
        ]

    def test_an_untracked_or_relative_name_is_not_a_mention(self, repo):
        put(repo, "wiki/a.md", "Edit backend/app/gone.py and b.md and service.py.\n")
        put(repo, "wiki/b.md", "x\n")
        put(repo, "backend/app/service.py", "x = 1\n")
        assert docgraph.build(repo)["edges"] == []

    def test_code_mentions_markdown_but_not_other_code(self, repo):
        put(repo, "wiki/a.md", "x\n")
        put(repo, "backend/app/other.py", "x = 1\n")
        put(repo, "backend/app/main.py", 'DOC = "wiki/a.md"\nOTHER = "backend/app/other.py"\n')
        assert edges(docgraph.build(repo)) == [("backend/app/main.py", "wiki/a.md", "mention")]

    def test_a_linked_target_is_not_also_a_mention(self, repo):
        put(repo, "wiki/a.md", "See [b](wiki/b.md), also named as wiki/b.md.\n")
        put(repo, "wiki/b.md", "x\n")
        assert edges(docgraph.build(repo)) == [("wiki/a.md", "wiki/b.md", "link")]


class TestCitations:
    def test_a_line_citation_carries_its_range(self, repo):
        put(repo, "backend/app/x.py", "a = 1\nb = 2\nc = 3\nd = 4\n")
        put(repo, "wiki/a.md", "See backend/app/x.py:3 and backend/app/x.py:2-4.\n")
        assert docgraph.build(repo)["edges"] == [
            {"source": "wiki/a.md", "target": "backend/app/x.py", "kind": "cites-line", "detail": "2-4"},
            {"source": "wiki/a.md", "target": "backend/app/x.py", "kind": "cites-line", "detail": "3"},
        ]

    def test_a_section_citation_carries_its_section(self, repo):
        put(repo, ".ai/docs/handoff.md", "## 10. Findings\n")
        put(repo, "wiki/a.md", "See `.ai/docs/handoff.md` §10.\n")
        assert docgraph.build(repo)["edges"] == [
            {"source": "wiki/a.md", "target": ".ai/docs/handoff.md", "kind": "cites-section", "detail": "§10"},
        ]

    def test_an_unambiguous_basename_or_stem_resolves_like_doclint(self, repo):
        put(repo, ".ai/docs/handoff.md", "## 10. Findings\n")
        put(repo, ".ai/bin/tool.py", "# See handoff.md §10, and handoff §10.\nx = 1\n")
        assert edges(docgraph.build(repo)) == [
            (".ai/bin/tool.py", ".ai/docs/handoff.md", "cites-section", "§10"),
        ]

    def test_a_bare_local_section_is_not_an_edge(self, repo):
        put(repo, "wiki/a.md", "## 2. Two\n\nSee §2.\n")
        assert docgraph.build(repo)["edges"] == []

    def test_a_citation_of_an_unknown_file_targets_a_missing_node(self, repo):
        put(repo, "wiki/a.md", "See backend/app/gone.py:12.\n")
        graph = docgraph.build(repo)
        assert edges(graph) == [("wiki/a.md", "backend/app/gone.py", "cites-line", "12")]
        assert nodes(graph)["backend/app/gone.py"] == "missing"

    def test_python_test_strings_are_data_not_citations(self, repo):
        put(repo, "backend/app/x.py", "a = 1\n")
        put(repo, ".ai/tests/test_x.py", 'CASE = "backend/app/x.py:1"\n')
        assert docgraph.build(repo)["edges"] == []


class TestSpecs:
    def test_required_context_and_allowed_paths_are_typed_edges(self, repo):
        put(repo, "wiki/CodeContext/Modules/0x01-users.md", "x\n")
        put(repo, "backend/app/users/service.py", "x = 1\n")
        spec(
            repo,
            "T-1",
            required_context=["wiki/CodeContext/Modules/0x01-users.md", "wiki/CodeContext/gone.md"],
            allowed_paths=[
                "backend/app/users/service.py",
                "backend/tests/users/**",
                "frontend/src/*.test.tsx",
                "backend/app/users/new.py",
                "wiki/CodeContext/Modules/0x01-users.md",
            ],
        )
        graph = docgraph.build(repo)
        source = ".ai/tasks/T-1/task.json"
        assert edges(graph) == [
            (source, "backend/app/users/new.py", "allowed_paths"),
            (source, "backend/app/users/service.py", "allowed_paths"),
            (source, "backend/tests/users/**", "allowed_paths"),
            (source, "frontend/src/*.test.tsx", "allowed_paths"),
            (source, "wiki/CodeContext/Modules/0x01-users.md", "allowed_paths"),
            (source, "wiki/CodeContext/Modules/0x01-users.md", "required_context"),
            (source, "wiki/CodeContext/gone.md", "required_context"),
        ]
        kinds = nodes(graph)
        assert kinds["backend/tests/users/**"] == "pattern"
        assert kinds["frontend/src/*.test.tsx"] == "pattern"
        assert kinds["backend/app/users/new.py"] == "missing"
        assert kinds["wiki/CodeContext/gone.md"] == "missing"
        assert kinds["backend/app/users/service.py"] == "code"

    def test_a_spec_naming_another_doc_in_prose_mentions_it(self, repo):
        put(repo, "wiki/a.md", "x\n")
        spec(repo, "T-1", goal="Follow wiki/a.md.")
        assert edges(docgraph.build(repo)) == [(".ai/tasks/T-1/task.json", "wiki/a.md", "mention")]

    def test_a_json_file_outside_a_task_folder_is_not_a_spec(self, repo):
        put(repo, "wiki/a.md", "x\n")
        put(repo, ".ai/tasks/T-1/notes/task.json", '{"required_context": ["wiki/a.md"]}')
        graph = docgraph.build(repo)
        assert nodes(graph)[".ai/tasks/T-1/notes/task.json"] == "code"
        assert edges(graph) == [(".ai/tasks/T-1/notes/task.json", "wiki/a.md", "mention")]


class TestExclusions:
    def test_fenced_code_is_not_a_source(self, repo):
        put(repo, "wiki/b.md", "x\n")
        put(repo, "backend/app/x.py", "a = 1\n")
        put(
            repo,
            "wiki/a.md",
            "```\n[b](b.md) wiki/b.md backend/app/x.py:1 [[wiki/b]]\n```\n"
            "~~~md\nwiki/b.md\n~~~\n",
        )
        assert docgraph.build(repo)["edges"] == []

    def test_a_fixture_is_a_node_but_never_a_source(self, repo):
        put(repo, "wiki/a.md", "See [f](../.ai/tests/fixtures/doc.md).\n")
        put(repo, ".ai/tests/fixtures/doc.md", "See [a](../../../wiki/a.md) and [gone](gone.md).\n")
        graph = docgraph.build(repo)
        assert edges(graph) == [("wiki/a.md", ".ai/tests/fixtures/doc.md", "link")]
        assert nodes(graph)[".ai/tests/fixtures/doc.md"] == "doc"


class TestDeterminism:
    def test_edges_are_deduplicated_and_sorted_and_nodes_sorted(self, repo):
        put(repo, "wiki/z.md", "[a](a.md) [a again](a.md#x) [m](m.md)\n")
        put(repo, "wiki/a.md", "[m](m.md) [z](z.md)\n")
        put(repo, "wiki/m.md", "x\n")
        graph = docgraph.build(repo)
        assert edges(graph) == [
            ("wiki/a.md", "wiki/m.md", "link"),
            ("wiki/a.md", "wiki/z.md", "link"),
            ("wiki/z.md", "wiki/a.md", "link"),
            ("wiki/z.md", "wiki/m.md", "link"),
        ]
        assert [n["path"] for n in graph["nodes"]] == ["wiki/a.md", "wiki/m.md", "wiki/z.md"]

    def test_two_builds_are_byte_identical(self, repo):
        put(repo, "wiki/a.md", "[b](b.md) `backend/app/x.py:1` [[wiki/b]] see wiki/c.md\n")
        put(repo, "wiki/b.md", "x\n")
        put(repo, "wiki/c.md", "[gone](gone.md)\n")
        put(repo, "backend/app/x.py", "a = 1\n")
        spec(repo, "T-1", required_context=["wiki/b.md"], allowed_paths=["backend/**"])
        assert docgraph.dumps(docgraph.build(repo)) == docgraph.dumps(docgraph.build(repo))

    def test_line_endings_in_sources_do_not_change_the_graph(self, tmp_path):
        out = []
        for name, newline in (("lf", "\n"), ("crlf", "\r\n")):
            root = tmp_path / name
            root.mkdir()
            git(root, "init", "-q")
            put(root, "wiki/a.md", "# A\n\n[b](b.md)\nsee backend/app/x.py:2-3\n", newline=newline)
            put(root, "wiki/b.md", "## 1. One\n", newline=newline)
            put(root, "backend/app/x.py", "a = 1\nb = 2\nc = 3\n", newline=newline)
            put(root, "wiki/c.md", "```\n[b](b.md)\n```\nSee wiki/b.md §1.\n", newline=newline)
            out.append(docgraph.dumps(docgraph.build(root)))
        assert out[0] == out[1]
        assert "\r" not in out[0]

    def test_the_serialised_layout_is_one_record_per_line(self, repo):
        put(repo, "wiki/a.md", "[b](b.md) see backend/app/x.py:1\n")
        put(repo, "wiki/b.md", "Café.\n")
        put(repo, "backend/app/x.py", "a = 1\n")
        assert docgraph.dumps(docgraph.build(repo)) == (
            "{\n"
            '  "version": 1,\n'
            '  "nodes": [\n'
            '    {"path": "backend/app/x.py", "kind": "code"},\n'
            '    {"path": "wiki/a.md", "kind": "doc"},\n'
            '    {"path": "wiki/b.md", "kind": "doc"}\n'
            "  ],\n"
            '  "edges": [\n'
            '    {"source": "wiki/a.md", "target": "backend/app/x.py", "kind": "cites-line", "detail": "1"},\n'
            '    {"source": "wiki/a.md", "target": "wiki/b.md", "kind": "link"}\n'
            "  ]\n"
            "}\n"
        )

    def test_an_empty_graph_serialises_with_empty_arrays(self, repo):
        put(repo, "backend/app/x.py", "a = 1\n")
        assert docgraph.dumps(docgraph.build(repo)) == (
            '{\n  "version": 1,\n  "nodes": [],\n  "edges": []\n}\n'
        )

    def test_non_ascii_paths_are_escaped(self, repo):
        put(repo, "wiki/café.md", "x\n")
        text = docgraph.dumps(docgraph.build(repo))
        assert '"wiki/caf\\u00e9.md"' in text
        text.encode("ascii")


def run(*args):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return subprocess.run(
        [sys.executable, str(AGENTCTL), "docs", *args],
        capture_output=True,
        text=True,
        env=env,
    )


class TestCli:
    def test_docs_graph_writes_the_graph_file(self, repo):
        put(repo, "wiki/a.md", "[b](b.md)\n")
        put(repo, "wiki/b.md", "x\n")
        result = run("graph", "--root", str(repo))
        assert result.returncode == 0, result.stderr
        written = (repo / GRAPH).read_bytes()
        assert written == docgraph.dumps(docgraph.build(repo)).encode("ascii")
        assert b"\r" not in written
        assert "2 nodes, 1 edges" in result.stdout
        again = run("graph", "--root", str(repo))
        assert again.returncode == 0, again.stderr
        assert (repo / GRAPH).read_bytes() == written

    def test_a_root_that_is_not_a_repository_is_a_usage_error(self, tmp_path):
        result = run("graph", "--root", str(tmp_path))
        assert result.returncode == 2
        assert "docs graph:" in result.stderr
