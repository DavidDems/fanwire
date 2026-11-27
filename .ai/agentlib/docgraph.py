"""The docs graph (Prompts/49): how docs, task specs and named code link.

`build(root)` reads tracked files only and returns `{"version", "nodes",
"edges"}`; `dumps(graph)` is the exact text of `.ai/graph.json`. Both are
pure and deterministic: sorted, deduplicated, no line numbers of the source,
no git history, mtimes or OS path separators, and the same whatever line
endings the sources have. The query, orphan and staleness commands read the
committed file and reuse these two functions.

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
