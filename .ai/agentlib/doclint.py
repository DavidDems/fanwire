"""Deterministic documentation checks and an exact, base-relative debt ratchet.

No network, Markdown/YAML dependencies or corpus rewrites. Supported Markdown
syntax and baseline maintenance are documented in docs/doclint.md.
"""

from __future__ import annotations

import ast
import hashlib
import io
import json
import os
import re
import subprocess
import tokenize
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

BASELINE = ".ai/docs-baseline.json"
SKILL = ".claude/skills/wiki-update/SKILL.md"
SECTION = r"\d+[a-z]?(?:\.\d+[a-z]?)*"


def has_section(content: str, section: str) -> bool:
    return bool(
        re.search(
            r"(?m)^#{1,6}\s+(?:§\s*)?" + re.escape(section) + r"(?:[.)](?!\d)|\s|$)",
            prose(content),
        )
    )


@dataclass(frozen=True, order=True)
class Violation:
    path: str
    rule: str
    detail: str

    @property
    def key(self) -> str:
        # Line numbers are deliberately absent: inserting a line cannot move debt.
        return json.dumps(
            [self.path, self.rule, self.detail], ensure_ascii=False, separators=(",", ":")
        )


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        capture_output=True,
        check=False,
        encoding="utf-8",
        env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
    )
    if result.returncode:
        raise ValueError(f"git {' '.join(args)}: {result.stderr.strip()}")
    return result.stdout


def load_budgets(root: Path) -> dict[str, int]:
    text = (root / SKILL).read_text(encoding="utf-8")
    rows = re.findall(r"^\| `([a-z]+)` \|[^\n]+\| ([\d,]+) \|$", text, re.MULTILINE)
    budgets = {name: int(n.replace(",", "")) for name, n in rows}
    if len(rows) != 5 or len(budgets) != 5:
        raise ValueError("WikiUpdate must declare five unique document types and budgets")
    return budgets


def frontmatter(text: str) -> tuple[dict[str, str], str, bool]:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}, text, False
    fields = {}
    for i, line in enumerate(lines[1:], 1):
        if line.strip() == "---":
            return fields, "".join(lines[i + 1 :]), True
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([a-z_]+):\s*(.*?)\s*\n?", line)
        if not match or match[1] in fields:
            return {}, text, False
        fields[match[1]] = match[2].strip("\"'")
    return {}, text, False


def prose(text: str) -> str:
    """Blank fenced blocks (including examples) without joining adjacent words."""
    output = []
    fence = None
    for line in text.splitlines():
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
            output.append("")
        elif marker:
            fence = marker[1]
            output.append("")
        else:
            output.append(line)
    return "\n".join(output)


def anchors(text: str) -> set[str]:
    found = set(re.findall(r"<\w+\s+[^>]*?(?:id|name)=[\"\']([^\"\']+)", text))
    counts: dict[str, int] = defaultdict(int)
    headings = []
    lines = prose(text).splitlines()
    for i, line in enumerate(lines):
        match = re.match(r"^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?$", line)
        if match:
            headings.append(match[1])
        elif i and re.fullmatch(r"\s{0,3}(?:=+|-+)\s*", line) and lines[i - 1].strip():
            headings.append(lines[i - 1].strip())
    for heading in headings:
        heading = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", heading)
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        n = counts[slug]
        counts[slug] += 1
        found.add(slug + (f"-{n}" if n else ""))
    return found


def resolve(root: Path, source: str, target: str) -> Path | None:
    """Repository-root paths are explicit; other paths are document-relative.

    A bare filename citation may use an unambiguous repository-wide basename,
    matching existing `handoff.md §10` code comments.
    """
    target = unquote(target)
    if "\\" in target:
        return None
    prefixes = (
        "wiki/",
        ".ai/",
        ".github/",
        ".claude/",
        ".agents/",
        "backend/",
        "frontend/",
        "infra/",
        "TODO/",
        "perf/",
        "brand/",
    )
    candidate = (
        root / target.lstrip("/")
        if target.startswith(prefixes) or target.startswith("/")
        else root / Path(source).parent / target
    )
    candidate = candidate.resolve()
    if not candidate.is_relative_to(root.resolve()):
        return None
    return candidate


def inline_links(text: str):
    """Read balanced inline destinations, including escaped parentheses."""
    for match in re.finditer(r"\]\(\s*", text):
        start = pos = match.end()
        angle = pos < len(text) and text[pos] == "<"
        if angle:
            end = text.find(">", pos + 1)
            if end >= 0:
                yield text[pos + 1 : end]
            continue
        depth = 0
        while pos < len(text):
            char = text[pos]
            if char == "\\":
                pos += 2
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                if not depth:
                    break
                depth -= 1
            elif char.isspace() and not depth:
                break
            pos += 1
        if pos > start:
            yield re.sub(r"\\([()])", r"\1", text[start:pos])


def citation_text(name: str, raw: str) -> str:
    """Python test strings are data; comments and actual docstrings are prose."""
    if name.endswith(".py"):
        try:
            tree = ast.parse(raw)
            docs = [
                ast.get_docstring(node, clean=False) or ""
                for node in ast.walk(tree)
                if isinstance(
                    node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
                )
            ]
            comments = [
                token.string
                for token in tokenize.generate_tokens(io.StringIO(raw).readline)
                if token.type == tokenize.COMMENT
            ]
            return "\n".join(docs + comments)
        except (SyntaxError, tokenize.TokenError):
            return raw
    return prose(raw) if name.endswith(".md") else raw


def scan(root: Path, *, base: str | None = None, rules_root: Path | None = None) -> list[Violation]:
    root = root.resolve()
    budgets = load_budgets(rules_root or root)
    tracked = git(root, "ls-files", "-z").split("\0")
    tracked_set = set(tracked) - {""}

    def available(path):
        if path is None or not path.is_relative_to(root):
            return False
        name = path.relative_to(root).as_posix()
        return (path.is_file() and name in tracked_set) or (
            path.is_dir()
            and (name == "." or any(p.startswith(name.rstrip("/") + "/") for p in tracked_set))
        )

    texts = {}
    for name in sorted(set(tracked) - {"", BASELINE}):
        path = root / name
        if (
            path.is_symlink()
            or not path.is_file()
            or path.suffix
            not in {
                ".md",
                ".py",
                ".yml",
                ".yaml",
                ".json",
                ".ts",
                ".tsx",
                ".txt",
                ".ps1",
                ".sh",
                ".toml",
            }
        ):
            continue
        try:
            texts[name] = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            if name.endswith(".md"):
                raise ValueError(f"{name}: Markdown must be UTF-8") from None
            continue
    violations: set[Violation] = set()

    def add(name, rule, detail):
        violations.add(Violation(name, rule, detail))

    shingles: dict[tuple[str, ...], set[str]] = defaultdict(set)
    docs = {p for p in texts if p.endswith(".md") and p.startswith(("wiki/", ".ai/docs/"))}
    for name in sorted(docs):
        fields, body, valid = frontmatter(texts[name])
        kind = fields.get("type")
        if not valid or kind not in budgets:
            add(name, "frontmatter", "expected one opening type from WikiUpdate")
        if kind in budgets and len(body.split()) > budgets[kind]:
            add(name, "budget", f"{len(body.split())} words exceeds {kind} budget {budgets[kind]}")
        if kind == "reference":
            for match in re.finditer(
                r"(?im)^.*(?:\b(?:status|update),?\s+\d{4}|\bas of\b|^\s*#{1,6}\s+(?:current\s+)?status\b|^\s*(?:>\s*)?(?:\*\*)?status\s*[:—–]).*$",
                prose(body),
            ):
                add(name, "reference-history", match[0].strip())
        if "superseded_by" in fields:
            target = fields["superseded_by"]
            dest = resolve(root, name, target)
            if (
                kind != "decision"
                or not dest
                or not available(dest)
                or not dest.is_file()
                or frontmatter(dest.read_text(encoding="utf-8"))[0].get("type") != "decision"
                or dest == root / name
            ):
                add(name, "link", f"invalid superseded_by: {target}")
        words = body.casefold().split()
        for i in range(len(words) - 39):
            shingles[tuple(words[i : i + 40])].add(name)

    for words, owners in shingles.items():
        if len(owners) > 1:
            digest = hashlib.sha256(" ".join(words).encode()).hexdigest()[:20]
            paths = sorted(owners)
            for i, left in enumerate(paths):
                for right in paths[i + 1 :]:
                    add(left, "duplicate", f"{right} 40-word sha256:{digest}")

    def check_link(name, target):
        url = urlsplit(target)
        if url.scheme or url.netloc:
            return
        dest = resolve(root, name, url.path) if url.path else root / name
        if not available(dest):
            add(name, "link", target)
        elif url.fragment:
            fragment = unquote(url.fragment)
            if re.fullmatch(r"L\d+(?:-L\d+)?", fragment):
                nums = [int(n) for n in re.findall(r"\d+", fragment)]
                good = (
                    dest.is_file()
                    and min(nums) > 0
                    and max(nums) <= len(dest.read_text(encoding="utf-8").splitlines())
                )
            else:
                good = dest.is_file() and fragment in anchors(dest.read_text(encoding="utf-8"))
            if not good:
                add(name, "link", target)

    for name, raw in texts.items():
        text = citation_text(name, raw)
        if name.endswith(".md"):
            markup = re.sub(r"(`+).*?\1", "", text, flags=re.DOTALL)
            # Inline links/images, full/collapsed references, reference definitions.
            definitions = {
                label.casefold(): dest
                for label, dest in re.findall(r"(?m)^\s{0,3}\[([^]]+)\]:\s*<?([^\s>]+)>?", markup)
            }
            for target in inline_links(markup):
                check_link(name, target)
            for target in definitions.values():
                check_link(name, target)
            for target in re.findall(r"\[\[([^]|]+)(?:\|[^]]*)?\]\]", markup):
                target = target.rstrip("\\")  # escaped table separator in a wikilink
                path, sep, anchor = target.partition("#")
                check_link(
                    name,
                    path + ("" if Path(path).suffix else ".md") + (sep + anchor if sep else ""),
                )
            for target in re.findall(r"<((?:\.{1,2}/)[^<>\s]+)>", markup):
                check_link(name, target)
        # Explicit file:line and file §n citations, also in code comments/docstrings.
        pattern = (
            r"(?<![\w/])([\w./-]+\.[a-zA-Z][\w]*)(?::(\d+(?:-\d+)?)|`?\s+§\s*("
            + SECTION
            + r")(?!\w|\.\d))"
        )
        covered = []
        for match in re.finditer(pattern, text):
            covered.append(match.span())
            target, line, section = match.groups()
            dest = resolve(root, name, target)
            if not dest or not dest.is_file():
                choices = [root / p for p in texts if p == target or p.endswith("/" + target)]
                dest = choices[0] if len(choices) == 1 else None
            good = bool(available(dest) and dest.is_file())
            if good:
                content = dest.read_text(encoding="utf-8")
                if line:
                    bounds = [int(n) for n in line.split("-")]
                    good = 0 < min(bounds) <= max(bounds) <= len(
                        content.splitlines()
                    ) and bounds == sorted(bounds)
                else:
                    good = has_section(content, section)
            if not good:
                add(name, "citation", match[0].replace("`", ""))

        for match in re.finditer(r"§\s*(" + SECTION + r")(?!\w|\.\d)", text):
            if any(start <= match.start() < end for start, end in covered):
                continue
            prefix = re.search(r"([\w./-]+)`?\s*$", text[: match.start()])
            choices = []
            if prefix:
                label = prefix[1]
                choices = [
                    p
                    for p in texts
                    if p.endswith(".md") and (p[:-3] == label or p[:-3].endswith("/" + label))
                ]
            # A bare section is local; an unambiguous Markdown stem names
            # another document, matching legacy `handoff §10` citations.
            target = choices[0] if len(choices) == 1 else name
            if len(choices) > 1 or not has_section(texts[target], match[1]):
                add(name, "citation", f"{target} §{match[1]}")

    if base:
        # Validate the ref even when no decisions exist. Missing history fails closed.
        git(root, "rev-parse", "--verify", base + "^{commit}")
        for name in git(
            root, "ls-tree", "-r", "--name-only", "-z", base, "--", "wiki", ".ai/docs"
        ).split("\0"):
            if not name.endswith(".md"):
                continue
            old = git(root, "show", f"{base}:{name}")
            if frontmatter(old)[0].get("type") == "decision":

                def immutable(text):
                    lines = text.splitlines(keepends=True)
                    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), 0)
                    return "".join(
                        line
                        for i, line in enumerate(lines)
                        if not (0 < i < end and line.startswith("superseded_by:"))
                    )

                if name not in texts or immutable(old) != immutable(texts[name]):
                    add(name, "decision-changed", "merged decision differs from base")
    return sorted(violations)


def read_baseline(text: str) -> set[str]:
    data = json.loads(text)
    if (
        not isinstance(data, list)
        or any(not isinstance(x, str) for x in data)
        or data != sorted(set(data))
    ):
        raise ValueError("docs baseline must be a sorted JSON array of unique violation keys")
    return set(data)


def ratchet(actual: set[str], baseline: set[str], previous: set[str]) -> list[str]:
    return (
        [f"new violation: {v}" for v in sorted(actual - baseline)]
        + [f"remove fixed baseline entry: {v}" for v in sorted(baseline - actual)]
        + [f"baseline may only shrink: {v}" for v in sorted(baseline - previous)]
    )


def lint(root: Path, *, base: str, rules_root: Path | None = None) -> dict:
    violations = scan(root, base=base, rules_root=rules_root)
    baseline = read_baseline((root / BASELINE).read_text(encoding="utf-8"))
    files = git(root, "ls-tree", "-r", "--name-only", "-z", base).split("\0")
    if BASELINE in files:
        previous = read_baseline(git(root, "show", f"{base}:{BASELINE}"))
    elif ".ai/agentlib/doclint.py" not in files:
        # One-time introduction before the linter exists on main. Once merged,
        # removing or recreating the baseline cannot reset this ratchet.
        previous = baseline
    else:
        raise ValueError("base has a linter but no documentation baseline")
    errors = ratchet({v.key for v in violations}, baseline, previous)
    return {
        "violations": [v.key for v in violations],
        "errors": errors,
        "baseline_count": len(baseline),
    }
