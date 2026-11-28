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

    def test_an_untracked_name_is_not_a_mention(self, repo):
        put(repo, "wiki/a.md", "Edit backend/app/gone.py and c.md and service.py.\n")
        put(repo, "wiki/b.md", "x\n")
        put(repo, "backend/app/service.py", "x = 1\n")
        assert docgraph.build(repo)["edges"] == []

    def test_markdown_naming_a_path_relative_to_its_folder_mentions_it(self, repo):
        # A skill's SKILL.md names `references/patterns.md` beside itself.
        put(repo, ".claude/skills/s/SKILL.md", "Consult `references/patterns.md` and b.md.\n")
        put(repo, ".claude/skills/s/references/patterns.md", "x\n")
        put(repo, ".claude/skills/s/b.md", "x\n")
        assert edges(docgraph.build(repo)) == [
            (".claude/skills/s/SKILL.md", ".claude/skills/s/b.md", "mention"),
            (".claude/skills/s/SKILL.md", ".claude/skills/s/references/patterns.md", "mention"),
        ]

    def test_a_root_path_wins_over_a_relative_reading(self, repo):
        put(repo, "wiki/a.md", "Read wiki/b.md.\n")
        put(repo, "wiki/b.md", "x\n")
        put(repo, "wiki/wiki/b.md", "x\n")
        assert edges(docgraph.build(repo)) == [("wiki/a.md", "wiki/b.md", "mention")]

    def test_code_names_resolve_from_the_root_only(self, repo):
        put(repo, "backend/app/a.md", "x\n")
        put(repo, "backend/app/main.py", 'DOC = "a.md"\n')
        assert docgraph.build(repo)["edges"] == []

    def test_a_relative_name_leaving_the_repository_is_not_a_mention(self, repo):
        put(repo, "a.md", "See ../outside.md.\n")
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


# --- Step 3: orphans, dangling edges and the `--check` ratchet. -------------

BASELINE = ".ai/graph-baseline.json"


def debt_keys(repo):
    return sorted(docgraph.debt_keys(docgraph.debt(repo)))


class TestOrphans:
    def test_a_doc_nothing_links_to_is_an_orphan(self, repo):
        put(repo, "wiki/a.md", "[b](b.md)\n")
        put(repo, "wiki/b.md", "x\n")
        assert docgraph.debt(repo)["orphans"] == ["wiki/a.md"]

    def test_a_self_link_does_not_save_a_doc(self, repo):
        put(repo, "wiki/a.md", "[me](a.md)\n")
        assert docgraph.debt(repo)["orphans"] == ["wiki/a.md"]

    def test_any_inbound_edge_counts_mentions_and_code_included(self, repo):
        put(repo, "wiki/a.md", "x\n")
        put(repo, "wiki/b.md", "x\n")
        put(repo, "wiki/c.md", "Read `wiki/a.md`.\n")
        put(repo, "backend/app/main.py", '"""See wiki/b.md."""\n')
        assert docgraph.debt(repo)["orphans"] == ["wiki/c.md"]

    def test_a_spec_required_context_saves_a_doc(self, repo):
        put(repo, "wiki/CodeContext/ctx.md", "x\n")
        spec(repo, "T-1", required_context=["wiki/CodeContext/ctx.md"])
        assert docgraph.debt(repo)["orphans"] == []

    def test_only_docs_are_orphans(self, repo):
        spec(repo, "T-1")
        put(repo, "backend/app/x.py", '"""Names wiki/a.md."""\n')
        put(repo, "wiki/a.md", "x\n")
        assert docgraph.debt(repo)["orphans"] == []

    @pytest.mark.parametrize(
        "path",
        [
            "index.md",
            "wiki/index.md",
            "wiki/GeneralContext/index.md",
            "README.md",
            ".ai/README.md",
            "AGENTS.md",
            "CLAUDE.md",
            "frontend/CLAUDE.md",
            "wiki/GeneralContext/Prompts/29-outstanding-work.md",
            "wiki/GeneralContext/Prompts/_template.md",
            "wiki/GeneralContext/Timeline/2026-11.md",
            ".claude/skills/wiki-review/SKILL.md",
            ".agents/skills/wiki-review/SKILL.md",
            ".ai/skills/backend-testing/SKILL.md",
            ".ai/prompts/manager.md",
            ".ai/tasks/T-1/brief.md",
            ".ai/tests/fixtures/x/brief.md",
            ".ai/tests/fixtures/deep/er/notes.md",
        ],
    )
    def test_roots_are_never_orphans(self, repo, path):
        put(repo, path, "x\n")
        assert docgraph.debt(repo)["orphans"] == []

    @pytest.mark.parametrize(
        "path",
        [
            "wiki/GeneralContext/Prompts/sub/x.md",
            "wiki/GeneralContext/Timeline/old/x.md",
            ".claude/skills/ui-design/references/patterns.md",
            ".claude/skills/SKILL.md",
            ".ai/tasks/T-1/notes.md",
            "wiki/indexes.md",
            "wiki/README.md.md",
        ],
    )
    def test_near_misses_of_a_root_are_still_orphans(self, repo, path):
        put(repo, path, "x\n")
        assert docgraph.debt(repo)["orphans"] == [path]

    def test_the_graph_baseline_is_not_a_source(self, repo):
        """Its keys name every orphan: read as mentions, it would hide them all."""
        put(repo, "wiki/a.md", "x\n")
        put(repo, BASELINE, '["orphan:wiki/a.md"]\n')
        graph = docgraph.build(repo)
        assert edges(graph) == []
        assert docgraph.debt(repo)["orphans"] == ["wiki/a.md"]


class TestDangling:
    def test_an_edge_to_a_missing_file_is_dangling(self, repo):
        put(repo, "wiki/index.md", "[gone](gone.md)\n")
        put(repo, "wiki/b.md", "See wiki/gone.md:12 and wiki/gone.md:14.\n")
        put(repo, "wiki/c.md", "[b](b.md)\n")
        dangling = docgraph.debt(repo)["dangling"]
        assert dangling == [
            {"source": "wiki/b.md", "target": "wiki/gone.md", "kind": "cites-line", "cause": "missing"},
            {"source": "wiki/index.md", "target": "wiki/gone.md", "kind": "link", "cause": "missing"},
        ]

    def test_a_stale_literal_allowed_path_is_dangling(self, repo):
        spec(repo, "T-1", allowed_paths=["backend/app/gone.py", "backend/app/here.py"])
        put(repo, "backend/app/here.py", "x = 1\n")
        assert docgraph.debt(repo)["dangling"] == [
            {
                "source": ".ai/tasks/T-1/task.json",
                "target": "backend/app/gone.py",
                "kind": "allowed_paths",
                "cause": "missing",
            }
        ]

    def test_a_glob_that_matches_no_tracked_file_is_dangling(self, repo):
        spec(
            repo,
            "T-1",
            allowed_paths=["backend/app/posts/**", "backend/app/*.py", "frontend/src/gone/**"],
            required_context=["wiki/CodeContext/*.md"],
        )
        put(repo, "backend/app/posts/deep/x.py", "x = 1\n")
        put(repo, "backend/app/posts/y.py", "x = 1\n")
        put(repo, "wiki/CodeContext/a.md", "x\n")
        # `*` stops at `/`, as the guard matches: posts/y.py is not `backend/app/*.py`.
        assert docgraph.debt(repo)["dangling"] == [
            {
                "source": ".ai/tasks/T-1/task.json",
                "target": "backend/app/*.py",
                "kind": "allowed_paths",
                "cause": "pattern",
            },
            {
                "source": ".ai/tasks/T-1/task.json",
                "target": "frontend/src/gone/**",
                "kind": "allowed_paths",
                "cause": "pattern",
            },
        ]

    def test_an_untracked_file_does_not_satisfy_a_glob(self, repo):
        spec(repo, "T-1", allowed_paths=["backend/app/**"])
        (repo / "backend/app").mkdir(parents=True)
        (repo / "backend/app/x.py").write_text("x = 1\n", encoding="utf-8")
        assert [d["cause"] for d in docgraph.debt(repo)["dangling"]] == ["pattern"]

    def test_keys_are_stable_text(self, repo):
        put(repo, "wiki/a.md", "[gone](gone.md)\n")
        spec(repo, "T-1", allowed_paths=["frontend/src/gone/**"])
        assert debt_keys(repo) == [
            "dangling:.ai/tasks/T-1/task.json -> frontend/src/gone/** (allowed_paths)",
            "dangling:wiki/a.md -> wiki/gone.md (link)",
            "orphan:wiki/a.md",
        ]


def commit(repo, message="fixture"):
    git(repo, "add", "-A")
    git(
        repo,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        message,
    )
    return git(repo, "rev-parse", "HEAD")


def baseline(repo, keys):
    put(repo, BASELINE, json.dumps(sorted(keys)) + "\n")


def regen(repo):
    docgraph.write(repo)
    git(repo, "add", GRAPH)


@pytest.fixture
def checked(repo):
    """A base commit with the graph, its ratchet and one baselined orphan."""
    put(repo, ".ai/agentlib/docgraph.py", f'BASELINE = "{BASELINE}"\n')
    put(repo, "wiki/old.md", "x\n")
    baseline(repo, ["orphan:wiki/old.md"])
    regen(repo)
    return repo, commit(repo)


class TestCheck:
    def test_an_up_to_date_tree_passes(self, checked):
        repo, base = checked
        assert docgraph.check(repo, base=base) == {
            "stale": False,
            "errors": [],
            "debt": ["orphan:wiki/old.md"],
            "baseline_count": 1,
        }

    def test_a_stale_graph_file_fails(self, checked):
        repo, base = checked
        put(repo, "wiki/old.md", "[new](new.md)\n")
        put(repo, "wiki/new.md", "[old](old.md)\n")
        assert docgraph.check(repo, base=base)["stale"] is True
        regen(repo)
        assert docgraph.check(repo, base=base)["stale"] is False

    def test_a_missing_graph_file_is_stale(self, checked):
        repo, base = checked
        (repo / GRAPH).unlink()
        assert docgraph.check(repo, base=base)["stale"] is True

    def test_a_new_orphan_fails_the_ratchet(self, checked):
        repo, base = checked
        put(repo, "wiki/new.md", "x\n")
        regen(repo)
        assert docgraph.check(repo, base=base)["errors"] == ["new violation: orphan:wiki/new.md"]

    def test_a_new_dangling_edge_fails_the_ratchet(self, checked):
        repo, base = checked
        put(repo, "wiki/index.md", "[old](old.md) [gone](gone.md)\n")
        regen(repo)
        assert docgraph.check(repo, base=base)["errors"] == [
            "new violation: dangling:wiki/index.md -> wiki/gone.md (link)"
        ]

    def test_fixed_debt_may_leave_an_unused_entry(self, checked):
        repo, base = checked
        put(repo, "wiki/index.md", "[old](old.md)\n")
        regen(repo)
        result = docgraph.check(repo, base=base)
        assert result["errors"] == [] and result["debt"] == []

    def test_the_baseline_may_only_shrink_against_base(self, checked):
        repo, base = checked
        put(repo, "wiki/new.md", "x\n")
        baseline(repo, ["orphan:wiki/new.md", "orphan:wiki/old.md"])
        regen(repo)
        assert docgraph.check(repo, base=base)["errors"] == [
            "baseline may only shrink: orphan:wiki/new.md"
        ]

    def test_pruning_the_baseline_passes(self, checked):
        repo, base = checked
        put(repo, "wiki/index.md", "[old](old.md)\n")
        baseline(repo, [])
        regen(repo)
        assert docgraph.check(repo, base=base)["errors"] == []

    def test_first_introduction_against_a_base_without_the_ratchet(self, repo):
        put(repo, ".ai/agentlib/docgraph.py", "# a graph builder, no orphan ratchet yet\n")
        base = commit(repo)
        put(repo, "wiki/old.md", "x\n")
        baseline(repo, ["orphan:wiki/old.md"])
        regen(repo)
        assert docgraph.check(repo, base=base)["errors"] == []

    def test_a_base_with_the_ratchet_but_no_baseline_fails_closed(self, checked):
        repo, _ = checked
        git(repo, "rm", "-q", BASELINE)
        base = commit(repo, "drop the baseline")
        baseline(repo, ["orphan:wiki/old.md"])
        with pytest.raises(ValueError, match="no graph baseline"):
            docgraph.check(repo, base=base)

    def test_a_malformed_baseline_is_unusable(self, checked):
        repo, base = checked
        put(repo, BASELINE, '["b", "a"]\n')
        with pytest.raises(ValueError):
            docgraph.check(repo, base=base)

    def test_a_missing_baseline_is_unusable(self, checked):
        repo, base = checked
        (repo / BASELINE).unlink()
        with pytest.raises((OSError, ValueError)):
            docgraph.check(repo, base=base)

    def test_an_unknown_base_is_unusable(self, checked):
        repo, _ = checked
        with pytest.raises(ValueError):
            docgraph.check(repo, base="no-such-ref")


class TestDebtCli:
    def test_orphans_text(self, repo):
        put(repo, "wiki/a.md", "[gone](gone.md)\n")
        spec(repo, "T-1", allowed_paths=["frontend/src/gone/**"])
        result = run("graph", "--root", str(repo), "--orphans")
        assert result.returncode == 0, result.stderr
        lines = result.stdout.splitlines()
        assert ["orphan", "wiki/a.md"] in [line.split() for line in lines]
        assert ["dangling", "wiki/a.md", "->", "wiki/gone.md", "(link,", "missing)"] in [
            line.split() for line in lines
        ]
        assert any("frontend/src/gone/**" in line and "pattern)" in line for line in lines)
        assert lines[-1] == "docs graph: 1 orphans, 2 dangling, 0 frozen"
        assert not (repo / GRAPH).exists()

    def test_orphans_json(self, repo):
        put(repo, "wiki/a.md", "x\n")
        result = run("graph", "--root", str(repo), "--orphans", "--json")
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout) == {"orphans": ["wiki/a.md"], "dangling": [], "frozen": []}

    def test_check_passes_with_a_one_line_summary(self, checked):
        repo, base = checked
        result = run("graph", "--root", str(repo), "--check", "--base", base)
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == [
            "docs graph: up to date, 1 baselined orphans/dangling, 0 errors"
        ]

    def test_check_fails_on_a_stale_graph_with_the_remedy(self, checked):
        repo, base = checked
        put(repo, "wiki/index.md", "[old](old.md)\n")
        result = run("graph", "--root", str(repo), "--check", "--base", base)
        assert result.returncode == 1
        assert "python .ai/bin/agentctl.py docs graph" in result.stdout
        assert result.stdout.splitlines()[-1].startswith("docs graph: stale,")

    def test_check_fails_on_a_new_orphan_naming_it(self, checked):
        repo, base = checked
        put(repo, "wiki/new.md", "x\n")
        regen(repo)
        result = run("graph", "--root", str(repo), "--check", "--base", base)
        assert result.returncode == 1
        assert "new violation: orphan:wiki/new.md" in result.stdout
        assert result.stdout.splitlines()[-1] == (
            "docs graph: up to date, 2 baselined orphans/dangling, 1 errors"
        )

    def test_check_with_unusable_input_is_a_usage_error(self, checked):
        repo, _ = checked
        result = run("graph", "--root", str(repo), "--check", "--base", "no-such-ref")
        assert result.returncode == 2
        assert "docs graph:" in result.stderr

    def test_check_does_not_write_the_graph(self, checked):
        repo, base = checked
        put(repo, "wiki/index.md", "[old](old.md)\n")
        before = (repo / GRAPH).read_bytes()
        run("graph", "--root", str(repo), "--check", "--base", base)
        assert (repo / GRAPH).read_bytes() == before

    @pytest.mark.parametrize(
        "args",
        [
            ("--orphans", "--check"),
            ("--orphans", "--of", "wiki/old.md"),
            ("--check", "--task", "T-1"),
            ("--base", "HEAD"),
            ("--orphans", "--base", "HEAD"),
            ("--orphans", "--limit", "3"),
            ("--check", "--json"),
        ],
    )
    def test_bad_combinations_are_usage_errors(self, checked, args):
        repo, _ = checked
        before = (repo / GRAPH).read_bytes()
        assert run("graph", "--root", str(repo), *args).returncode == 2
        assert (repo / GRAPH).read_bytes() == before


DECISION = "---\ntype: decision\nstatus: accepted\n---\n# 0001\n\n"


class TestFrozenDecisions:
    """A decision is immutable once merged (doclint freezes its links), so a
    dangling edge from one is history, not debt: deleting a finished prompt
    an ADR links to must not grow the ratchet. `--orphans` still lists it."""

    def test_a_decisions_dangling_edge_is_frozen_not_dangling(self, repo):
        put(repo, "wiki/index.md", "[d](Decisions/0001-x.md)\n")
        put(repo, "wiki/Decisions/0001-x.md", DECISION + "[gone](../gone.md), wiki/gone.md:3\n")
        found = docgraph.debt(repo)
        assert found["dangling"] == []
        assert found["frozen"] == [
            {
                "source": "wiki/Decisions/0001-x.md",
                "target": "wiki/gone.md",
                "kind": "cites-line",
                "cause": "missing",
            },
            {
                "source": "wiki/Decisions/0001-x.md",
                "target": "wiki/gone.md",
                "kind": "link",
                "cause": "missing",
            },
        ]
        assert debt_keys(repo) == []

    def test_other_types_and_no_frontmatter_stay_dangling(self, repo):
        put(repo, "wiki/index.md", "[a](a.md) [b](b.md)\n")
        put(repo, "wiki/a.md", "---\ntype: reference\n---\n[gone](gone.md)\n")
        put(repo, "wiki/b.md", "type: decision\n\n[gone](gone.md)\n")
        found = docgraph.debt(repo)
        assert [d["source"] for d in found["dangling"]] == ["wiki/a.md", "wiki/b.md"]
        assert found["frozen"] == []

    def test_a_decision_nothing_links_to_is_still_an_orphan(self, repo):
        put(repo, "wiki/Decisions/0001-x.md", DECISION)
        assert docgraph.debt(repo)["orphans"] == ["wiki/Decisions/0001-x.md"]

    def test_deleting_a_doc_a_decision_links_to_passes_the_ratchet(self, checked):
        repo, _ = checked
        put(repo, "wiki/index.md", "[old](old.md) [d](Decisions/0001-x.md) [p](p.md)\n")
        put(repo, "wiki/Decisions/0001-x.md", DECISION + "[p](../p.md)\n")
        put(repo, "wiki/p.md", "x\n")
        regen(repo)
        base = commit(repo, "a decision links a prompt")
        git(repo, "rm", "-q", "wiki/p.md")
        put(repo, "wiki/index.md", "[old](old.md) [d](Decisions/0001-x.md)\n")
        regen(repo)
        result = docgraph.check(repo, base=base)
        assert result["errors"] == [] and result["stale"] is False

    def test_orphans_cli_lists_frozen_edges_apart(self, repo):
        put(repo, "wiki/index.md", "[d](Decisions/0001-x.md)\n")
        put(repo, "wiki/Decisions/0001-x.md", DECISION + "[gone](../gone.md)\n")
        result = run("graph", "--root", str(repo), "--orphans")
        assert result.returncode == 0, result.stderr
        lines = result.stdout.splitlines()
        row = ["frozen", "wiki/Decisions/0001-x.md", "->", "wiki/gone.md", "(link,", "missing)"]
        assert row in [line.split() for line in lines]
        assert not any(line.split()[:1] == ["dangling"] for line in lines)
        assert lines[-1] == "docs graph: 0 orphans, 0 dangling, 1 frozen"
        data = json.loads(run("graph", "--root", str(repo), "--orphans", "--json").stdout)
        assert data["dangling"] == []
        assert [d["target"] for d in data["frozen"]] == ["wiki/gone.md"]


def test_this_module_names_its_baseline_so_a_base_can_be_told_apart():
    """`check` fails closed when the base's docgraph.py names the baseline file
    but the base has none; a base whose builder predates the ratchet does not."""
    source = Path(docgraph.__file__).read_text(encoding="utf-8")
    assert docgraph.BASELINE == BASELINE
    assert BASELINE in source
