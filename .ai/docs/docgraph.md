---
type: reference
---

# Docs graph

`agentlib.docgraph` builds `.ai/graph.json`, a generated map of how tracked
docs, task specs and the code files they name link to each other
([ADR 0045](../../wiki/GeneralContext/Decisions/0045-final-track-answers.md)).
An agent asks it "what links to or from X" instead of grepping for a file
name, and CI uses it to find docs linked from nothing. It supplements the
wiki and its indexes; it does not replace them. It is stdlib-only, offline
and makes no API call.

It reads no Markdown or citation syntax of its own: links, wikilinks, fenced
code, citations and path resolution are [doclint](doclint.md)'s, and path
tokens and tracked-file reading are `agentlib.doccorpus`'s, so lint,
inventory and the graph agree on what a link is.

## Nodes and edges

| Node kind | What it is |
|---|---|
| `doc` | Every tracked `*.md` file |
| `spec` | Every tracked `.ai/tasks/<ID>/task.json` |
| `code` | Any other tracked file at either end of an edge |
| `missing` | An edge target that is not a tracked file |
| `pattern` | A glob in a spec's `allowed_paths` or `required_context` |

| Edge kind | Source and target |
|---|---|
| `link` | A Markdown inline or reference link to a repository path |
| `wikilink` | A `[[...]]` link |
| `mention` | A Markdown file naming any tracked path in prose, or another tracked text file naming a Markdown file |
| `cites-line` | A `path:12` or `path:12-20` citation; `detail` holds the line or range |
| `cites-section` | A `file §n` citation, or `word §n` where the word is the stem of exactly one Markdown file (`handoff §10`); `detail` holds `§n`. A bare local `§n` is not an edge |
| `required_context` | A spec to each entry |
| `allowed_paths` | A spec to each literal path, or to a `pattern` node for a glob |

Fenced code is not a source (in Python, citations are read from comments
and docstrings only, as doclint reads them), external URLs are ignored, `#fragment`s are
stripped, self-edges are dropped, and a link to a directory names no file.
Files under `.ai/tests/fixtures/` and the two baselines
(`.ai/docs-baseline.json`, `.ai/graph-baseline.json`) are never sources: one
is frozen data, the others are lists of debt keys. A pair already joined by
a link, citation or spec field is not also a `mention`.

## File format

```json
{
  "version": 1,
  "nodes": [
    {"path": "AGENTS.md", "kind": "doc"}
  ],
  "edges": [
    {"source": "AGENTS.md", "target": ".ai/README.md", "kind": "mention"}
  ]
}
```

Nodes are sorted by path; edges are deduplicated on
`(source, target, kind, detail)` and sorted. Each record is one line, ASCII
(`ensure_ascii`), with `\n` line endings and a trailing newline, so a diff
stays line-sized. No source line number is recorded, so editing a doc moves
no edge. The build depends on no git history, mtime, OS path separator or
dict order, and the source files' line endings do not matter: a re-run is
byte-identical on Windows and Linux. The graph file itself is not a node and
is not scanned. A reader that finds another `version` stops and asks for a
rebuild.

## Commands

From the repository root. Every form takes `--root <repo>` to read another
checkout. A query form exits 2 on an unknown path or task (with close-match
hints) or a missing or unreadable `.ai/graph.json`.

- `python .ai/bin/agentctl.py docs graph` builds the graph and writes
  `.ai/graph.json`, printing its node and edge counts.
- `docs graph --of <path>`: the node's outbound and inbound edges, each with
  its kind (and line or section for a citation), and a `N out, M in` line.
- `docs graph --of <path> --within <n>`: every node within `n` edges, in
  either direction, nearest first, each with the node and edge it was
  reached by.
- `docs graph --task <ID>`: what a worker on that task reads. Its
  `required_context` entries, the docs they reach by outbound `link` and
  `wikilink` edges to `--within` depth (default 1), and its `allowed_paths`,
  with paths in one directory folded into one row.
- `--limit <n>` caps the printed rows (default 50; a `... N more` line says
  what was cut), and `--json` prints the full answer as JSON instead.

Queries read the committed `.ai/graph.json` and never rebuild it, so they
are fast and answer from what CI checked in. `--orphans` and `--check` build
afresh and write nothing.

## Orphans, dangling edges and roots

`docs graph --orphans [--json]` lists:

- **orphans**: docs with no inbound edge from another node, excluding roots;
- **dangling** edges: an edge to a `missing` node, or to a `pattern` that
  matches no tracked file (`*` stops at `/`, as the guard matches);
- **frozen** edges: dangling edges whose source is a decision (frontmatter
  `type: decision`), listed apart.

Roots are docs read by name or by convention rather than found by a link:
any `index.md`, `README.md`, `AGENTS.md` or `CLAUDE.md`;
`wiki/GeneralContext/Prompts/*.md` and `wiki/GeneralContext/Timeline/*.md`;
`SKILL.md` files directly under `.claude/skills/<name>/`,
`.agents/skills/<name>/` and `.ai/skills/<name>/`; `.ai/prompts/*.md`;
`.ai/tasks/*/brief.md`; and everything under `.ai/tests/fixtures/`.

A merged decision is immutable, and doclint does not check its links, so a
decision's dangling edge is history rather than debt: deleting a finished
prompt that an ADR links to cannot be repaired in the ADR. Frozen edges are
never baseline keys. A new decision's dead links are doclint's to catch.

## The ratchet and CI

`.ai/graph-baseline.json` is a sorted, unique JSON array of debt keys,
`orphan:<path>` and `dangling:<source> -> <target> (<kind>)`. It follows
doclint's ratchet exactly (the `.ai/docs-baseline.json` rules in
[doclint](doclint.md)): current debt must be a subset of the baseline, the
baseline a subset of the base commit's, and a base whose builder already
names the baseline but has none fails closed.

`docs graph --check [--base REF]` (default `origin/main`) exits 1 when the
committed `.ai/graph.json` differs from a fresh build, or when the ratchet
fails, and 2 on unusable input (an unknown base, or a missing or malformed
baseline). It prints one summary line:
`docs graph: up to date, N baselined orphans/dangling, 0 errors`. CI runs it
as a step of the `docs-lint` job in `.github/workflows/test-agent.yml`,
required by `gate`, against the same base as the lint step, and even when
the lint step failed.

## Fixing a red check

- **Stale graph**: run `python .ai/bin/agentctl.py docs graph` and commit
  `.ai/graph.json`, as the last commit of the change.
- **New orphan**: link the doc from the file that owns its subject, or
  delete it and name where its fact went.
- **New dangling edge**: fix the link, citation or spec path, or remove it.
- Never add a baseline entry. A Director maintenance PR may delete entries
  whose debt is fixed.
