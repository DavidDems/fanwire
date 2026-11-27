"""The docs graph (Prompts/49): how docs, task specs and named code link.

`build(root)` reads tracked files only and returns `{"version", "nodes",
"edges"}`; `dumps(graph)` is the exact text of `.ai/graph.json`. Both are
pure and deterministic: sorted, deduplicated, no line numbers of the source,
no git history, mtimes or OS path separators, and the same whatever line
endings the sources have. The queries (`load`, then `of`, `within` and
`task_view`, pure functions over the loaded dict) read the committed file
rather than build: a query answers from what was checked in.

Nothing here parses Markdown or citations itself. Links, wikilinks, fenced
code, citation patterns and path resolution are `doclint`'s; path tokens and
tracked-file reading are `doccorpus`'s, so lint, inventory and the graph
never disagree.

Nodes: `doc` (tracked `*.md`), `spec` (`.ai/tasks/<ID>/task.json`), `code`
(any other tracked file at an edge end), `missing` (a target that is not a
tracked file) and `pattern` (an allowed_paths or required_context glob).
Edges: `link`, `wikilink`, `mention`, `cites-line`, `cites-section`,
`required_context` and `allowed_paths`.
"""

from __future__ import annotations

import difflib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from agentlib import doccorpus, doclint

GRAPH = doclint.GRAPH
VERSION = 1
FIXTURES = ".ai/tests/fixtures/"
SPEC_KEYS = ("required_context", "allowed_paths")
_SPEC = re.compile(r"\.ai/tasks/[^/]+/task\.json")
_GLOB = re.compile(r"[*?[]")


def _kind(path: str) -> str:
    if path.endswith(".md"):
        return "doc"
    return "spec" if _SPEC.fullmatch(path) else "code"


def _cited(source: str, target: str, tracked: set[str], names: list[str]) -> str | None:
    """doclint's citation resolution, against tracked names instead of the disk."""
    dest = doclint.repo_name(source, target)
    if dest in tracked:
        return dest
    choices = doclint.basename_matches(names, target)
    return choices[0] if len(choices) == 1 else dest


def _source_edges(name, raw, tracked, names, patterns):
    """(target, kind, detail) for every reference `name` makes."""
    markdown = name.endswith(".md")
    text = doclint.citation_text(name, raw)  # prose for Markdown, fences blanked
    out = []
    if markdown:
        for kind, target in doclint.classified_links(text):
            url = urlsplit(target)
            if url.scheme or url.netloc or not url.path:
                continue
            dest = doclint.repo_name(name, url.path)
            if dest is not None:
                out.append((dest, kind, ""))
    # Markdown mentions any tracked path; other text files, Markdown only
    # (as inventory counts), read whole: a Python constant naming a doc is a use.
    for token in doccorpus.named_paths(text if markdown else raw, doccorpus._NAMED_PATH):
        if token in tracked and (markdown or token.endswith(".md")):
            out.append((token, "mention", ""))
    covered = []
    for match in doclint.CITATION.finditer(text):
        covered.append(match.span())
        target, line, section = match.groups()
        dest = _cited(name, target, tracked, names)
        if dest is not None:
            detail = line or "§" + section
            out.append((dest, "cites-line" if line else "cites-section", detail))
    for match in doclint.BARE_SECTION.finditer(text):
        if any(start <= match.start() < end for start, end in covered):
            continue
        label = doclint.section_label(text, match.start())
        choices = doclint.stem_matches(names, label) if label else []
        if len(choices) == 1:  # otherwise local (not an edge) or ambiguous
            out.append((choices[0], "cites-section", "§" + match[1]))
    if _SPEC.fullmatch(name):
        try:
            spec = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{name}: not valid JSON ({exc})") from None
        for key in SPEC_KEYS:
            entries = spec.get(key) if isinstance(spec, dict) else None
            for entry in entries if isinstance(entries, list) else []:
                if not isinstance(entry, str) or not entry.strip():
                    continue
                if _GLOB.search(entry):
                    patterns.add(entry)
                    out.append((entry, key, ""))
                else:
                    out.append((entry.removeprefix("./"), key, ""))
    return out


def build(root: Path) -> dict:
    """The graph of the tracked tree at `root`."""
    root = Path(root).resolve()
    tracked = set(doccorpus._tracked(root)) - {GRAPH}
    dirs = {p.rsplit("/", i)[0] for p in tracked for i in range(1, p.count("/") + 1)} | {"."}
    texts = {}
    for name in sorted(tracked):
        if name.endswith(doccorpus._TEXT) and (text := doccorpus._read(root, name)) is not None:
            texts[name] = text
    names = sorted(texts)
    patterns: set[str] = set()
    found: set[tuple[str, str, str, str]] = set()
    for name, raw in texts.items():
        if name.startswith(FIXTURES) or name == doclint.BASELINE:
            continue  # frozen data and a list of violation keys, as doclint skips them
        for target, kind, detail in _source_edges(name, raw, tracked, names, patterns):
            if target == name or target == GRAPH:
                continue
            if target in dirs and target not in tracked and target not in patterns:
                continue  # a link to a directory names no file
            found.add((name, target, kind, detail))
    # A pair already joined by a link, citation or spec field is not also a mention.
    strong = {(s, t) for s, t, k, _ in found if k != "mention"}
    kept = sorted(e for e in found if e[2] != "mention" or e[:2] not in strong)

    kinds = {p: _kind(p) for p in tracked if p.endswith(".md") or _SPEC.fullmatch(p)}
    for source, target, _, _ in kept:
        kinds.setdefault(source, _kind(source))
        if target in tracked:
            kinds.setdefault(target, _kind(target))
        else:
            kinds.setdefault(target, "pattern" if target in patterns else "missing")
    edges = []
    for source, target, kind, detail in kept:
        edge = {"source": source, "target": target, "kind": kind}
        if detail:
            edge["detail"] = detail
        edges.append(edge)
    return {
        "version": VERSION,
        "nodes": [{"path": p, "kind": kinds[p]} for p in sorted(kinds)],
        "edges": edges,
    }


def dumps(graph: dict) -> str:
    """`.ai/graph.json`'s text: one record per line, ASCII, `\\n`, trailing newline."""

    def block(key: str) -> str:
        rows = [json.dumps(item, ensure_ascii=True) for item in graph[key]]
        if not rows:
            return f'  "{key}": []'
        return f'  "{key}": [\n' + ",\n".join("    " + r for r in rows) + "\n  ]"

    return (
        "{\n"
        f'  "version": {json.dumps(graph["version"])},\n'
        f"{block('nodes')},\n"
        f"{block('edges')}\n"
        "}\n"
    )


def write(root: Path) -> dict:
    """Build the graph at `root` and write it to `.ai/graph.json` there."""
    root = Path(root).resolve()
    graph = build(root)
    path = root / GRAPH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(dumps(graph).encode("ascii"))  # bytes: no newline translation
    return graph


# --- Queries (step 2): pure functions over a loaded graph dict. ---------------
#
# `agentctl docs graph --of/--within/--task` call these on the committed file
# (`load`), never on a fresh build: a query is fast and answers from what CI
# checked in. Formatting is agentctl's.

FOLLOW = ("link", "wikilink")  # the doc->doc edges a task's context closure follows


class GraphError(ValueError):
    """The committed graph cannot be read or answered from."""


class UnknownNode(GraphError):
    """A path or task id that is not in the graph; `hints` are close matches."""

    def __init__(self, message: str, hints: list[str] | None = None):
        self.hints = hints or []
        if self.hints:
            message += "; did you mean: " + ", ".join(self.hints)
        super().__init__(message)


def load(root: Path) -> dict:
    """The committed `.ai/graph.json` at `root`, checked for a known version."""
    path = Path(root) / GRAPH
    try:
        graph = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise GraphError(f"{GRAPH} not found; run `agentctl docs graph` to build it") from None
    except (OSError, ValueError) as exc:
        raise GraphError(f"{GRAPH} is not readable JSON ({exc}); rebuild it") from None
    if not isinstance(graph, dict) or graph.get("version") != VERSION:
        found = graph.get("version") if isinstance(graph, dict) else None
        raise GraphError(
            f"{GRAPH} version {found!r} is not understood (expected {VERSION}); "
            "rebuild it with `agentctl docs graph`"
        )
    return graph


def normalise(path: str) -> str:
    """A repo-relative POSIX path: backslashes turned, leading `./` dropped."""
    path = path.strip().replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    return path


def _kinds(graph: dict) -> dict[str, str]:
    return {n["path"]: n["kind"] for n in graph["nodes"]}


def _hints(kinds: dict[str, str], path: str, limit: int = 5) -> list[str]:
    base = path.rsplit("/", 1)[-1].lower()
    same = [p for p in kinds if p.rsplit("/", 1)[-1].lower() == base]
    if same:
        return sorted(same)[:limit]
    return difflib.get_close_matches(path, sorted(kinds), n=limit, cutoff=0.75)


def _node(graph: dict, path: str) -> tuple[str, str]:
    kinds = _kinds(graph)
    name = normalise(path)
    if name not in kinds:
        raise UnknownNode(f"{name!r} is not in {GRAPH}", _hints(kinds, name))
    return name, kinds[name]


def _detail(edge: dict) -> dict:
    return {"detail": edge["detail"]} if edge.get("detail") else {}


def of(graph: dict, path: str) -> dict:
    """The node at `path` with its outbound and inbound edges, in graph order."""
    name, kind = _node(graph, path)
    out = [
        {"target": e["target"], "kind": e["kind"], **_detail(e)}
        for e in graph["edges"]
        if e["source"] == name
    ]
    into = [
        {"source": e["source"], "kind": e["kind"], **_detail(e)}
        for e in graph["edges"]
        if e["target"] == name
    ]
    return {"path": name, "kind": kind, "out": out, "in": into}


def within(graph: dict, path: str, depth: int) -> dict:
    """Every node within `depth` edges of `path`, either direction, nearest first.

    Each reached node carries `distance` and `via` (the node it was first
    reached from, the edge's direction from there, and its kind). Breadth
    first, each level sorted by path, so the answer is deterministic.
    """
    if depth < 0:
        raise ValueError("depth must be 0 or more")
    name, kind = _node(graph, path)
    kinds = _kinds(graph)
    steps: dict[str, list[tuple[str, str, str]]] = {}
    for e in graph["edges"]:
        steps.setdefault(e["source"], []).append((e["target"], "out", e["kind"]))
        steps.setdefault(e["target"], []).append((e["source"], "in", e["kind"]))
    seen = {name: {"path": name, "kind": kind, "distance": 0}}
    frontier = [name]
    for distance in range(1, depth + 1):
        found: dict[str, dict] = {}
        for here in frontier:
            for there, direction, edge_kind in steps.get(here, []):
                if there not in seen and there not in found:
                    found[there] = {
                        "path": there,
                        "kind": kinds.get(there, "missing"),
                        "distance": distance,
                        "via": {"from": here, "direction": direction, "kind": edge_kind},
                    }
        frontier = sorted(found)
        seen.update((p, found[p]) for p in frontier)
        if not frontier:
            break
    return {"path": name, "depth": depth, "nodes": list(seen.values())}


def task_view(graph: dict, task_id: str, depth: int = 1) -> dict:
    """What a worker on `task_id` needs: its context, the docs it links, its paths.

    `required_context` entries as the spec lists them; `linked`, the docs
    reached from them by outbound `link`/`wikilink` edges to `depth`, each
    with its distance and the doc it was first reached from (missing targets
    and mentions are not followed); `allowed_paths` as listed.
    """
    if depth < 0:
        raise ValueError("depth must be 0 or more")
    spec = f".ai/tasks/{task_id}/task.json"
    kinds = _kinds(graph)
    if kinds.get(spec) != "spec":
        raise UnknownNode(f"no task {task_id!r} ({spec} is not in {GRAPH})")
    fields: dict[str, list[str]] = {"required_context": [], "allowed_paths": []}
    links: dict[str, list[str]] = {}
    for e in graph["edges"]:
        if e["source"] == spec and e["kind"] in fields:
            fields[e["kind"]].append(e["target"])
        elif e["kind"] in FOLLOW and kinds.get(e["target"]) == "doc":
            links.setdefault(e["source"], []).append(e["target"])
    context = sorted(fields["required_context"])
    seen = set(context)
    linked = []
    frontier = sorted(context)
    for distance in range(1, depth + 1):
        found: dict[str, str] = {}
        for here in frontier:
            for there in links.get(here, []):
                if there not in seen and there not in found:
                    found[there] = here
        frontier = sorted(found)
        seen.update(frontier)
        linked += [
            {"path": p, "kind": kinds[p], "distance": distance, "via": found[p]} for p in frontier
        ]
        if not frontier:
            break
    return {
        "task": task_id,
        "spec": spec,
        "depth": depth,
        "required_context": [{"path": p, "kind": kinds.get(p, "missing")} for p in context],
        "linked": linked,
        "allowed_paths": sorted(fields["allowed_paths"]),
    }


def compact_paths(paths: list[str]) -> list[str]:
    """Paths sharing a directory folded into one `dir/ {a, b}` row, sorted."""
    groups: dict[str, list[str]] = {}
    for path in paths:
        head, _, tail = path.rpartition("/")
        groups.setdefault(head, []).append(tail)
    rows = []
    for head, tails in groups.items():
        if len(tails) == 1:
            rows.append(f"{head}/{tails[0]}" if head else tails[0])
        else:
            rows.append(f"{head}/ {{{', '.join(sorted(tails))}}}")
    return sorted(rows)
