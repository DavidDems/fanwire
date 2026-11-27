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


# --- Step 2: queries over the committed graph (`--of`, `--within`, `--task`). ---

SPEC = ".ai/tasks/T-1/task.json"


def _node(path, kind):
    return {"path": path, "kind": kind}


def _edge(source, target, kind, detail=""):
    edge = {"source": source, "target": target, "kind": kind}
    if detail:
        edge["detail"] = detail
    return edge


def small_graph():
    """A hand-built graph: a cycle a -> b -> c -> a, a hub `a`, a spec, a broken link."""
    return {
        "version": docgraph.VERSION,
        "nodes": [
            _node(SPEC, "spec"),
            _node("backend/**", "pattern"),
            _node("backend/x.py", "code"),
            _node("wiki/a.md", "doc"),
            _node("wiki/b.md", "doc"),
            _node("wiki/c.md", "doc"),
            _node("wiki/d.md", "doc"),
            _node("wiki/e.md", "doc"),
            _node("wiki/gone.md", "missing"),
        ],
        "edges": [
            _edge(SPEC, "backend/**", "allowed_paths"),
            _edge(SPEC, "backend/x.py", "allowed_paths"),
            _edge(SPEC, "wiki/a.md", "required_context"),
            _edge("wiki/a.md", "backend/x.py", "cites-line", "3"),
            _edge("wiki/a.md", "wiki/b.md", "link"),
            _edge("wiki/a.md", "wiki/e.md", "mention"),
            _edge("wiki/b.md", "wiki/c.md", "wikilink"),
            _edge("wiki/b.md", "wiki/gone.md", "link"),
            _edge("wiki/c.md", "wiki/a.md", "link"),
            _edge("wiki/c.md", "wiki/d.md", "link"),
            _edge("wiki/d.md", "wiki/a.md", "mention"),
        ],
    }


def reached(view):
    return [(n["path"], n["distance"]) for n in view["nodes"]]


class TestOf:
    def test_outbound_and_inbound_edges_with_kind_and_detail(self):
        view = docgraph.of(small_graph(), "wiki/a.md")
        assert view["path"] == "wiki/a.md"
        assert view["kind"] == "doc"
        assert view["out"] == [
            {"target": "backend/x.py", "kind": "cites-line", "detail": "3"},
            {"target": "wiki/b.md", "kind": "link"},
            {"target": "wiki/e.md", "kind": "mention"},
        ]
        assert view["in"] == [
            {"source": SPEC, "kind": "required_context"},
            {"source": "wiki/c.md", "kind": "link"},
            {"source": "wiki/d.md", "kind": "mention"},
        ]

    def test_a_node_with_no_edges_has_empty_lists(self):
        graph = small_graph()
        graph["nodes"].append(_node("wiki/lonely.md", "doc"))
        assert docgraph.of(graph, "wiki/lonely.md") == {
            "path": "wiki/lonely.md",
            "kind": "doc",
            "out": [],
            "in": [],
        }

    @pytest.mark.parametrize("given", ["./wiki/a.md", "wiki\\a.md", ".\\wiki\\a.md", " wiki/a.md "])
    def test_a_dot_slash_prefix_or_backslashes_are_normalised(self, given):
        assert docgraph.of(small_graph(), given)["path"] == "wiki/a.md"

    def test_an_unknown_path_raises_with_basename_hints(self):
        with pytest.raises(docgraph.UnknownNode) as err:
            docgraph.of(small_graph(), "docs/a.md")
        assert err.value.hints == ["wiki/a.md"]
        assert "docs/a.md" in str(err.value)

    def test_an_unknown_path_with_no_close_match_has_no_hints(self):
        with pytest.raises(docgraph.UnknownNode) as err:
            docgraph.of(small_graph(), "zzz/qqq.txt")
        assert err.value.hints == []


class TestWithin:
    def test_depth_one_reaches_both_directions_once(self):
        view = docgraph.within(small_graph(), "wiki/a.md", 1)
        assert view["path"] == "wiki/a.md" and view["depth"] == 1
        assert reached(view) == [
            ("wiki/a.md", 0),
            (SPEC, 1),
            ("backend/x.py", 1),
            ("wiki/b.md", 1),
            ("wiki/c.md", 1),
            ("wiki/d.md", 1),
            ("wiki/e.md", 1),
        ]

    def test_each_reached_node_says_how_it_was_reached(self):
        found = {n["path"]: n for n in docgraph.within(small_graph(), "wiki/b.md", 2)["nodes"]}
        assert "via" not in found["wiki/b.md"]
        assert found["wiki/c.md"]["via"] == {"from": "wiki/b.md", "direction": "out", "kind": "wikilink"}
        assert found["wiki/a.md"]["via"] == {"from": "wiki/b.md", "direction": "in", "kind": "link"}
        assert found["wiki/c.md"]["kind"] == "doc"
        assert found["wiki/gone.md"]["kind"] == "missing"

    def test_depth_bounds_the_walk_and_a_cycle_is_visited_once(self):
        graph = small_graph()
        assert reached(docgraph.within(graph, "wiki/b.md", 0)) == [("wiki/b.md", 0)]
        one = reached(docgraph.within(graph, "wiki/b.md", 1))
        assert one == [("wiki/b.md", 0), ("wiki/a.md", 1), ("wiki/c.md", 1), ("wiki/gone.md", 1)]
        two = reached(docgraph.within(graph, "wiki/b.md", 2))
        assert two == one + [
            (SPEC, 2),
            ("backend/x.py", 2),
            ("wiki/d.md", 2),
            ("wiki/e.md", 2),
        ]
        assert len({p for p, _ in two}) == len(two)
        assert reached(docgraph.within(graph, "wiki/b.md", 9))[-1] == ("backend/**", 3)

    def test_a_negative_depth_is_an_error(self):
        with pytest.raises(ValueError):
            docgraph.within(small_graph(), "wiki/a.md", -1)

    def test_an_unknown_path_raises(self):
        with pytest.raises(docgraph.UnknownNode):
            docgraph.within(small_graph(), "wiki/nope.md", 1)


class TestTaskView:
    def test_context_its_linked_docs_to_depth_and_allowed_paths(self):
        view = docgraph.task_view(small_graph(), "T-1", 1)
        assert view["task"] == "T-1"
        assert view["spec"] == SPEC
        assert view["depth"] == 1
        assert view["required_context"] == [{"path": "wiki/a.md", "kind": "doc"}]
        # Mentions and code citations are not followed: only doc->doc links and wikilinks.
        assert view["linked"] == [
            {"path": "wiki/b.md", "kind": "doc", "distance": 1, "via": "wiki/a.md"}
        ]
        assert view["allowed_paths"] == ["backend/**", "backend/x.py"]

    def test_depth_follows_outbound_links_only_skips_missing_and_stops_at_a_cycle(self):
        graph = small_graph()
        assert docgraph.task_view(graph, "T-1", 0)["linked"] == []
        deep = docgraph.task_view(graph, "T-1", 3)["linked"]
        assert [(n["path"], n["distance"], n["via"]) for n in deep] == [
            ("wiki/b.md", 1, "wiki/a.md"),
            ("wiki/c.md", 2, "wiki/b.md"),
            ("wiki/d.md", 3, "wiki/c.md"),
        ]
        assert docgraph.task_view(graph, "T-1", 9)["linked"] == deep

    def test_a_missing_context_entry_is_listed_with_its_kind(self):
        graph = small_graph()
        graph["nodes"].append(_node("wiki/CodeContext/gone.md", "missing"))
        graph["edges"].append(_edge(SPEC, "wiki/CodeContext/gone.md", "required_context"))
        assert docgraph.task_view(graph, "T-1", 1)["required_context"] == [
            {"path": "wiki/CodeContext/gone.md", "kind": "missing"},
            {"path": "wiki/a.md", "kind": "doc"},
        ]

    def test_an_unknown_task_raises(self):
        with pytest.raises(docgraph.UnknownNode) as err:
            docgraph.task_view(small_graph(), "NOPE-1", 1)
        assert "NOPE-1" in str(err.value)


class TestCompactPaths:
    def test_files_sharing_a_directory_are_one_row(self):
        assert docgraph.compact_paths(
            ["a/b/x.py", "a/b/y.py", "a/c.py", "a/b/**", "top.md"]
        ) == ["a/b/ {**, x.py, y.py}", "a/c.py", "top.md"]


class TestLoad:
    def test_load_reads_the_committed_file(self, repo):
        put(repo, "wiki/a.md", "[b](b.md)\n")
        put(repo, "wiki/b.md", "x\n")
        written = docgraph.write(repo)
        assert docgraph.load(repo) == written

    def test_a_missing_file_raises(self, repo):
        with pytest.raises(docgraph.GraphError, match="agentctl docs graph"):
            docgraph.load(repo)

    @pytest.mark.parametrize(
        "body", ['{"version": 99, "nodes": [], "edges": []}', "not json", "[]"]
    )
    def test_an_unknown_version_or_bad_file_raises(self, repo, body):
        (repo / ".ai").mkdir()
        (repo / GRAPH).write_text(body, encoding="utf-8")
        with pytest.raises(docgraph.GraphError):
            docgraph.load(repo)


@pytest.fixture
def built(repo):
    put(repo, "wiki/hub.md", "Hub.\n")
    for i in range(5):
        put(repo, f"wiki/s{i}.md", "[hub](hub.md)\n")
    put(repo, "wiki/CodeContext/ctx.md", "See [hub](../hub.md).\n")
    spec(
        repo,
        "T-1",
        required_context=["wiki/CodeContext/ctx.md"],
        allowed_paths=["backend/app/a.py", "backend/app/b.py"],
    )
    assert run("graph", "--root", str(repo)).returncode == 0
    return repo


def query(repo, *args):
    return run("graph", "--root", str(repo), *args)


class TestQueryCli:
    def test_of_prints_a_header_grouped_edges_and_a_summary(self, built):
        result = query(built, "--of", "wiki/CodeContext/ctx.md")
        assert result.returncode == 0, result.stderr
        lines = result.stdout.splitlines()
        assert lines[0] == "wiki/CodeContext/ctx.md  (doc)"
        assert lines[1].split() == ["out", "link", "wiki/hub.md"]
        assert lines[2].split() == ["in", "required_context", SPEC]
        assert lines[-1] == "docs graph: 1 out, 1 in"

    def test_of_does_not_rebuild_the_graph(self, built):
        before = (built / GRAPH).read_bytes()
        put(built, "wiki/new.md", "[hub](hub.md)\n")
        result = query(built, "--of", "wiki/hub.md")
        assert result.returncode == 0, result.stderr
        assert "wiki/new.md" not in result.stdout
        assert (built / GRAPH).read_bytes() == before

    def test_limit_caps_rows_with_a_more_line(self, built):
        result = query(built, "--of", "wiki/hub.md", "--limit", "2")
        assert result.returncode == 0, result.stderr
        rows = [line for line in result.stdout.splitlines() if line.startswith("  ")]
        assert len(rows) == 3
        assert rows[-1].strip() == "... 4 more"
        assert result.stdout.splitlines()[-1] == "docs graph: 0 out, 6 in"

    def test_of_json_shape(self, built):
        result = query(built, "--of", "./wiki/hub.md", "--json")
        assert result.returncode == 0, result.stderr
        data = json.loads(result.stdout)
        assert data["path"] == "wiki/hub.md"
        assert data["out"] == []
        assert {"source": "wiki/s0.md", "kind": "link"} in data["in"]
        assert data["more"] == 0

    def test_json_honours_the_limit(self, built):
        data = json.loads(query(built, "--of", "wiki/hub.md", "--json", "--limit", "2").stdout)
        assert len(data["in"]) == 2
        assert data["more"] == 4

    def test_within_lists_reached_nodes_with_distance(self, built):
        result = query(built, "--of", "wiki/CodeContext/ctx.md", "--within", "2")
        assert result.returncode == 0, result.stderr
        lines = result.stdout.splitlines()
        assert lines[0].startswith("wiki/CodeContext/ctx.md  (doc)")
        assert any(line.split()[:4] == ["1", "out", "link", "wiki/hub.md"] for line in lines)
        assert any(
            line.split()[:4] == ["2", "in", "link", "wiki/s3.md"] and "via wiki/hub.md" in line
            for line in lines
        )
        assert lines[-1] == "docs graph: 10 nodes within 2 of wiki/CodeContext/ctx.md"

    def test_within_json_shape(self, built):
        data = json.loads(query(built, "--of", "wiki/hub.md", "--within", "1", "--json").stdout)
        assert data["path"] == "wiki/hub.md" and data["depth"] == 1
        assert data["nodes"][0] == {"path": "wiki/hub.md", "kind": "doc", "distance": 0}
        assert len(data["nodes"]) == 7 and data["more"] == 0

    def test_task_view(self, built):
        result = query(built, "--task", "T-1")
        assert result.returncode == 0, result.stderr
        lines = result.stdout.splitlines()
        assert lines[0] == f"T-1  {SPEC}"
        assert lines[1].split() == ["context", "wiki/CodeContext/ctx.md"]
        assert lines[2].split()[:3] == ["1", "link", "wiki/hub.md"]
        assert "via wiki/CodeContext/ctx.md" in lines[2]
        assert lines[3].split() == ["allowed", "backend/app/", "{a.py,", "b.py}"]
        assert lines[-1] == "docs graph: 1 context, 1 linked within 1, 2 allowed"

    def test_task_view_json(self, built):
        data = json.loads(query(built, "--task", "T-1", "--within", "0", "--json").stdout)
        assert data["task"] == "T-1" and data["depth"] == 0
        assert data["required_context"] == [{"path": "wiki/CodeContext/ctx.md", "kind": "doc"}]
        assert data["linked"] == []
        assert data["allowed_paths"] == ["backend/app/a.py", "backend/app/b.py"]

    def test_an_unknown_task_is_a_usage_error(self, built):
        result = query(built, "--task", "NOPE-9")
        assert result.returncode == 2
        assert "NOPE-9" in result.stderr

    def test_an_unknown_path_is_a_usage_error_with_a_hint(self, built):
        result = query(built, "--of", "docs/hub.md")
        assert result.returncode == 2
        assert "docs/hub.md" in result.stderr
        assert "wiki/hub.md" in result.stderr

    def test_a_backslash_path_is_accepted(self, built):
        result = query(built, "--of", "wiki\\hub.md")
        assert result.returncode == 0, result.stderr

    def test_a_missing_graph_file_is_a_usage_error(self, repo):
        put(repo, "wiki/a.md", "x\n")
        result = query(repo, "--of", "wiki/a.md")
        assert result.returncode == 2
        assert "not found" in result.stderr and "agentctl docs graph" in result.stderr
        assert not (repo / GRAPH).exists()

    def test_an_unknown_graph_version_is_a_usage_error(self, built):
        (built / GRAPH).write_text('{"version": 99, "nodes": [], "edges": []}\n', encoding="utf-8")
        result = query(built, "--of", "wiki/hub.md")
        assert result.returncode == 2
        assert "version" in result.stderr

    @pytest.mark.parametrize(
        "args",
        [
            ("--of", "wiki/hub.md", "--task", "T-1"),
            ("--within", "1"),
            ("--json",),
            ("--limit", "3"),
            ("--of", "wiki/hub.md", "--limit", "0"),
            ("--of", "wiki/hub.md", "--within", "-1"),
        ],
    )
    def test_bad_flag_combinations_are_usage_errors(self, built, args):
        before = (built / GRAPH).read_bytes()
        result = query(built, *args)
        assert result.returncode == 2
        assert (built / GRAPH).read_bytes() == before
