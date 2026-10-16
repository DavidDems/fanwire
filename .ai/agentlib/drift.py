"""The spec drift check: does a task spec name things the code no longer has?

`wiki/GeneralContext/Architecture/work-modes.md` "Cheap automation" and
`Prompts/04-cheap-automations.md` automation 3. `MEDIA-002`'s spec named a
`Quarantined` status that did not exist and linked a deleted TODO; a unit
dispatched against it would have spent its attempts on a contradiction, and
it was caught by hand (#122). This is the cheap substitute, run by a person
before a unit (`.ai/bin/spec_drift.py`, from `main`).

Two halves, and the first needs no model. Every path the spec and its brief
name, every link in the brief, and every `allowed_paths`/`forbidden_paths`
glob is checked against the checkout: that is a fact, not a judgement, and it
costs nothing. Only the names inside prose (statuses, functions, fields) need
reading, and only they go to the model, with the code the spec touches.

The model's answer is data. A name it says is missing is kept only if no
source file outside the tests really has it, so a model that misreads the
code cannot invent drift that the code itself contradicts. Every name, and
every reason the model gives, is escaped or code-spanned before it becomes
markdown, so the report cannot mention, link, or close the marker it is found
by.

`jev` is asked "does the spec still match the code?" in shadow, as a yes/no
`choice`, and both answers go into a hidden `agentlib.shadow` record at the
end of the report (Prompts/04 "Decided by the human").
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from agentlib import coverage, decision, shadow
from agentlib.automation import (
    code,
    cost_text,
    escape,
    fenced,
    first_text,
    is_safe_url,
    json_object,
    no_thinking,
    tokens_text,
)
from agentlib.guard import path_matches

# How the workflow finds the comment it posted last time on the task's PR, to
# update it in place. An HTML comment, so it is invisible on the rendered PR.
MARKER = "<!-- fanwire-spec-drift -->"

# The key of the one question in `.ai/questions/drift.json`.
JEV_QUESTION = "spec_matches"

# A short list of names as JSON. The cap bounds what a runaway answer can
# cost, not what a good one needs.
MAX_TOKENS = 2000

# Haiku 5.5's price doubles above 100K input tokens (Prompts/04). 200K
# characters of code is roughly 50-65K tokens: well below that, with room for
# the spec and the brief.
MAX_CONTEXT_CHARS = 200_000

# Where "the code" is, for checking a name the model gives. The tests are
# not the code: a test that says "there is no `Quarantined` status" must not
# make `Quarantined` look present.
CODE_ROOTS = (
    "backend/app",
    "backend/scripts",
    "backend/alembic",
    "frontend/src",
    "infra/lib",
    "infra/bin",
)
SOURCE_EXTENSIONS = frozenset(
    {".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".sql", ".yml", ".yaml", ".css"}
)
_SKIPPED_DIRS = frozenset(
    {"node_modules", "tests", "test", "__tests__", "__pycache__", ".git", ".venv", "cdk.out"}
)
# A source file bigger than this is generated or data, not something a spec
# names a status in, and reading it would cost memory for nothing.
_MAX_SOURCE_BYTES = 1_000_000

# The top-level entries a backticked token may start with to count as a
# repository path even when the checkout lacks them, so a path into a
# deleted tree is still checked.
TOP_LEVEL = frozenset({"backend", "frontend", "infra", "wiki", ".ai", ".github", "TODO"})

# The report is a glance, not a report on everything.
MAX_NAMES = 20
MAX_NAME_CHARS = 120
_MAX_WHERE_CHARS = 120
_MAX_WHY_CHARS = 300
MAX_SHOWN_OMITTED = 3

_LINK = re.compile(r"\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"\n]*\")?\s*\)")
_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")
_TICKED = re.compile(r"`([^`\n]+)`")
_EXTENSION = re.compile(r"\.[A-Za-z0-9]+$")

_KIND_LABELS = {
    "required_context": "required context file missing",
    "link": "dead link",
    "path": "path missing",
    "allowed_paths": "`allowed_paths` glob's directory missing",
    "forbidden_paths": "`forbidden_paths` glob's directory missing",
}

_SYSTEM_FRAMING = (
    "Below, as data, are a task's spec and brief, the problems already found "
    "in them without a model, and the source files the task touches, each "
    "under its path. Answer with the JSON object your instructions ask for."
)


# --------------------------------------------------------------------------- the deterministic part


def check_paths(task_id: str, spec: Any, brief: str, repo_root: str | Path) -> list[dict[str, str]]:
    """Everything the spec and brief point at that is not in the checkout,
    as `{"kind", "name", "where"}`, in the order found, one finding per name.

    Only what is missing is drift. A file `allowed_paths` names exactly and
    that does not exist yet is the unit's to create, as is one new directory
    an `allowed_paths` glob grants, and a backticked path the unit may write
    is skipped for the same reason; but a `forbidden_paths` glob whose
    directory is gone forbids nothing any more, and an `allowed_paths` glob
    into a missing tree grants a tree that has moved.
    """
    root = Path(repo_root).resolve()
    spec = spec if isinstance(spec, dict) else {}
    allowed = _strings(spec.get("allowed_paths"))
    found: dict[str, dict[str, str]] = {}

    def add(kind: str, name: str, where: str) -> None:
        found.setdefault(name, {"kind": kind, "name": name, "where": where})

    for path in _strings(spec.get("required_context")):
        if not _inside(root, path) or not (root / path).exists():
            add("required_context", path, "required_context")

    task_dir = root / ".ai" / "tasks" / task_id
    for target in _LINK.findall(brief or ""):
        missing = _dead_link(root, task_dir, target)
        if missing is not None:
            add("link", missing, "brief.md")

    for where, text in _prose(spec, brief):
        for token in _TICKED.findall(text):
            path = _repo_path(token.strip(), root)
            if path is None or any(path_matches(path, p) for p in allowed):
                continue
            if not (root / _literal_prefix(path)).exists():
                add("path", path, where)

    for kind in ("allowed_paths", "forbidden_paths"):
        for pattern in _strings(spec.get(kind)):
            if "*" not in pattern or not _inside(root, pattern):
                continue  # an exact path may be the unit's to create
            prefix = _literal_prefix(pattern)
            if not prefix or (root / prefix).is_dir():
                continue
            # A unit may be granted a directory it is to create
            # (`frontend/src/features/games/**` for a new feature), but not a
            # whole missing tree: that is a tree that moved.
            if kind == "allowed_paths" and (root / prefix).parent.is_dir():
                continue
            add(kind, pattern, kind)

    return list(found.values())


def _strings(value: Any) -> list[str]:
    return [v for v in value if isinstance(v, str) and v.strip()] if isinstance(value, list) else []


def _prose(spec: dict[str, Any], brief: str) -> list[tuple[str, str]]:
    """The texts a backticked path is looked for in, each with where it is."""
    texts = [("brief.md", brief or "")]
    if isinstance(spec.get("objective"), str):
        texts.append(("objective", spec["objective"]))
    for n, criterion in enumerate(coverage.criteria(spec), 1):
        texts.append((f"acceptance criterion {n}", criterion))
    return texts


def _dead_link(root: Path, task_dir: Path, target: str) -> str | None:
    """The repo-relative path a brief's link points at when it is missing, or
    the target as written when it points outside the repository; None when
    it is fine or is not a file link at all."""
    if target.startswith("#") or _SCHEME.match(target):
        return None  # an anchor, or a URL: not a file in this repository
    path = unquote(target.split("#", 1)[0])
    if not path:
        return None
    base = root if path.startswith("/") else task_dir
    resolved = (base / path.lstrip("/")).resolve()
    if not resolved.is_relative_to(root):
        return target
    if resolved.exists():
        return None
    return resolved.relative_to(root).as_posix()


def _repo_path(token: str, root: Path) -> str | None:
    """`token` as a repository path, or None when it does not look like one.

    Prose is full of backticked things with a slash in them (`media/` for a
    module, `TODO/02` for a document's short name), so a token counts only
    when its first segment is a top-level entry of the repository and its
    end looks like a path: a trailing `/`, a glob, or a file extension.
    """
    token = token.replace("\\", "/").removeprefix("./")
    if not token or any(c.isspace() for c in token) or "/" not in token:
        return None
    segments = token.rstrip("/").split("/")
    if ".." in segments or token.startswith("/"):
        return None
    first = segments[0]
    if first not in TOP_LEVEL and not (root / first).exists():
        return None
    if token.endswith("/") or "*" in token or _EXTENSION.search(segments[-1]):
        return token
    return None


def _literal_prefix(pattern: str) -> str:
    """The directories of `pattern` before its first glob segment, or the
    whole path when it has none: `backend/alembic/**` is `backend/alembic`."""
    segments = pattern.rstrip("/").split("/")
    for i, segment in enumerate(segments):
        if "*" in segment:
            return "/".join(segments[:i])
    return "/".join(segments)


def _inside(root: Path, path: str) -> bool:
    """Is `path` a relative path that stays in the repository?"""
    if not path or path.startswith(("/", "\\")) or Path(path).is_absolute():
        return False
    return (root / path).resolve().is_relative_to(root)


# --------------------------------------------------------------------------- the code


def name_in_code(name: str, repo_root: str | Path) -> bool:
    """Does some source file outside the tests have `name`?

    Every `.`-separated part must occur as a whole word in the same file:
    `media.status` is there when one file says both `media` and `status`, as
    the file that sets it does. A whole word, so `Upload` is not found in
    `Uploaded`.
    """
    return _has_name(name, _code_texts(Path(repo_root).resolve()))


def _has_name(name: str, texts: list[str]) -> bool:
    flat = str(name).strip().strip("`").removesuffix("()")
    parts = flat.split(".")
    if not flat or not all(parts):
        return False
    words = [re.compile(r"(?<![A-Za-z0-9_])" + re.escape(p) + r"(?![A-Za-z0-9_])") for p in parts]
    return any(all(w.search(text) for w in words) for text in texts)


def _code_texts(root: Path) -> list[str]:
    texts = []
    for start in CODE_ROOTS:
        for path in _source_files(root, root / start):
            try:
                texts.append(path.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
    return texts


def _source_files(root: Path, start: Path) -> list[Path]:
    """The source files under `start`, sorted, tests and dependencies left
    out. A file or directory that resolves outside `root` (a link) is never
    read."""
    if not start.is_dir() or not start.resolve().is_relative_to(root):
        return []
    if set(start.resolve().relative_to(root).parts) & _SKIPPED_DIRS:
        return []  # `backend/tests/media/` is a test tree from wherever it is entered
    found = []
    for dirpath, dirnames, filenames in os.walk(start):
        dirnames[:] = sorted(d for d in dirnames if d not in _SKIPPED_DIRS)
        for filename in filenames:
            path = Path(dirpath) / filename
            if path.suffix not in SOURCE_EXTENSIONS or coverage.is_test_path(filename):
                continue
            try:
                if path.stat().st_size > _MAX_SOURCE_BYTES:
                    continue
            except OSError:
                continue
            if path.resolve().is_relative_to(root):
                found.append(path)
    return sorted(found)


def context_files(
    spec: Any, brief: str, repo_root: str | Path, max_chars: int = MAX_CONTEXT_CHARS
) -> tuple[dict[str, str], list[str]]:
    """The source files the task touches, whole, by repo-relative path, and
    the paths of those past `max_chars`.

    "Touches" is what the spec's `allowed_paths` and `forbidden_paths` match
    (by the guard's own glob rules) and the repository paths the brief names:
    the code a unit would read first. The tests are left out, as everywhere
    in this check. The order is the spec's, then the brief's, so a capped
    input keeps what the spec names first.
    """
    root = Path(repo_root).resolve()
    spec = spec if isinstance(spec, dict) else {}
    patterns = _strings(spec.get("allowed_paths")) + _strings(spec.get("forbidden_paths"))
    for token in _TICKED.findall(brief or ""):
        path = _repo_path(token.strip(), root)
        if path is not None:
            patterns.append(path + "**" if path.endswith("/") else path)

    files: dict[str, str] = {}
    for pattern in patterns:
        if not _inside(root, _literal_prefix(pattern) or "."):
            continue
        for path in _matching(root, pattern):
            rel = path.relative_to(root).as_posix()
            if rel in files:
                continue
            try:
                with path.open(encoding="utf-8", errors="replace") as fh:
                    files[rel] = fh.read(max_chars + 1)
            except OSError:
                continue
    return coverage.bundle(files, max_chars)


def _matching(root: Path, pattern: str) -> list[Path]:
    if "*" not in pattern:
        exact = root / pattern
        if exact.is_file():
            if exact.suffix not in SOURCE_EXTENSIONS or coverage.is_test_path(exact.name):
                return []
            if set(Path(pattern).parts[:-1]) & _SKIPPED_DIRS:
                return []
            return [exact] if exact.resolve().is_relative_to(root) else []
        pattern = pattern.rstrip("/") + "/**"
    start = root / _literal_prefix(pattern)
    return [
        p
        for p in _source_files(root, start)
        if path_matches(p.relative_to(root).as_posix(), pattern)
    ]


# --------------------------------------------------------------------------- the one request


def request_body(
    spec: Any,
    brief: str,
    context: dict[str, str],
    findings: list[dict[str, str]],
    *,
    model: str,
    max_tokens: int,
    system: str,
) -> dict[str, Any]:
    """The Messages API body. No tools and no thinking: one short answer.

    The spec and brief come from `main`, but a branch wrote them once, so
    they are fenced as data like the code. The findings already made are
    listed so the model spends nothing repeating them, and each source file
    is fenced under its path.
    """
    parts = [
        _SYSTEM_FRAMING,
        fenced("Task spec", _spec_text(spec)),
        fenced("Brief", brief or "(no brief)"),
        fenced("Already found without a model", _findings_text(findings)),
    ]
    for path, text in context.items():
        parts.append(fenced(f"Source file: {_label(path)}", text))
    return {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "thinking": no_thinking(),
        "messages": [{"role": "user", "content": "\n\n".join(parts)}],
    }


def _spec_text(spec: Any) -> str:
    spec = spec if isinstance(spec, dict) else {}
    objective = spec.get("objective") if isinstance(spec.get("objective"), str) else ""
    numbered = "\n".join(f"{n}. {c}" for n, c in enumerate(coverage.criteria(spec), 1))
    lines = [
        f"Task: {spec.get('task_id', '?')}",
        f"Objective: {objective}",
        "Acceptance criteria:",
        numbered or "(none)",
    ]
    for key in ("allowed_paths", "forbidden_paths", "required_context"):
        lines.append(f"{key}: {', '.join(_strings(spec.get(key))) or '(none)'}")
    return "\n".join(lines)


def _findings_text(findings: list[dict[str, str]]) -> str:
    if not findings:
        return "(none)"
    return "\n".join(f"- {f.get('kind')}: {f.get('name')}" for f in findings)


def _label(path: str) -> str:
    # As coverage's: kept to one short line that cannot open or close a fence.
    flat = " ".join(str(path).split())[:300]
    return flat.replace("<", "").replace(">", "")


def read_answer(body: Any, repo_root: str | Path) -> tuple[list[dict[str, str]], int, int] | None:
    """The names the spec uses that the code does not have, how many claimed
    names were dropped, and how many were left out as the unit's to create;
    or None when the response has no usable answer.

    The answer is `{"names": [{"name", "where", "why", "assumed_to_exist"}]}`,
    alone or in a code fence. An entry that is not that shape is skipped. An
    entry whose `assumed_to_exist` is not exactly the JSON `true` is left out
    and counted as created: a name the unit is to create is its work, not
    drift. A name some source file outside the tests has is dropped and
    counted: the counts are shown, so a model that misreads the code is
    visible as one.
    """
    text = first_text(body)
    if text is None:
        return None
    parsed = json_object(text)
    listed = parsed.get("names") if isinstance(parsed, dict) else None
    if not isinstance(listed, list):
        return None

    texts = _code_texts(Path(repo_root).resolve())
    names: list[dict[str, str]] = []
    seen: set[str] = set()
    dropped = 0
    created = 0
    for item in listed:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > MAX_NAME_CHARS:
            continue
        name = name.strip()
        if name in seen:
            continue
        seen.add(name)
        if item.get("assumed_to_exist") is not True:
            created += 1
        elif _has_name(name, texts):
            dropped += 1
        elif len(names) < MAX_NAMES:
            names.append(
                {
                    "name": name,
                    "where": _text(item.get("where"), _MAX_WHERE_CHARS),
                    "why": _text(item.get("why"), _MAX_WHY_CHARS),
                }
            )
    return names, dropped, created


def _text(value: Any, limit: int) -> str:
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


# --------------------------------------------------------------------------- jev's question


def jev_state(
    spec: Any, brief: str, context: dict[str, str], findings: list[dict[str, str]]
) -> str:
    """The state `jev` reasons over for `JEV_QUESTION`: what Haiku was shown,
    spec first, cut to fit `jev`'s context window."""
    parts = [
        f"The task's spec:\n{_spec_text(spec)}",
        f"The task's brief:\n{brief or '(no brief)'}",
        f"Paths and links the spec names that do not exist:\n{_findings_text(findings)}",
        "Source files the task touches:",
    ]
    parts += [f"--- {path} ---\n{text}" for path, text in context.items()]
    return decision.cap_state("\n\n".join(parts))


# --------------------------------------------------------------------------- the report


def render(
    task_id: str,
    findings: list[dict[str, str]],
    names: list[dict[str, str]],
    *,
    dropped: int,
    created: int = 0,
    omitted: list[str],
    usage: dict[str, Any] | None,
    cost: float | None,
    model: str | None,
    jev: dict[str, Any] | None,
    record: dict[str, Any],
    run_url: str,
) -> str:
    """The report: each missing path or link, each missing name with where
    the spec uses it and why, what it cost, and the shadow record on its last
    line.

    `model=None` means the model gave no answer, so only the free half was
    checked, and the footer says so. `jev` is `{"choice", "confidence",
    "cost_usd", "model"}`, or None when `jev` gave no answer.
    """
    problems = len(findings) + len(names)
    if problems:
        verdict = f"{problems} problem(s)"
    elif model is None:
        verdict = "no path or link drift found; names not checked"
    else:
        verdict = "no drift found"
    lines = [MARKER, f"### Spec drift: {escape(task_id, 40)} — {verdict}", ""]

    if findings:
        lines += ["Paths and links, checked without a model:", ""]
        for f in findings:
            label = _KIND_LABELS.get(str(f.get("kind")), escape(f.get("kind"), 40))
            lines.append(f"- {label}: {code(f.get('name'), 200)} ({escape(f.get('where'), 60)})")
        lines.append("")
    if names:
        lines += ["Names the spec uses that the code does not have:", ""]
        for n in names:
            where = escape(n.get("where"), _MAX_WHERE_CHARS) or "somewhere in the spec"
            why = escape(n.get("why"), _MAX_WHY_CHARS)
            lines.append(f"- {_name(n.get('name'))} ({where}){': ' + why if why else ''}")
        lines.append("")

    notes = []
    if dropped:
        notes.append(
            f"{dropped} name(s) the model gave are in the code after all, and were left out."
        )
    if created:
        notes.append(
            f"{created} name(s) the model said the unit is to create were left out: "
            "that is the unit's work, not drift."
        )
    if omitted:
        named = ", ".join(code(p, 100) for p in omitted[:MAX_SHOWN_OMITTED])
        more = (
            f" and {len(omitted) - MAX_SHOWN_OMITTED} more"
            if len(omitted) > MAX_SHOWN_OMITTED
            else ""
        )
        notes.append(f"Not read, past the input cap: {named}{more}.")
    for note in notes:
        lines += [f"Note: {note}", ""]

    lines += [
        (
            "Advisory: this fails nothing and changes nothing. A name is listed only if "
            "the model named it and no source file outside the tests has it; read the "
            "code before changing the spec."
        ),
        "",
        _usage_line(usage, cost, model),
        "",
        _run_line(run_url),
        "",
        _shadow_line(model, problems == 0, jev),
        shadow.encode(record),
    ]
    return "\n".join(lines) + "\n"


def _name(text: Any) -> str:
    """A name as a code span. A code span renders literally, so a mention or
    a URL in it is inert already; the zero-width spaces keep it from even
    reading as one."""
    flat = " ".join(str(text).split())[:MAX_NAME_CHARS]
    flat = flat.replace("@", "@\u200b").replace("://", ":/\u200b/")
    return code(flat, 2 * MAX_NAME_CHARS)


def _usage_line(usage: dict[str, Any] | None, cost: float | None, model: str | None) -> str:
    if model is None:
        spent = f" The call cost {cost_text(cost)}." if isinstance(cost, float) else ""
        return f"The model gave no answer: names in the prose were not checked.{spent}"
    return f"Read by {code(model, 80)} · {tokens_text(usage)} · {cost_text(cost)}"


def _run_line(run_url: str) -> str:
    url = run_url if is_safe_url(run_url) and len(run_url) <= 300 else ""
    link = f"[the run]({url})" if url else "the run (no usable link)"
    return f"From {link} on `main`, dispatched by hand · updated in place on each run"


def _shadow_line(model: str | None, matches: bool, jev: dict[str, Any] | None) -> str:
    haiku = "no answer" if model is None else ("matches" if matches else "does not match")
    choice = jev.get("choice") if isinstance(jev, dict) else None
    if not isinstance(jev, dict) or not isinstance(choice, str):
        return f"Shadow, acted on by nothing: Haiku: {haiku} · jev: no answer"
    confidence = jev.get("confidence")
    sure = f"{confidence:.2f}" if isinstance(confidence, int | float) else "?"
    by = f" · {code(jev.get('model'), 60)}" if isinstance(jev.get("model"), str) else ""
    return (
        f"Shadow, acted on by nothing: Haiku: {haiku} · jev: {code(choice, 20)} "
        f"(confidence {sure}, {cost_text(jev.get('cost_usd'), 7)}){by}"
    )
