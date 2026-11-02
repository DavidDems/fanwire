"""Publish validated immutable metric data with trusted tools, never branch code.

Collection stages its entire batch privately before exposing artifact files.
The writer accepts only schema-2 agent records and a clean metrics checkout;
Git hooks and inherited Git routing/authentication are disabled at the boundary.
"""

from __future__ import annotations

import base64
import json
import math
import os
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

from agentlib import metrics, spec


class PublishError(Exception):
    """Publication failed; messages contain no source data or credentials."""


_COUNTERS = {
    "wall_time_seconds",
    "commits",
    "test_commits",
    "ci_runs",
    "red_ci_runs",
    "review_rounds",
    "review_comments",
    "human_delta_lines",
    "guard_violations",
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "num_turns",
}
_FIELDS = _COUNTERS | {
    "schema",
    "task_id",
    "pr",
    "mode",
    "merged_at",
    "cost_usd",
    "cost_source",
    "usage_source",
    "pipeline_version",
    "backfilled",
}
_TOKENS = {"METRICS_PUSH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"}
_TOOLS = Path(__file__).resolve().parents[1]


def _environment(*, readonly=False):
    return {
        key: value
        for key, value in os.environ.items()
        if not key.upper().startswith("GIT_")
        and (key not in _TOKENS or (readonly and key == "GH_TOKEN"))
    }


def _run(arguments, root, *, environment=None, allowed=(0,)):
    try:
        result = subprocess.run(
            list(map(str, arguments)),
            cwd=root,
            env=environment if environment is not None else _environment(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        if result.returncode not in allowed:
            raise PublishError("metric source or publication command failed")
        return result
    except (OSError, UnicodeError) as exc:
        raise PublishError("metric source or publication command failed") from exc


def _git(root, *arguments, environment=None, allowed=(0,)):
    # No data-branch path is used as a hook directory. /dev/null (NUL on
    # Windows) is deliberately not a directory and cannot contain hooks.
    return _run(
        ["git", "-c", f"core.hooksPath={os.devnull}", *arguments],
        root,
        environment=environment,
        allowed=allowed,
    )


def _task_id(value):
    if not isinstance(value, str) or not spec.TASK_ID_RE.fullmatch(value):
        raise PublishError("invalid metric task identity")
    return value


def _number(value):
    if type(value) is not int or value < 1:
        raise PublishError("invalid metric PR identity")
    return value


def _json(path):
    if path.is_symlink() or not path.is_file():
        raise PublishError("invalid metric source file")
    try:
        # Duplicate keys cannot hide a private or conflicting field.
        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise PublishError("duplicate metric JSON field")
                result[key] = value
            return result

        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs)
    except (OSError, UnicodeError, ValueError) as exc:
        raise PublishError("could not read metric JSON") from exc


def _record(value, task):
    if not isinstance(value, dict) or set(value) != _FIELDS:
        raise PublishError("invalid metric record fields")
    if type(value["schema"]) is not int or value["schema"] != 2:
        raise PublishError("invalid metric schema")
    if _task_id(value["task_id"]) != task:
        raise PublishError("metric filename and identity disagree")
    _number(value["pr"])
    if value["mode"] not in ("auto", "hand") or type(value["backfilled"]) is not bool:
        raise PublishError("invalid metric mode or provenance")
    for field in _COUNTERS:
        counter = value[field]
        if counter is not None and (type(counter) is not int or counter < 0):
            raise PublishError("invalid metric counter")
    cost = value["cost_usd"]
    if cost is not None and (
        type(cost) not in {int, float}
        or (type(cost) is float and not math.isfinite(cost))
        or cost < 0
    ):
        raise PublishError("invalid metric cost")
    if value["cost_source"] not in (None, "provider", "estimate", "subscription"):
        raise PublishError("invalid metric cost source")
    if value["usage_source"] not in (None, "claude_transcript"):
        raise PublishError("invalid metric usage source")
    version = value["pipeline_version"]
    if version is not None and (
        not isinstance(version, str) or not metrics._VERSION.fullmatch(version)
    ):
        raise PublishError("invalid metric pipeline version")
    try:
        merged = datetime.fromisoformat(value["merged_at"])
        if merged.tzinfo is None:
            raise ValueError
    except (ValueError, TypeError) as exc:
        raise PublishError("invalid metric merge timestamp") from exc
    return value


def _records(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise PublishError("invalid metric records directory")
    result = {}
    for path in sorted(directory.iterdir()):
        if path.suffix != ".json":
            raise PublishError("nonrecord path in metric data")
        task = _task_id(path.stem)
        result[task] = _record(_json(path), task)
    return result


def _store(root):
    if root.is_symlink() or not root.is_dir():
        raise PublishError("invalid metric store")
    for path in root.iterdir():
        if path.name == ".git":
            if path.is_symlink() or not path.is_dir():
                raise PublishError("invalid metric Git metadata")
        elif path.name != "records":
            raise PublishError("nonrecord path in metric store")
    records = root / "records"
    return _records(records) if records.exists() or records.is_symlink() else {}


def _state(root, task):
    tasks = root / ".ai/tasks"
    directory = tasks / task
    if (root / ".ai").is_symlink() or tasks.is_symlink() or directory.is_symlink():
        raise PublishError("invalid task source path")
    value = _json(directory / "state.json")
    if not isinstance(value, dict) or value.get("task_id") != task:
        raise PublishError("task state identity mismatch")
    if value.get("mode", "auto") not in {"auto", "hand"}:
        raise PublishError("invalid task mode")
    if value.get("pr") is not None:
        _number(value["pr"])
    return value


def _closed_task_pr(pr, repo):
    if not isinstance(pr, dict):
        raise PublishError("invalid PR source")
    try:
        return (
            pr.get("state") == "closed"
            and bool(pr.get("merged_at"))
            and pr["base"]["repo"]["full_name"] == repo
            and pr["base"].get("ref") == "main"
            and pr["head"]["repo"]["full_name"] == repo
            and isinstance(pr["head"]["ref"], str)
            and pr["head"]["ref"].startswith("agent/")
        )
    except (KeyError, TypeError):
        return False


def _eligible(pr, repo):
    # Detail/event responses must positively confirm merged, independently of
    # the merge timestamp. List-pulls responses do not carry that boolean.
    return _closed_task_pr(pr, repo) and pr.get("merged") is True


def _listed_merge(pr, repo):
    return _closed_task_pr(pr, repo) and pr.get("merged", True) is True


def _identity(pr, repo, task, number):
    if not _eligible(pr, repo) or pr["head"]["ref"] != f"agent/{task}":
        raise PublishError("PR source identity mismatch")
    if _number(pr.get("number")) != number:
        raise PublishError("PR source number mismatch")


def _github(root, endpoint):
    response = _run(
        ["gh", "api", "--paginate", "--slurp", endpoint],
        root,
        environment=_environment(readonly=True),
    )
    try:
        pages = json.loads(response.stdout)
        if isinstance(pages, list) and pages:
            if all(isinstance(page, list) for page in pages):
                return [item for page in pages for item in page]
            if len(pages) == 1 and isinstance(pages[0], dict):
                return pages[0]
    except ValueError:
        pass
    raise PublishError("invalid GitHub source response")


def _collect(root, task, *, pr, repo, out, backfilled):
    # Fetch an explicitly validated numeric PR ref as object data only. Squash
    # and rebase merges need original PR objects, absent from main's ancestry.
    _git(root, "fetch", "--no-tags", "--no-recurse-submodules", "origin", f"refs/pull/{pr}/head")
    environment = _environment(readonly=True)
    environment["AGENTCTL_DATA_ROOT"] = str(root)
    arguments = [
        sys.executable,
        "-I",
        str(_TOOLS / "bin/agentctl.py"),
        "metrics",
        "collect",
        task,
        "--pr",
        str(pr),
        "--repo",
        repo,
        "--out",
        str(out),
    ]
    if backfilled:
        arguments.append("--backfilled")
    _run(arguments, root, environment=environment)


def collect_batch(
    root,
    out_dir,
    *,
    repo,
    event_name,
    event,
    existing_root=None,
    limit=50,
    scan_offset=0,
    github=None,
    collect=None,
):
    """Verify source identity and atomically expose a complete flat record batch."""
    try:
        return _collect_batch(
            Path(root),
            Path(out_dir),
            repo=repo,
            event_name=event_name,
            event=event,
            existing_root=Path(existing_root) if existing_root is not None else None,
            limit=limit,
            scan_offset=scan_offset,
            github=github,
            collect=collect,
        )
    except PublishError:
        raise
    except Exception as exc:
        raise PublishError("metric batch collection failed") from exc


def _collect_batch(
    root, out_dir, *, repo, event_name, event, existing_root, limit, scan_offset, github, collect
):
    if not isinstance(repo, str) or not metrics._REPOSITORY.fullmatch(repo):
        raise PublishError("invalid repository identity")
    if any(part in {".", ".."} for part in repo.split("/")):
        raise PublishError("invalid repository identity")
    if type(limit) is not int or limit < 1 or limit > 1000:
        raise PublishError("invalid metric catchup limit")
    if type(scan_offset) is not int or scan_offset < 0:
        raise PublishError("invalid metric catchup offset")
    github = github or (lambda endpoint: _github(root, endpoint))
    collect = collect or _collect
    candidates = []
    backfilled = event_name in {"schedule", "workflow_dispatch"}
    if event_name == "pull_request_target":
        if not isinstance(event, dict):
            raise PublishError("invalid metric event")
        pr = event.get("pull_request")
        if event.get("action") != "closed" or not _eligible(pr, repo):
            return []
        task = _task_id(pr["head"]["ref"].removeprefix("agent/"))
        number = _number(pr.get("number"))
        task_state = _state(root, task)
        if task_state.get("pr") not in {None, number}:
            raise PublishError("task PR identity mismatch")
        candidates.append((task, task_state, number))
    elif backfilled:
        tasks = root / ".ai/tasks"
        if tasks.is_symlink() or (root / ".ai").is_symlink():
            raise PublishError("invalid task source path")
        if tasks.exists():
            for path in sorted(tasks.iterdir()):
                if path.is_symlink():
                    raise PublishError("invalid task source path")
                if not path.is_dir():
                    continue
                task = _task_id(path.name)
                if not (path / "state.json").exists():
                    continue
                task_state = _state(root, task)
                if task_state.get("pr") is not None or task_state.get("mode", "auto") == "auto":
                    candidates.append((task, task_state, task_state.get("pr")))
    else:
        raise PublishError("unsupported metric event")
    existing = _store(existing_root) if existing_root is not None else {}
    pending = []
    for task, task_state, number in candidates:
        if task in existing:
            old = existing[task]
            if (number is not None and old["pr"] != number) or old["mode"] != task_state.get(
                "mode", "auto"
            ):
                raise PublishError("existing metric and task identity disagree")
        else:
            pending.append((task, task_state, number))
    if not pending:
        return []
    if backfilled:
        offset = scan_offset % len(pending)
        pending = pending[offset:] + pending[:offset]
    pending = pending[:limit]
    if out_dir.exists() or out_dir.is_symlink():
        raise PublishError("metric batch output must be fresh")
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="metrics-stage-", dir=out_dir.parent) as temp:
        staged = Path(temp) / "records"
        staged.mkdir()
        completed = []
        for task, task_state, number in pending:
            if number is None:
                query = urlencode(
                    {
                        "state": "closed",
                        "head": f"{repo.split('/')[0]}:agent/{task}",
                        "per_page": 100,
                    }
                )
                matches = github(f"repos/{repo}/pulls?{query}")
                if not isinstance(matches, list):
                    raise PublishError("invalid PR discovery response")
                matches = [
                    item
                    for item in matches
                    if _listed_merge(item, repo) and item["head"]["ref"] == f"agent/{task}"
                ]
                if len(matches) > 1:
                    raise PublishError("ambiguous task PR identity")
                if not matches:
                    continue
                number = _number(matches[0].get("number"))
            detail = github(f"repos/{repo}/pulls/{number}")
            if backfilled and isinstance(detail, dict) and detail.get("merged") is False:
                continue
            _identity(detail, repo, task, number)
            destination = staged / f"{task}.json"
            collect(root, task, pr=number, repo=repo, out=destination, backfilled=backfilled)
            value = _record(_json(destination), task)
            if (
                value["pr"] != number
                or value["mode"] != task_state.get("mode", "auto")
                or value["backfilled"] != backfilled
            ):
                raise PublishError("collected metric identity mismatch")
            completed.append(task)
        if completed:
            if set(_records(staged)) != set(completed):
                raise PublishError("unexpected metric batch contents")
            staged.rename(out_dir)
        return sorted(completed)


def prepare_store(data_root, remote):
    """Create a fresh metrics-only checkout or empty unborn metrics branch."""
    try:
        _prepare_store(data_root, remote)
    except PublishError:
        raise
    except Exception as exc:
        raise PublishError("metric store preparation failed") from exc


def _prepare_store(data_root, remote):
    root = Path(data_root)
    if root.is_symlink() or (root.exists() and (not root.is_dir() or any(root.iterdir()))):
        raise PublishError("metric bootstrap requires an empty directory")
    if not isinstance(remote, str) or not remote or remote.startswith("-"):
        raise PublishError("invalid metric remote")
    root.mkdir(parents=True, exist_ok=True)
    _git(root, "init", "--quiet", "--initial-branch=metrics")
    _git(root, "remote", "add", "origin", remote)
    probe = _git(
        root, "ls-remote", "--exit-code", "--heads", "origin", "refs/heads/metrics", allowed=(0, 2)
    )
    if probe.returncode == 0:
        _git(root, "fetch", "--no-tags", "--no-recurse-submodules", "origin", "refs/heads/metrics")
        # Check the object tree BEFORE checkout: no filters, scripts, symlinks,
        # attributes or executable files from the remote can be materialized.
        tree = _git(root, "ls-tree", "-rz", "FETCH_HEAD").stdout
        for entry in tree.split("\0"):
            if not entry:
                continue
            metadata, name = entry.split("\t", 1)
            path = Path(name)
            if (
                metadata.split()[0] != "100644"
                or len(path.parts) != 2
                or path.parts[0] != "records"
                or path.suffix != ".json"
            ):
                raise PublishError("invalid remote metric tree")
            _task_id(path.stem)
        _git(root, "checkout", "--quiet", "-B", "metrics", "FETCH_HEAD")
    _store(root)


def publish(data_root, records_dir, *, token=None):
    """Append validated records with one ordinary push; conflicts are terminal."""
    try:
        return _publish(data_root, records_dir, token=token)
    except PublishError:
        raise
    except Exception as exc:
        raise PublishError("metric publication failed") from exc


def _publish(data_root, records_dir, *, token=None):
    root = Path(data_root)
    if root.is_symlink() or not root.is_dir():
        raise PublishError("invalid metric checkout")
    metadata = root / ".git"
    if metadata.is_symlink() or not metadata.is_dir():
        raise PublishError("publication requires its own metric checkout")
    existing = _store(root)
    if _git(root, "symbolic-ref", "--short", "HEAD").stdout.strip() != "metrics":
        raise PublishError("publication requires the metrics branch")
    if _git(root, "status", "--porcelain", "--untracked-files=all").stdout.strip():
        raise PublishError("publication requires a clean metric checkout")
    incoming = _records(Path(records_dir))
    additions = []
    for task, value in incoming.items():
        if task in existing:
            if existing[task] != value:
                raise PublishError("immutable metric record conflict")
        else:
            additions.append(task)
    if not additions:
        return []
    destination = root / "records"
    destination.mkdir(exist_ok=True)
    for task in additions:
        (destination / f"{task}.json").write_text(
            json.dumps(incoming[task], sort_keys=True, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
    _git(root, "add", "--", *[f"records/{task}.json" for task in additions])
    _git(
        root,
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Publish unit metric records",
    )
    environment = _environment()
    if token is not None:
        encoded = base64.b64encode(f"x-access-token:{token}".encode()).decode("ascii")
        environment.update(
            {
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {encoded}",
            }
        )
    _git(root, "push", "origin", "HEAD:refs/heads/metrics", environment=environment)
    return sorted(additions)
