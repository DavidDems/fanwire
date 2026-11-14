"""Corpus measurement and the archive rewrite (CUT-01, Prompts/25).

Three read-mostly tools for compacting the Markdown corpus before it moves to
a fresh repository. `inventory` measures each tracked Markdown file against
its WikiUpdate budget and lists what points at it. `dupes` finds repeated
paragraphs, exactly by a normalised hash and nearly by word shingles.
`archive_refs` rewrites PR numbers and commit hashes into `fanwire-archive`
form; it reads and writes tracked Markdown only, and writes only on request.

No model decides anything here, and nothing is fetched. Document types,
budgets, body counting and link syntax are `doclint`'s, so the two never
disagree. Behaviour is documented in docs/doclint.md.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from agentlib import doclint

ARCHIVE = "fanwire-archive"

# Files whose text can name a repository path (a spec's required_context, a
# code comment, a workflow); the same set doclint reads for citations.
_TEXT = (".md", ".py", ".yml", ".yaml", ".json", ".ts", ".tsx", ".txt", ".ps1", ".sh", ".toml")
_PATH_TOKEN = re.compile(r"[\w./-]+\.md\b")


def _tracked(root: Path) -> list[str]:
    return sorted(p for p in doclint.git(root, "ls-files", "-z").split("\0") if p)


def _in_scope(path: str, paths: list[str] | None) -> bool:
    return not paths or any(path.startswith(p) for p in paths)


def _read(root: Path, name: str) -> str | None:
    path = root / name
    if path.is_symlink() or not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None


def _last_commits(root: Path) -> dict[str, dict[str, str]]:
    """Newest commit per path, from one walk of history (none in a fresh repo)."""
    try:
        log = doclint.git(root, "log", "--format=\x01%h %cs", "--name-only", "-z", "--", "*.md")
    except ValueError:
        return {}
    newest: dict[str, dict[str, str]] = {}
    sha = date = ""
    for token in log.replace("\n", "\0").split("\0"):
        if token.startswith("\x01"):
            sha, date = token[1:].split(" ", 1)
        elif token and token not in newest:
            newest[token] = {"sha": sha, "date": date}
    return newest


def _resolve(root: Path, source: str, target: str) -> str | None:
    url = urlsplit(target)
    if url.scheme or url.netloc or not url.path:
        return None
    dest = doclint.resolve(root, source, url.path)
    if dest is None:
        return None
    return dest.relative_to(root.resolve()).as_posix()


def inventory(root: Path, paths: list[str] | None = None) -> list[dict]:
    """One row per tracked Markdown file in scope, sorted by path."""
    root = Path(root).resolve()
    budgets = doclint.load_budgets(root)
    tracked = _tracked(root)
    markdown = {p for p in tracked if p.endswith(".md")}
    inbound: dict[str, dict[str, str]] = defaultdict(dict)
    texts = {}
    for name in tracked:
        if name.endswith(_TEXT) and (text := _read(root, name)) is not None:
            texts[name] = text
    for name, text in texts.items():
        for token in _PATH_TOKEN.findall(text):
            token = token.removeprefix("./").lstrip("/")
            if token in markdown and token != name:
                inbound[token].setdefault(name, "mention")
        if name.endswith(".md"):
            for target in doclint.link_targets(doclint.prose(text)):
                dest = _resolve(root, name, target)
                if dest in markdown and dest != name:
                    inbound[dest][name] = "link"
    commits = _last_commits(root)
    rows = []
    for name in sorted(markdown):
        if not _in_scope(name, paths) or name not in texts:
            continue
        fields, body, valid = doclint.frontmatter(texts[name])
        kind = fields.get("type") if valid and fields.get("type") in budgets else None
        words = len(body.split())
        budget = budgets.get(kind) if kind else None
        rows.append(
            {
                "path": name,
                "type": kind,
                "words": words,
                "budget": budget,
                "over": bool(budget and words > budget),
                "inbound": [
                    {"source": s, "kind": k} for s, k in sorted(inbound.get(name, {}).items())
                ],
                "last_commit": commits.get(name),
            }
        )
    return rows


def _normalise(paragraph: str) -> list[str]:
    text = re.sub(r"\[([^]]*)\]\([^)]*\)", r"\1", paragraph)  # keep link text only
    text = re.sub(r"[*_`>#|]+", " ", text)
    text = re.sub(r"^\s*(?:[-+]|\d+[.)])\s+", " ", text, flags=re.MULTILINE)
    return text.casefold().split()


def _paragraphs(text: str):
    """(first line, words) per blank-line paragraph of the body, code removed."""
    fields, body, valid = doclint.frontmatter(text)
    offset = len(text.splitlines()) - len(body.splitlines()) if valid else 0
    start, lines = 0, []
    for number, line in enumerate(doclint.prose(body).splitlines() + [""], start=1):
        if line.strip():
            if not lines:
                start = number + offset
            lines.append(line)
        elif lines:
            yield start, _normalise("\n".join(lines))
            lines = []


def dupes(
    root: Path,
    paths: list[str] | None = None,
    *,
    min_words: int = 12,
    threshold: float = 0.8,
    shingle: int = 3,
) -> dict:
    """Exact repeats grouped by hash; near pairs above `threshold` Jaccard."""
    root = Path(root).resolve()
    paras = []  # (location, words)
    for name in _tracked(root):
        if name.endswith(".md") and _in_scope(name, paths) and (text := _read(root, name)):
            for line, words in _paragraphs(text):
                if len(words) >= min_words:
                    paras.append((f"{name}:{line}", words))

    groups: dict[str, list[int]] = defaultdict(list)
    for i, (_, words) in enumerate(paras):
        groups[hashlib.sha256(" ".join(words).encode()).hexdigest()[:16]].append(i)
    exact = [
        {
            "hash": digest,
            "words": len(paras[ids[0]][1]),
            "preview": " ".join(paras[ids[0]][1][:12]),
            "locations": [paras[i][0] for i in ids],
        }
        for digest, ids in sorted(groups.items(), key=lambda g: paras[g[1][0]][0])
        if len(ids) > 1
    ]

    # Near repeats compare one representative per distinct paragraph.
    reps = [ids[0] for ids in groups.values()]
    sets = {
        i: {tuple(paras[i][1][k : k + shingle]) for k in range(len(paras[i][1]) - shingle + 1)}
        for i in reps
    }
    index: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for i, grams in sets.items():
        for gram in grams:
            index[gram].append(i)
    shared: dict[tuple[int, int], int] = defaultdict(int)
    for owners in index.values():
        if len(owners) > 50:
            continue  # boilerplate phrases pair everything with everything
        for x, a in enumerate(owners):
            for b in owners[x + 1 :]:
                shared[(min(a, b), max(a, b))] += 1
    near = []
    for (a, b), common in shared.items():
        similarity = common / (len(sets[a]) + len(sets[b]) - common)
        if threshold <= similarity < 1.0:
            first, second = sorted((paras[a][0], paras[b][0]))
            near.append({"similarity": round(similarity, 3), "a": first, "b": second})
    near.sort(key=lambda p: (-p["similarity"], p["a"], p["b"]))
    return {"exact": exact, "near": near}


@dataclass(frozen=True)
class Change:
    path: str
    line: int
    old: str
    new: str


# A PR or issue number: not part of a word, an entity, a path, a fragment or a
# colour, and no leading zero.
_PR = re.compile(r"(?<![\w&#/@-])#([1-9]\d{0,3})(?![\w-])")
# A hex word with a letter and a digit, 7 to 40 long, not inside a word,
# a UUID, a colour, a fingerprint or an existing archive reference.
_HEX = re.compile(r"(?<![\w#@:/-])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)([0-9a-f]{7,40})(?![\w-])")
_GITHUB = re.compile(r"(github\.com/[\w.-]+/)fanwire(/(?:pull|issues|commit|compare)/)")
# Link destinations and bare URLs are not prose; only `_GITHUB` edits them.
_PROTECTED = re.compile(r"\]\([^)\s]*\)|<?https?://[^\s)>]+>?")


def _commits(root: Path, words: set[str]) -> set[str]:
    """The hex words that name exactly one commit in `root`'s history."""
    if not words:
        return set()
    ordered = sorted(words)
    out = subprocess.run(
        ["git", "cat-file", "--batch-check"],
        cwd=root,
        input="".join(f"{w}^{{commit}}\n" for w in ordered),
        capture_output=True,
        text=True,
        check=True,
        env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
    ).stdout.splitlines()
    # Found: "<sha> commit <size>"; otherwise "<word> missing" or "ambiguous".
    return {w for w, line in zip(ordered, out, strict=True) if line.split()[1:2] == ["commit"]}


def _rewrite(line: str, commits: set[str]) -> str:
    out, pos = [], 0
    for m in _PROTECTED.finditer(line):
        out.append(_rewrite_prose(line[pos : m.start()], commits))
        out.append(_GITHUB.sub(rf"\1{ARCHIVE}\2", m[0]))
        pos = m.end()
    out.append(_rewrite_prose(line[pos:], commits))
    return "".join(out)


def _rewrite_prose(text: str, commits: set[str]) -> str:
    text = _PR.sub(rf"{ARCHIVE}#\1", text)
    return _HEX.sub(lambda m: f"{ARCHIVE}@{m[1]}" if m[1] in commits else m[1], text)


def _lines(text: str):
    """(number, line, in a fence) for each line, keeping its ending.

    Split on `\\n` only, so numbers match an editor's and a `\\r` stays put.
    """
    fence = None
    for number, line in enumerate(re.findall(r"[^\n]*\n|[^\n]+$", text), start=1):
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
            yield number, line, True
        elif marker:
            fence = marker[1]
            yield number, line, True
        else:
            yield number, line, False


def archive_refs(
    root: Path, paths: list[str] | None = None, *, write: bool = False
) -> list[Change]:
    """Every Markdown line that would change; applied only when `write`."""
    root = Path(root).resolve()
    texts = {}
    for name in _tracked(root):
        path = root / name
        if name.endswith(".md") and _in_scope(name, paths):
            if path.is_file() and not path.is_symlink():
                # Bytes, not text mode: line endings are written back as found.
                texts[name] = path.read_bytes().decode("utf-8")
    words = set()
    for text in texts.values():
        for _, line, fenced in _lines(text):
            if not fenced:
                words.update(_HEX.findall(_PROTECTED.sub(" ", line)))
    commits = _commits(root, words)
    changes = []
    for name, text in texts.items():
        new_lines, changed = [], False
        for number, line, fenced in _lines(text):
            new = line if fenced else _rewrite(line, commits)
            if new != line:
                changes.append(Change(name, number, line, new))
                changed = True
            new_lines.append(new)
        if write and changed:
            (root / name).write_bytes("".join(new_lines).encode("utf-8"))
    return changes
