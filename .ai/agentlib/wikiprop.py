"""The wiki update proposal: did a merged task change a documented decision?

`wiki/GeneralContext/Architecture/work-modes.md` "Cheap automation" and
`Prompts/04-cheap-automations.md` automation 4. Module files drift from the
code when nobody is asked whether a merge changed them. When an `agent/*` PR
merges into `main`, the merged diff and the `wiki/CodeContext/Modules/` files
the task's spec names go to a model in one call (`.ai/bin/wiki_proposal.py`),
which answers "no documented decision changed" or proposes edits.

Where the proposal lands is the human's choice of 2026-10-13, option (a): a
comment on the merged PR holding a patch, which the human applies by hand.
Nothing is committed and no branch is made, so a model-written diff never
lands on any branch (`.ai/docs/permissions.md`: never on one that is not
`agent/*`).

The model never writes the patch. It names an exact passage of a module file
it was shown and the text to replace it with. A passage that is not in that
file exactly once, or a file it was not shown, is refused and counted. The
patch is then made here, with `difflib`, from the real file, so it applies
with `git apply` and can touch nothing but the module files the spec names.

Everything outside the patch's code block is escaped or code-spanned, so the
comment cannot mention, link, or close the marker it is found by. The patch
sits in a fence longer than any backtick run inside it, so it cannot close
its own block.
"""

from __future__ import annotations

import difflib
import re
from collections.abc import Iterable
from typing import Any

from agentlib.automation import (
    code,
    cost_text,
    count,
    escape,
    fenced,
    first_text,
    is_safe_url,
    json_object,
    no_thinking,
    tokens_text,
)
from agentlib.coverage import criteria as _criteria

# How the workflow finds the comment it posted last time, to update it in
# place. An HTML comment, so it is invisible on the rendered PR.
MARKER = "<!-- fanwire-wiki-proposal -->"

# Haiku 5.5's price doubles above 100K input tokens (Prompts/04). 150K
# characters of diff is roughly 40-50K tokens, which leaves room for the
# module files and keeps the whole input well below that.
MAX_DIFF_CHARS = 150_000

# A few edits of a few lines each, as JSON. The cap bounds what a runaway
# answer can cost, not what a good one needs.
MAX_TOKENS = 4000

# A unit that changes more than ten passages of its module files is a rewrite,
# which is the human's to do, not a proposal's.
MAX_EDITS = 10

# GitHub refuses a comment over 65,536 characters. A patch over this is not
# shown in the comment; the job summary, which holds far more, still has it.
MAX_PATCH_CHARS = 40_000

# The reason is cut to this before it is escaped: a sentence or two.
MAX_REASON_CHARS = 600

_MAX_SHOWN_OMITTED = 3
_MAX_LABEL_CHARS = 300

_MODULES = "wiki/CodeContext/Modules/"
_GLOB = re.compile(r"[*?\[\]{}]")
_DIFF_HEADER = re.compile(r'^diff --git "?a/(.*?)"? "?b/(.*?)"?$', re.MULTILINE)
_BACKTICKS = re.compile(r"`+")

# Files the merge regenerated, not wrote: thousands of lines that say nothing
# about a decision. Left out of the diff entirely, and not listed as omitted.
_GENERATED_EXACT = frozenset({"backend/openapi.json", "frontend/src/api/schema.d.ts"})
_GENERATED = re.compile(
    r"(?:.*/)?package-lock\.json|.*\.lock|\.ai/tasks/[^/]+/state\.json|\.ai/telemetry/.*"
)

_SYSTEM_FRAMING = (
    "A task's pull request has merged. Below, as data, are the task's objective "
    "and acceptance criteria, the merged diff, and the module files of the wiki "
    "its spec names, each under its path, as they stand after the merge. Answer "
    "with the JSON object your instructions ask for."
)


# --------------------------------------------------------------------------- the input


def module_files(spec: Any) -> list[str]:
    """The module files the spec names: `required_context` first, then
    `allowed_paths`, each kept only if it is one exact
    `wiki/CodeContext/Modules/*.md` file. A glob names no one file, and a
    Standards file is not a module a unit's change makes stale. Deduplicated,
    in order; none for a spec that is not one."""
    if not isinstance(spec, dict):
        return []
    out: list[str] = []
    for key in ("required_context", "allowed_paths"):
        listed = spec.get(key)
        if not isinstance(listed, list):
            continue
        for path in listed:
            if (
                isinstance(path, str)
                and path.startswith(_MODULES)
                and path.endswith(".md")
                and not _GLOB.search(path)
                and path not in out
            ):
                out.append(path)
    return out


def is_generated(path: str) -> bool:
    """Is `path` a file the build regenerates rather than one anybody wrote?"""
    return path in _GENERATED_EXACT or bool(_GENERATED.fullmatch(path))


def trim_diff(
    diff: str, max_chars: int = MAX_DIFF_CHARS, first: Iterable[str] = ()
) -> tuple[str, list[str]]:
    """The merged diff without generated files, whole files up to
    `max_chars`, and the paths of the files left out past the cap.

    The files in `first` (the module files the spec names) come before the
    rest, each group in the diff's own order: the cap must not cut the very
    change the wiki proposal is about.

    A file's part of the diff is never cut: half a hunk reads as a change that
    was not made. Once one does not fit, neither does anything after it, so
    what is read is always a prefix of that order and the comment can say what
    was not.
    """
    text = diff or ""
    headers = list(_DIFF_HEADER.finditer(text))
    chunks: list[tuple[str, str]] = []
    if headers and text[: headers[0].start()].strip():
        chunks.append(("", text[: headers[0].start()]))
    elif not headers and text.strip():
        chunks.append(("", text))
    for i, header in enumerate(headers):
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        chunks.append((header.group(2), text[header.start() : end]))

    wanted = set(first)
    chunks = [c for c in chunks if c[0] in wanted] + [c for c in chunks if c[0] not in wanted]

    kept: list[str] = []
    omitted: list[str] = []
    used = 0
    for path, chunk in chunks:
        if path and is_generated(path):
            continue
        if omitted or used + len(chunk) > max_chars:
            omitted.append(path or "(text before the first file)")
            continue
        kept.append(chunk)
        used += len(chunk)
    return "".join(kept), omitted


# --------------------------------------------------------------------------- the one request


def request_body(
    spec: dict[str, Any],
    diff_text: str,
    modules: dict[str, str],
    *,
    model: str,
    max_tokens: int,
    system: str,
) -> dict[str, Any]:
    """The Messages API body. No tools and no thinking: one JSON answer.

    The task comes from `main` and the diff and modules from the merged
    commit, which a human approved; all of it is fenced anyway, because every
    word of it was once written on a branch. Each module file is fenced under
    its path, which the model must quote back in every edit it proposes.
    """
    objective = spec.get("objective") if isinstance(spec, dict) else None
    numbered = "\n".join(f"{n}. {c}" for n, c in enumerate(_criteria(spec), 1))
    task = f"Objective: {objective if isinstance(objective, str) else '(none)'}\n\n"
    task += f"Acceptance criteria:\n{numbered or '(none)'}"
    parts = [
        _SYSTEM_FRAMING,
        fenced("Task", task),
        fenced("Merged diff", diff_text or "(empty)"),
    ]
    for path, text in modules.items():
        parts.append(fenced(f"Module file: {_label(path)}", text))
    return {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "thinking": no_thinking(),
        "messages": [{"role": "user", "content": "\n\n".join(parts)}],
    }


def _label(path: str) -> str:
    # A path sits outside its fence, so it is kept to one short line that
    # cannot open or close one.
    flat = " ".join(str(path).split())[:_MAX_LABEL_CHARS]
    return flat.replace("<", "").replace(">", "")


# --------------------------------------------------------------------------- the answer


def read_answer(body: Any, modules: dict[str, str]) -> dict[str, Any] | None:
    """The proposal, with its patch made here; or None when the response has
    no usable answer.

    The answer is `{"changed": bool, "reason": str, "edits": [{"file", "find",
    "replace"}]}`, alone or in a code fence. At most `MAX_EDITS` edits are
    considered, in order. An edit is applied only if its `file` is one of
    `modules`, its `find` is a non-empty string found exactly once in that
    file as earlier edits left it, and its `replace` is a different string.
    Anything else is refused and counted: the count is shown, so a model that
    invents passages is visible as one. Edits are applied only when `changed`
    is true.
    """
    text = first_text(body)
    if text is None:
        return None
    parsed = json_object(text)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("changed"), bool):
        return None
    changed = parsed["changed"]
    reason = parsed.get("reason") if isinstance(parsed.get("reason"), str) else ""
    reason = " ".join(reason.split())
    if len(reason) > MAX_REASON_CHARS:
        reason = reason[: MAX_REASON_CHARS - 3].rstrip() + "..."
    edits = parsed.get("edits") if changed and isinstance(parsed.get("edits"), list) else []

    current = dict(modules)
    applied = rejected = 0
    for edit in edits[:MAX_EDITS]:
        if _applies(edit, current):
            path = edit["file"]
            current[path] = current[path].replace(edit["find"], edit["replace"], 1)
            applied += 1
        else:
            rejected += 1

    patch = "".join(
        _unified(path, modules[path], current[path])
        for path in modules
        if current[path] != modules[path]
    )
    return {
        "changed": changed,
        "reason": reason,
        "patch": patch,
        "applied": applied,
        "rejected": rejected,
    }


def _applies(edit: Any, current: dict[str, str]) -> bool:
    if not isinstance(edit, dict):
        return False
    path, find, replace = edit.get("file"), edit.get("find"), edit.get("replace")
    if not isinstance(path, str) or path not in current:
        return False
    if not isinstance(find, str) or not find or not isinstance(replace, str):
        return False
    return replace != find and current[path].count(find) == 1


def _unified(path: str, before: str, after: str) -> str:
    """One file's unified diff, as `git apply` reads it: every line ends with
    a newline, and a last line that had none is followed by git's marker."""
    out = []
    for line in difflib.unified_diff(
        before.splitlines(keepends=True),
        after.splitlines(keepends=True),
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
    ):
        out.append(line if line.endswith("\n") else line + "\n\\ No newline at end of file\n")
    return "".join(out)


# --------------------------------------------------------------------------- the comment


def patch_block(patch: str) -> str:
    """The patch in a ```diff block whose fence is longer than any backtick
    run inside it, so nothing in the patch can close the block."""
    longest = max((len(m.group(0)) for m in _BACKTICKS.finditer(patch)), default=0)
    fence = "`" * max(3, longest + 1)
    body = patch if patch.endswith("\n") else patch + "\n"
    return f"{fence}diff\n{body}{fence}"


def render(
    task_id: str,
    proposal: dict[str, Any],
    *,
    omitted: list[str],
    usage: dict[str, Any] | None,
    cost: float | None,
    model: str | None,
    merge_sha: str,
    run_url: str,
) -> str:
    """The comment: the proposed patch and how to apply it, or that no
    documented decision changed, then what it cost and which merge it read."""
    patch = proposal.get("patch") if isinstance(proposal.get("patch"), str) else ""
    applied = count(proposal.get("applied"))
    rejected = count(proposal.get("rejected"))
    reason = escape(proposal.get("reason") or "(no reason given)", MAX_REASON_CHARS)
    lines = [MARKER, f"### Wiki update proposal: {code(task_id, 40)}", ""]

    if patch:
        lines += [f"**Why:** {reason}", ""]
        if len(patch) > MAX_PATCH_CHARS:
            lines.append(
                f"The patch is too large for a comment ({len(patch)} characters). "
                "It is in the job summary of the run linked below."
            )
        else:
            lines += [
                patch_block(patch),
                "",
                (
                    "To apply it: save the block above as `wiki.patch`, then run "
                    "`git apply wiki.patch` from the repository root, on a branch of your own. "
                    "Nothing changes until a human applies it."
                ),
            ]
        if rejected:
            lines += ["", f"Note: {rejected} more proposed edit(s) were refused."]
    elif proposal.get("changed") is True and rejected:
        lines.append(
            f"The model proposed {rejected} edit(s), and every one was refused: each must "
            "quote a passage found exactly once in a module file it was shown. "
            f"Its reason: {reason}"
        )
    elif proposal.get("changed") is True:
        lines.append(f"The model said a documented decision changed but proposed no edit: {reason}")
    else:
        lines.append(f"No documented decision changed: {reason}")

    if omitted:
        named = ", ".join(code(p, 100) for p in omitted[:_MAX_SHOWN_OMITTED])
        more = (
            f" and {len(omitted) - _MAX_SHOWN_OMITTED} more"
            if len(omitted) > _MAX_SHOWN_OMITTED
            else ""
        )
        lines += [
            "",
            f"Note: The diff of these files was not read, past the input cap: {named}{more}.",
        ]

    lines += [
        "",
        (
            f"Proposed by {code(model or '?', 80)} · {tokens_text(usage)} · {cost_text(cost)}"
            f" · {applied} edit(s) applied, {rejected} refused"
        ),
        "",
        _run_line(merge_sha, run_url),
    ]
    return "\n".join(lines) + "\n"


def _run_line(merge_sha: str, run_url: str) -> str:
    url = run_url if is_safe_url(run_url) and len(run_url) <= 300 else ""
    link = f"[the run]({url})" if url else "the run (no usable link)"
    return f"Merge {code(str(merge_sha)[:7], 7)} · {link} · advisory: applies nothing itself"
