"""Deterministic per-unit measurements (schema 2), read-only at the source.

All counts come from a merged PR, its Git objects, task history and invocation
telemetry. CI counts completed test-agent attempts (including earlier reruns),
and red means state.CI_CONCLUSIONS classifies the conclusion as CI_FAILED.
Review rounds are distinct reviewed commits with a submitted review; comments
are inline PR review comments. Test commits contain only conventional test
paths. Merge commits count toward commits but not test commits or human delta:
their diff carries unrelated main updates rather than a person's correction.

For auto runs, human delta needs a last recorded content-agent commit and
GitHub author identities. It counts subsequent non-bot authors other than the
recorded agents; unknown attribution makes the result null. For hand
and Director runs it is the review-stage proxy: changed lines in non-merge
commits committed after the PR opened, even when the session uses the owner's
identity. It is not a claim that a different person typed those changes.
Missing attribution, binary line counts, unavailable historical VERSION, and
unknown cost stay null. Guard violations count recorded GUARD_VIOLATION events;
without task history that observation is unknown, not zero. Subscription cost
is null, not an invented dollar estimate. Hand usage is validated metadata
recorded at hand finish; collection does not read transcripts. New usage fields
remain null for legacy hand records and for auto/Director units.

VERSION is read from the first unit commit, never today's checkout. Source
errors abort collection rather than yielding a plausible partial record.
Storage, scheduling, VERSION enforcement and reports are separate deliverables.
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode, urlparse

from agentlib import handusage, spec, state

SCHEMA_VERSION = 2
_SHA = re.compile(r"[0-9a-fA-F]{40}\Z")
_REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
_NUMBER = r"(?:0|[1-9]\d*)"
_PRERELEASE = rf"(?:{_NUMBER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
_VERSION = re.compile(
    rf"{_NUMBER}\.{_NUMBER}\.{_NUMBER}(?:-{_PRERELEASE}(?:\.{_PRERELEASE})*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\Z"
)
_CONTENT_ROLES = frozenset({"test_agent", "code_agent", "context_maintainer"})


class MetricsError(Exception):
    """The requested measurement cannot be derived from its source evidence."""


def _run(arguments: list[str], root: Path) -> str:
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    try:
        result = subprocess.run(
            arguments,
            cwd=root,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    except (OSError, UnicodeError) as exc:
        raise MetricsError(f"could not read {arguments[0]} source") from exc
    if result.returncode:
        # Raw tool errors can contain URLs/credentials; identify the source only.
        raise MetricsError(f"{arguments[0]} source read failed")
    return result.stdout


def _git(root: Path, *arguments: str) -> str:
    return _run(["git", *arguments], root)


def _github(root: Path, endpoint: str):
    text = _run(["gh", "api", "--paginate", "--slurp", endpoint], root)
    try:
        pages = json.loads(text)
    except (ValueError, TypeError) as exc:
        raise MetricsError("GitHub returned invalid JSON") from exc
    if not isinstance(pages, list) or not pages:
        raise MetricsError("GitHub returned no response pages")
    if all(isinstance(page, list) for page in pages):
        return [item for page in pages for item in page]
    if all(
        isinstance(page, dict) and isinstance(page.get("workflow_runs"), list) for page in pages
    ):
        return {"workflow_runs": [run for page in pages for run in page["workflow_runs"]]}
    if len(pages) == 1:
        return pages[0]
    raise MetricsError("unexpected GitHub pagination shape")


def _object(value, label: str) -> dict:
    if not isinstance(value, dict):
        raise MetricsError(f"invalid {label} object")
    return value


def _items(value, label: str) -> list[dict]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise MetricsError(f"invalid {label} list")
    return value


def _time(value, label: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError("timezone required")
        return parsed
    except (TypeError, ValueError) as exc:
        raise MetricsError(f"invalid {label} timestamp") from exc


def _integer(value, label: str, minimum: int = 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise MetricsError(f"invalid {label}")
    return value


def _read_object(path: Path) -> dict:
    try:
        return _object(json.loads(path.read_text(encoding="utf-8")), path.name)
    except (OSError, UnicodeError, ValueError) as exc:
        raise MetricsError(f"could not read {path.name} JSON") from exc


def _repository(root: Path, supplied: str | None) -> str:
    if supplied is None:
        remote = _git(root, "remote", "get-url", "origin").strip()
        if remote.startswith("git@github.com:"):
            supplied = remote.removeprefix("git@github.com:")
        else:
            parsed = urlparse(remote)
            if parsed.hostname != "github.com":
                raise MetricsError("origin is not a GitHub repository; supply --repo")
            supplied = parsed.path.lstrip("/")
        supplied = supplied.removesuffix(".git")
    if not isinstance(supplied, str) or not _REPOSITORY.fullmatch(supplied):
        raise MetricsError("repository must be owner/name")
    if any(part in {".", ".."} for part in supplied.split("/")):
        raise MetricsError("invalid repository owner/name")
    return supplied


def _commit(root: Path, item: dict) -> dict:
    sha = item.get("sha")
    if not isinstance(sha, str) or not _SHA.fullmatch(sha):
        raise MetricsError("invalid PR commit SHA")
    parents = _git(root, "rev-list", "--parents", "-n", "1", sha).split()
    merged = len(parents) > 2
    text = _git(
        root,
        "show",
        "--format=",
        "--numstat",
        "-z",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        sha,
        "--",
    )
    files, changed = [], 0
    for entry in text.split("\0"):
        if not entry:
            continue
        fields = entry.split("\t", 2)
        if len(fields) != 3:
            raise MetricsError("invalid Git numstat output")
        added, deleted, path = fields
        files.append(path)
        if added == "-" or deleted == "-":
            changed = None
        elif changed is not None:
            try:
                changed += int(added) + int(deleted)
            except ValueError as exc:
                raise MetricsError("invalid Git line counts") from exc
    metadata = _object(item.get("commit"), "commit metadata")
    author = _object(metadata.get("author"), "commit author")
    committer = _object(metadata.get("committer"), "commit committer")
    return {
        "sha": sha,
        "merge": merged,
        "files": files,
        "lines": changed,
        "authored": _time(author.get("date"), "commit author"),
        "committed": _time(committer.get("date"), "commit committer"),
        "actor": item.get("author"),
    }


def _test_path(path: str) -> bool:
    parts = path.split("/")
    name = parts[-1]
    return (
        any(part in {"test", "tests", "__tests__"} for part in parts[:-1])
        or name.startswith("test_")
        or ".test." in name
        or ".spec." in name
    )


def _version(root: Path, sha: str) -> str | None:
    if not _git(root, "ls-tree", "--name-only", "-z", sha, "--", ".ai/VERSION"):
        return None
    version = _git(root, "show", "--no-ext-diff", "--no-textconv", f"{sha}:.ai/VERSION").strip()
    if not _VERSION.fullmatch(version):
        raise MetricsError("historical pipeline VERSION is not semver")
    return version


def _invocations(root: Path, task_id: str) -> list[dict]:
    records = []
    for path in sorted((root / ".ai/telemetry/runs" / task_id).glob("*.json")):
        record = _read_object(path)
        if record.get("task_id") != task_id:
            raise MetricsError("telemetry task identity does not match its directory")
        if not isinstance(record.get("role"), str):
            raise MetricsError("telemetry role is unavailable")
        sha = record.get("commit_sha")
        if sha is not None and (not isinstance(sha, str) or not _SHA.fullmatch(sha)):
            raise MetricsError("invalid telemetry commit SHA")
        records.append(record)
    return records


def _cost(mode: str, records: list[dict]) -> tuple[float | None, str | None]:
    if mode in {"hand", "director"}:
        return None, "subscription"
    if not records:
        return None, None
    values = []
    source = (
        "provider" if all(rec.get("cost_source") == "provider" for rec in records) else "estimate"
    )
    for record in records:
        value = record["cost_usd"] if "cost_usd" in record else record.get("estimated_cost_usd")
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < 0
        ):
            return None, source
        values.append(float(value))
    try:
        return math.fsum(values), source
    except OverflowError:
        return None, source


def _human_delta(
    mode: str, commits: list[dict], opened: datetime, records: list[dict]
) -> int | None:
    if mode == "auto":
        anchors = {rec.get("commit_sha") for rec in records if rec.get("role") in _CONTENT_ROLES}
        positions = [index for index, item in enumerate(commits) if item["sha"] in anchors]
        if not positions:
            return None
        actors = [_actor(commits[index]) for index in positions]
        if None in actors:
            return None
        candidates = []
        for item in commits[max(positions) + 1 :]:
            if item["merge"]:
                continue
            actor = _actor(item)
            if actor is None:
                return None
            if actor not in actors and item["actor"].get("type") != "Bot":
                candidates.append(item)
    else:
        candidates = [item for item in commits if item["committed"] > opened]
    lines = [item["lines"] for item in candidates if not item["merge"]]
    return None if None in lines else sum(lines)


def _actor(commit: dict) -> str | None:
    actor = commit.get("actor")
    if not isinstance(actor, dict):
        return None
    login = actor.get("login")
    return login.casefold() if isinstance(login, str) and login else None


def _ci(get: Callable, prefix: str, branch: str, shas: set[str], pr: int, merged: datetime):
    endpoint = f"{prefix}/actions/workflows/test-agent.yml/runs?{urlencode({'branch': branch, 'per_page': 100})}"
    runs = _items(_object(get(endpoint), "workflow response").get("workflow_runs"), "workflow runs")
    attempts = {}
    for run in runs:
        references = _items(run.get("pull_requests", []), "run pull requests")
        if not (
            any(ref.get("number") == pr for ref in references)
            or (run.get("head_sha") in shas and run.get("head_branch") == branch)
        ):
            continue
        if _time(run.get("created_at"), "CI creation") > merged:
            continue
        run_id = _integer(run.get("id"), "CI run id")
        latest = _integer(run.get("run_attempt", 1), "CI attempt")
        for number in range(1, latest + 1):
            attempt = (
                run
                if number == latest
                else _object(get(f"{prefix}/actions/runs/{run_id}/attempts/{number}"), "CI attempt")
            )
            if attempt.get("id") != run_id or attempt.get("run_attempt", 1) != number:
                raise MetricsError("CI attempt identity does not match its run")
            attempts[run_id, number] = attempt
    if any(attempt.get("status") != "completed" for attempt in attempts.values()):
        return None, None
    for attempt in attempts.values():
        if attempt.get("conclusion") not in state.CI_CONCLUSIONS:
            raise MetricsError("unknown CI conclusion")
    return len(attempts), sum(
        state.CI_CONCLUSIONS[attempt["conclusion"]] == "CI_FAILED" for attempt in attempts.values()
    )


def collect(
    root: str | Path,
    task_id: str,
    *,
    pr: int | None = None,
    repo: str | None = None,
    github: Callable[[str], object] | None = None,
    backfilled: bool = False,
) -> dict:
    """Read a merged unit's sources and return its complete flat schema record.

    ``github`` supplies complete endpoint responses in offline tests. Production
    uses paginated, read-only ``gh api`` calls. This function never writes data.
    """
    if not isinstance(task_id, str) or not spec.TASK_ID_RE.fullmatch(task_id):
        raise MetricsError("invalid task id")
    root = Path(root).resolve()
    if not root.is_dir():
        raise MetricsError("data root does not exist")
    repository = _repository(root, repo)
    path = root / ".ai/tasks" / task_id / "state.json"
    task = _read_object(path) if path.exists() else None
    if task is not None and task.get("task_id") != task_id:
        raise MetricsError("state task identity does not match its directory")
    recorded_pr = task.get("pr") if task is not None else None
    if pr is not None and recorded_pr is not None and pr != recorded_pr:
        raise MetricsError("explicit PR disagrees with recorded task PR")
    pr = _integer(pr if pr is not None else recorded_pr, "merged PR number")
    prefix = f"repos/{repository}"

    def get(endpoint):
        try:
            return github(endpoint) if github is not None else _github(root, endpoint)
        except MetricsError:
            raise
        except Exception as exc:
            raise MetricsError("GitHub source read failed") from exc

    pull = _object(get(f"{prefix}/pulls/{pr}"), "pull request")
    base_repository = _object(_object(pull.get("base"), "PR base").get("repo"), "base repository")
    if (
        pull.get("number") != pr
        or str(base_repository.get("full_name")).casefold() != repository.casefold()
    ):
        raise MetricsError("PR identity does not match the requested repository/number")
    if pull.get("merged") is not True:
        raise MetricsError("unit PR must be merged")
    merged = _time(pull.get("merged_at"), "merge")
    opened = _time(pull.get("created_at"), "PR creation")
    branch = _object(pull.get("head"), "PR head").get("ref")
    if not isinstance(branch, str) or not branch:
        raise MetricsError("PR head branch is unavailable")
    if branch.startswith("agent/"):
        if branch != f"agent/{task_id}" or task is None:
            raise MetricsError("agent PR must match the task and have recorded state")
        mode = task.get("mode", "auto")
        if mode not in state.MODES:
            raise MetricsError("unknown task mode")
    else:
        if task is not None:
            raise MetricsError("task state cannot identify a non-agent PR")
        mode = "director"
    history = _items(task.get("history"), "task history") if task is not None else None
    raw_commits = _items(get(f"{prefix}/pulls/{pr}/commits?per_page=100"), "PR commits")
    if not raw_commits:
        raise MetricsError("merged PR has no available commits")
    commits = [_commit(root, item) for item in raw_commits]
    shas = {item["sha"] for item in commits}
    if len(shas) != len(commits):
        raise MetricsError("duplicate PR commits")
    records = _invocations(root, task_id)
    start = min(item["authored"] for item in commits)
    if mode == "auto":
        dispatched = [
            _time(item.get("at"), "dispatch")
            for item in history
            if str(item.get("event", "")).startswith("DISPATCH_")
        ]
        if dispatched:
            start = min(dispatched)
    if start > merged:
        raise MetricsError("unit starts after its merge")
    ci_runs, red = _ci(get, prefix, branch, shas, pr, merged)
    reviews = _items(get(f"{prefix}/pulls/{pr}/reviews?per_page=100"), "reviews")
    comments = _items(get(f"{prefix}/pulls/{pr}/comments?per_page=100"), "review comments")
    rounds = {
        item.get("commit_id")
        for item in reviews
        if item.get("submitted_at") is not None and _time(item["submitted_at"], "review") <= merged
    }
    if None in rounds:
        raise MetricsError("submitted review has no commit identity")
    dollars, source = _cost(mode, records)
    try:
        usage = handusage.validate(task.get("hand_usage")) if mode == "hand" else None
    except handusage.HandUsageError as exc:
        raise MetricsError(str(exc)) from None
    return {
        "schema": SCHEMA_VERSION,
        "task_id": task_id,
        "pr": pr,
        "mode": mode,
        "merged_at": pull["merged_at"],
        "wall_time_seconds": int((merged - start).total_seconds()),
        "commits": len(commits),
        "test_commits": sum(
            not item["merge"]
            and bool(item["files"])
            and all(_test_path(path) for path in item["files"])
            for item in commits
        ),
        "ci_runs": ci_runs,
        "red_ci_runs": red,
        "review_rounds": len(rounds),
        "review_comments": len(comments),
        "human_delta_lines": _human_delta(mode, commits, opened, records),
        "guard_violations": sum(item.get("event") == "GUARD_VIOLATION" for item in history)
        if history is not None
        else None,
        "cost_usd": dollars,
        "cost_source": source,
        **{field: usage[field] if usage is not None else None for field in handusage.TOKEN_FIELDS},
        "num_turns": usage["num_turns"] if usage is not None else None,
        "usage_source": usage["source"] if usage is not None else None,
        "pipeline_version": _version(root, commits[0]["sha"]),
        "backfilled": bool(backfilled),
    }
