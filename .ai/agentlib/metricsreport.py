"""Plain-text report of the philosophy section 9 metrics, from unit records.

Reads `records/<TASK-ID>.json` (a directory, or a git ref holding that tree such
as origin/metrics), validates each with the publisher's own validator, and
prints one row per ISO week of merged_at, mode and pipeline version.

Unknown (null) values are never zero: every mean covers only the units that
know the value, and `[n]` shows how many that was; `-` means none did. Cost is
the mean of known dollars, else `subscription` when units say so, else `-`.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import metricspublish as publish


class ReportError(Exception):
    """A source could not be read or held an invalid record."""


def _load_file(path: Path) -> dict:
    task = path.stem
    try:
        return publish._record(publish._json(path), task)
    except publish.PublishError as exc:
        raise ReportError(f"invalid record {path.name}: {exc}") from exc


def load_directory(directory) -> list[dict]:
    directory = Path(directory)
    if not directory.is_dir():
        raise ReportError(f"records directory not found: {directory}")
    return [_load_file(p) for p in sorted(directory.glob("*.json"))]


def _git(root, *args) -> str:
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
    result = subprocess.run(
        ["git", *args], cwd=root, env=env, capture_output=True, text=True, encoding="utf-8"
    )
    if result.returncode:
        raise ReportError(f"git {args[0]} failed: {result.stderr.strip()}")
    return result.stdout


def load_ref(ref: str, root) -> list[dict]:
    try:
        names = _git(root, "ls-tree", "-r", "--name-only", ref, "--", "records").splitlines()
    except ReportError as exc:
        raise ReportError(f"cannot read ref {ref}: {exc}") from exc
    with tempfile.TemporaryDirectory() as scratch:
        for name in names:
            if name.endswith(".json") and name.count("/") == 1:
                (Path(scratch) / Path(name).name).write_text(
                    _git(root, "show", f"{ref}:{name}"), encoding="utf-8"
                )
        return load_directory(scratch)


def _week(merged_at: str) -> str:
    year, week, _ = datetime.fromisoformat(merged_at).astimezone(timezone.utc).isocalendar()
    return f"{year}-W{week:02d}"


def _mean(values) -> str:
    known = [v for v in values if v is not None]
    if not known:
        return "-"
    return f"{sum(known) / len(known):.1f}".removesuffix(".0") + f"[{len(known)}]"


def _cost(group) -> str:
    known = [r["cost_usd"] for r in group if r["cost_usd"] is not None]
    if known:
        return f"${sum(known) / len(known):.2f}[{len(known)}]"
    if any(r["cost_source"] == "subscription" for r in group):
        return "subscription"
    return "-"


def _red(group) -> str:
    pairs = [(r["red_ci_runs"], r["ci_runs"]) for r in group if None not in (r["red_ci_runs"], r["ci_runs"])]
    if not pairs:
        return "-"
    return f"{sum(p[0] for p in pairs)}/{sum(p[1] for p in pairs)}[{len(pairs)}]"


COLUMNS = (
    "week", "mode", "version", "units", "backfilled", "cost",
    "human_delta", "rounds", "comments", "red_ci",
)  # fmt: skip

LEGEND = (
    "cost, human_delta (lines), rounds, comments: mean per unit; red_ci: red/total CI runs.\n"
    "[n] = units with a known value; unknowns are excluded, never counted as zero; - = none known."
)


def render(records: list[dict]) -> str:
    if not records:
        return "no records"
    groups: dict[tuple, list[dict]] = {}
    for r in records:
        groups.setdefault((_week(r["merged_at"]), r["mode"], r["pipeline_version"] or "-"), []).append(r)
    rows = [COLUMNS]
    for (week, mode, version), g in sorted(groups.items()):
        rows.append(
            (
                week, mode, version, str(len(g)), str(sum(r["backfilled"] for r in g)), _cost(g),
                _mean([r["human_delta_lines"] for r in g]),
                _mean([r["review_rounds"] for r in g]),
                _mean([r["review_comments"] for r in g]),
                _red(g),
            )
        )  # fmt: skip
    widths = [max(len(row[i]) for row in rows) for i in range(len(COLUMNS))]
    lines = ["  ".join(c.ljust(w) for c, w in zip(row, widths)).rstrip() for row in rows]
    return "\n".join([*lines, "", LEGEND])
