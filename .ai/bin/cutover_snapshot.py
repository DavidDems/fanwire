#!/usr/bin/env python3
"""Build the tree the new public repository starts from (CUT-11, Prompts/25).

  cutover_snapshot.py --repo DIR --ref origin/main --expect-sha SHA --target DIR [--json]

The procedure around it is `wiki/GeneralContext/Architecture/repo-cutover.md`.
From one commit, into an empty directory, it:

  1. exports the tree (`git archive`), not the history, as committed bytes;
  2. keeps `.ai/tasks/<ID>/` only for a task not in a terminal state
     (`state.TERMINAL`). A folder with no `state.json` is a spec not yet
     started (DRAFT) and is kept; `HAND_RUNNING`, `ESCALATED` and every other
     live state are kept with their state. `.ai/tests/fixtures/` is test
     data, not tasks, and is kept whole. Deleting state on a PR trips
     `guard-gate`, which is why this happens only here;
  3. drops `.ai/telemetry/runs/`: the run records belong to finished tasks,
     and only `metrics collect` on such a task reads them;
  4. runs `docs archive-refs --write` against the source's history, so `#N`,
     commit hashes and pull/issue/commit/compare URLs name `fanwire-archive`;
  5. points what `archive-refs` leaves alone by design at `fanwire-archive`
     too: `blob/<sha>` and `tree/<sha>` links, `actions/runs/` links, and
     Markdown citations of a task folder step 2 dropped (pinned to the
     snapshot commit). A `blob/main` link stays: `main` exists in both.

It fails closed before writing anything: a non-empty target, a dirty source,
a ref that is not the full SHA recorded at the freeze, or a `state.json` it
cannot classify. A failure after writing starts empties the target again.
Stdlib only; it prints the manifest (kept and dropped paths, rewrite counts).
"""

from __future__ import annotations

import argparse
import io
import json
import os
import posixpath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[1]
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))

from agentlib import doccorpus
from agentlib.state import STATES, TERMINAL

ARCHIVE_URL = "https://github.com/DavidDems/fanwire-archive"
TASKS = ".ai/tasks/"
RUNS = ".ai/telemetry/runs/"

_SHA = re.compile(r"[0-9a-f]{40}")
_TASK_PATH = re.compile(r"\.ai/tasks/([^/]+)/")
# A revision-pinned or run link into the old repository: only the archive has it.
_PINNED = re.compile(
    r"(github\.com/[\w.-]+/)fanwire(/(?:(?:blob|tree)/[0-9a-f]{7,40}/|actions/runs/))"
)
_DEST = re.compile(r"\]\(([^)\s]+)\)")
# A code span that is only a task path, not already the text of a link.
_SPAN = re.compile(r"(?<!\[)`(\.ai/tasks/([^/`\s]+)(?:/[\w./-]*)?)`(?!\])")


class SnapshotError(Exception):
    """The input is not what the freeze recorded; nothing was kept."""


@dataclass
class Manifest:
    sha: str
    files: int = 0
    kept_tasks: list[str] = field(default_factory=list)
    dropped_tasks: list[str] = field(default_factory=list)
    dropped_paths: list[str] = field(default_factory=list)
    archive_refs: int = 0
    archive_links: int = 0


def _git(root: Path, *args: str, binary: bool = False):
    result = subprocess.run(
        ["git", "-c", "core.autocrlf=false", *args],
        cwd=root,
        capture_output=True,
        check=False,
        env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
    )
    if result.returncode:
        err = result.stderr.decode("utf-8", "replace").strip()
        raise SnapshotError(f"git {' '.join(args)}: {err}")
    return result.stdout if binary else result.stdout.decode("utf-8").strip()


def _check_inputs(repo: Path, ref: str, expect_sha: str, target: Path) -> None:
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise SnapshotError(f"target is not an empty directory: {target}")
    if not _SHA.fullmatch(expect_sha):
        raise SnapshotError(f"--expect-sha must be a full 40-character SHA: {expect_sha}")
    dirty = _git(repo, "status", "--porcelain", "--untracked-files=all")
    if dirty:
        raise SnapshotError(f"source has uncommitted changes:\n{dirty}")
    actual = _git(repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")
    if actual != expect_sha:
        raise SnapshotError(f"{ref} is {actual}, not the frozen {expect_sha}")


def _classify(tar: tarfile.TarFile) -> tuple[set[str], set[str]]:
    """(kept, dropped) task ids, from each task's committed state.json."""
    tasks, dropped = set(), set()
    for member in tar.getmembers():
        m = _TASK_PATH.match(member.name)
        if not m:
            continue
        tasks.add(m[1])
        if member.name != f"{TASKS}{m[1]}/state.json":
            continue
        try:
            current = json.loads(tar.extractfile(member).read().decode("utf-8"))["state"]
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise SnapshotError(f"{member.name}: unreadable state ({exc})") from exc
        if current not in STATES:
            raise SnapshotError(f"{member.name}: unknown state {current!r}")
        if current in TERMINAL:
            dropped.add(m[1])
    return tasks - dropped, dropped


def _is_dropped(name: str, dropped: set[str]) -> bool:
    m = _TASK_PATH.match(name)
    return name.startswith(RUNS) or bool(m and m[1] in dropped)


def _rmtree(path: Path) -> None:
    def writable(func, p, _exc):  # git's object files are read-only on Windows
        os.chmod(p, stat.S_IWRITE)
        func(p)

    shutil.rmtree(path, onexc=writable)


def _archive_refs(repo: Path, target: Path) -> int:
    """`docs archive-refs --write` in the target, resolving hashes in the source."""
    common = Path(_git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    _git(target, "init", "-q")
    try:
        alternates = target / ".git/objects/info/alternates"
        # LF: git would read a CR as part of the path.
        alternates.write_bytes((common / "objects").as_posix().encode("utf-8") + b"\n")
        _git(target, "add", "-A", "-f")
        return len(doccorpus.archive_refs(target, write=True))
    finally:
        _rmtree(target / ".git")


def _url(sha: str, path: str, committed: set[str]) -> str:
    kind = "blob" if path.rstrip("/") in committed else "tree"
    return f"{ARCHIVE_URL}/{kind}/{sha}/{path}"


def _rewrite_line(line: str, name: str, sha: str, dropped: set[str], committed: set[str]) -> str:
    line = _PINNED.sub(r"\1fanwire-archive\2", line)

    def dest(m: re.Match) -> str:
        target, _, fragment = m[1].partition("#")
        if not target or re.match(r"[a-z][\w+.-]*:|/", target):
            return m[0]
        path = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
        task = _TASK_PATH.match(path + "/")
        if not task or task[1] not in dropped:
            return m[0]
        path += "/" if target.endswith("/") else ""
        return f"]({_url(sha, path, committed)}{'#' + fragment if fragment else ''})"

    def span(m: re.Match) -> str:
        if m[2] not in dropped:
            return m[0]
        return f"[`{m[1]}`]({_url(sha, m[1], committed)})"

    return _SPAN.sub(span, _DEST.sub(dest, line))


def _archive_links(
    target: Path, sha: str, dropped: set[str], files: set[str], committed: set[str]
) -> int:
    count = 0
    for name in sorted(n for n in files if n.endswith(".md")):
        path = target / name
        text = path.read_bytes().decode("utf-8")
        out, changed = [], False
        for _, line, fenced in doccorpus._lines(text):
            new = line if fenced else _rewrite_line(line, name, sha, dropped, committed)
            count += new != line
            changed |= new != line
            out.append(new)
        if changed:
            path.write_bytes("".join(out).encode("utf-8"))
    return count


def snapshot(repo: Path, ref: str, expect_sha: str, target: Path) -> Manifest:
    repo, target = Path(repo).resolve(), Path(target).resolve()
    _check_inputs(repo, ref, expect_sha, target)
    with tarfile.open(fileobj=io.BytesIO(_git(repo, "archive", expect_sha, binary=True))) as tar:
        return _write(repo, target, expect_sha, tar)


def _write(repo: Path, target: Path, expect_sha: str, tar: tarfile.TarFile) -> Manifest:
    kept, dropped = _classify(tar)
    manifest = Manifest(sha=expect_sha, kept_tasks=sorted(kept), dropped_tasks=sorted(dropped))
    members, files = [], set()
    # Every committed file, dropped ones too: a citation's link is blob or tree.
    committed = {m.name for m in tar.getmembers() if not m.isdir()}
    for member in tar.getmembers():
        if member.isdir():
            continue
        if _is_dropped(member.name, dropped):
            manifest.dropped_paths.append(member.name)
        else:
            members.append(member)
            files.add(member.name)
    manifest.files = len(files)
    created = not target.exists()
    target.mkdir(parents=True, exist_ok=True)
    try:
        tar.extractall(target, members=members, filter="data")
        manifest.archive_refs = _archive_refs(repo, target)
        manifest.archive_links = _archive_links(target, expect_sha, dropped, files, committed)
    except BaseException:
        _rmtree(target)
        if not created:
            target.mkdir()
        raise
    return manifest


def render(manifest: Manifest) -> str:
    lines = [f"commit {manifest.sha}"]
    lines += [f"kept   {TASKS}{t}/" for t in manifest.kept_tasks]
    lines += [f"dropped {TASKS}{t}/" for t in manifest.dropped_tasks]
    lines += [f"dropped {p}" for p in manifest.dropped_paths if p.startswith(RUNS)]
    lines += [
        f"files: {manifest.files} exported, {len(manifest.dropped_paths)} dropped",
        f"archive-refs: {manifest.archive_refs} lines",
        f"archive links: {manifest.archive_links} lines",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--repo", default=str(AI_ROOT.parent), help="source repository")
    parser.add_argument("--ref", default="origin/main")
    parser.add_argument("--expect-sha", required=True, help="the SHA recorded at the freeze")
    parser.add_argument("--target", required=True, help="an empty or missing directory")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")
    try:
        manifest = snapshot(Path(args.repo), args.ref, args.expect_sha, Path(args.target))
    except (SnapshotError, OSError, tarfile.TarError) as exc:
        print(f"cutover snapshot: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(asdict(manifest), indent=2) if args.json else render(manifest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
