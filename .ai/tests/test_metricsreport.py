"""`agentctl metrics report`: §9 metrics by ISO week, mode and pipeline version.

Unknowns (null) are excluded from every mean and the count of known values is
shown as `[n]`; they are never zero. Git-reading tests scrub every GIT_*
variable so a commit hook cannot redirect the temporary repository.
"""

import importlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".ai/bin/agentctl.py"


def clean_env():
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def record(task, **changes):
    value = {
        "schema": 2,
        "task_id": task,
        "pr": 1,
        "mode": "hand",
        "merged_at": "2026-11-17T12:00:00Z",  # ISO week 2026-W47
        "wall_time_seconds": 60,
        "commits": 2,
        "test_commits": 1,
        "ci_runs": 2,
        "red_ci_runs": 1,
        "review_rounds": 0,
        "review_comments": 0,
        "human_delta_lines": 0,
        "guard_violations": 0,
        "cost_usd": None,
        "cost_source": "subscription",
        "input_tokens": None,
        "output_tokens": None,
        "cache_creation_input_tokens": None,
        "cache_read_input_tokens": None,
        "num_turns": None,
        "usage_source": None,
        "pipeline_version": None,
        "backfilled": False,
    }
    value.update(changes)
    return value


def write(directory, *records):
    directory.mkdir(parents=True, exist_ok=True)
    for r in records:
        (directory / f"{r['task_id']}.json").write_text(json.dumps(r), encoding="utf-8")
    return directory


@pytest.fixture
def mod():
    return importlib.import_module("agentlib.metricsreport")


def row(text, week, mode):
    lines = [ln.split() for ln in text.splitlines() if ln.startswith(week)]
    return next(cells for cells in lines if cells[1] == mode)


def header(text):
    return next(ln.split() for ln in text.splitlines() if ln.startswith("week"))


def test_groups_by_iso_week_of_merged_at_mode_and_version(tmp_path, mod):
    records = write(
        tmp_path / "r",
        record("A-1", merged_at="2026-11-16T00:30:00Z"),  # Monday, W47
        record("A-2", merged_at="2026-11-22T23:00:00Z"),  # Sunday, still W47
        record("A-3", merged_at="2026-11-23T01:00:00Z"),  # W48
        record("A-4", mode="auto", cost_usd=1.0, cost_source="provider"),
        record("A-5", pipeline_version="1.0.0"),
    )
    out = mod.render(mod.load_directory(records))
    head = header(out)
    units = head.index("units")
    assert row(out, "2026-W47", "hand")[units] == "2"  # A-1, A-2 (version -)
    assert row(out, "2026-W48", "hand")[units] == "1"
    assert row(out, "2026-W47", "auto")[units] == "1"
    versions = [ln.split()[head.index("version")] for ln in out.splitlines() if "2026-W47 " in ln]
    assert sorted(versions) == ["-", "-", "1.0.0"]


def test_means_exclude_nulls_and_show_known_count(tmp_path, mod):
    records = write(
        tmp_path / "r",
        record("A-1", human_delta_lines=10, review_rounds=2),
        record("A-2", human_delta_lines=20, review_rounds=None),
        record("A-3", human_delta_lines=None, review_rounds=None),
    )
    out = mod.render(mod.load_directory(records))
    cells = row(out, "2026-W47", "hand")
    head = header(out)
    assert cells[head.index("human_delta")] == "15[2]"  # null is not zero
    assert cells[head.index("rounds")] == "2[1]"
    assert cells[head.index("units")] == "3"


def test_all_unknown_is_a_dash_not_zero(tmp_path, mod):
    records = write(tmp_path / "r", record("A-1", review_comments=None))
    out = mod.render(mod.load_directory(records))
    assert row(out, "2026-W47", "hand")[header(out).index("comments")] == "-"


def test_cost_is_honest_for_subscription_unknown_and_priced(tmp_path, mod):
    records = write(
        tmp_path / "r",
        record("S-1"),  # subscription, null dollars
        record(
            "U-1", mode="auto", cost_usd=None, cost_source=None, merged_at="2026-11-24T00:00:00Z"
        ),
        record("P-1", mode="auto", cost_usd=1.0, cost_source="provider"),
        record("P-2", mode="auto", cost_usd=3.0, cost_source="estimate"),
    )
    out = mod.render(mod.load_directory(records))
    cost = header(out).index("cost")
    assert row(out, "2026-W47", "hand")[cost] == "subscription"
    assert row(out, "2026-W48", "auto")[cost] == "-"
    assert row(out, "2026-W47", "auto")[cost] == "$2.00[2]"


def test_red_ci_share_and_backfilled_count(tmp_path, mod):
    records = write(
        tmp_path / "r",
        record("A-1", ci_runs=4, red_ci_runs=1, backfilled=True),
        record("A-2", ci_runs=6, red_ci_runs=2),
        record("A-3", ci_runs=None, red_ci_runs=None),
    )
    out = mod.render(mod.load_directory(records))
    cells = row(out, "2026-W47", "hand")
    head = header(out)
    assert cells[head.index("red_ci")] == "3/10[2]"
    assert cells[head.index("backfilled")] == "1"


def test_output_is_deterministic_and_empty_input_is_clear(tmp_path, mod):
    records = write(tmp_path / "r", record("B-1"), record("A-1", mode="auto"))
    first = mod.render(mod.load_directory(records))
    assert first == mod.render(mod.load_directory(records))
    assert "no records" in mod.render([]).lower()


def test_invalid_record_fails_clearly(tmp_path, mod):
    bad = record("A-1")
    bad["surprise"] = 1
    records = write(tmp_path / "r", bad)
    with pytest.raises(mod.ReportError, match="A-1"):
        mod.load_directory(records)


def test_ref_reading_ignores_inherited_git_env(tmp_path, mod, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()
    env = clean_env()

    def git(*args):
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@example.invalid",
                "-c",
                f"core.hooksPath={tmp_path / 'nohooks'}",
                *args,
            ],
            cwd=repo,
            env=env,
            check=True,
            capture_output=True,
        )

    git("init", "-q", "-b", "main")
    git("checkout", "-q", "--orphan", "metrics")
    write(repo / "records", record("A-1", human_delta_lines=4), record("A-2", mode="auto"))
    git("add", "records")
    git("commit", "-q", "-m", "records")
    # A hostile inherited GIT_DIR must not redirect the read.
    monkeypatch.setenv("GIT_DIR", str(tmp_path / "elsewhere"))
    loaded = mod.load_ref("metrics", repo)
    assert sorted(r["task_id"] for r in loaded) == ["A-1", "A-2"]


def test_missing_ref_fails_clearly(tmp_path, mod):
    subprocess.run(["git", "init", "-q", str(tmp_path)], env=clean_env(), check=True)
    with pytest.raises(mod.ReportError, match="nope"):
        mod.load_ref("nope", tmp_path)


def run_cli(*args):
    return subprocess.run(
        [sys.executable, str(CLI), "metrics", "report", *args],
        cwd=ROOT,
        env=clean_env(),
        capture_output=True,
        text=True,
    )


def test_cli_prints_table_from_records_dir(tmp_path):
    records = write(tmp_path / "r", record("A-1", human_delta_lines=8))
    result = run_cli("--records", str(records))
    assert result.returncode == 0, result.stderr
    assert "2026-W47" in result.stdout and "8[1]" in result.stdout


def test_cli_requires_exactly_one_source_and_rejects_bad_records(tmp_path):
    assert run_cli().returncode != 0
    assert run_cli("--records", str(tmp_path), "--ref", "x").returncode != 0
    bad = record("A-1")
    bad["mode"] = "robot"
    result = run_cli("--records", str(write(tmp_path / "r", bad)))
    assert result.returncode != 0 and "A-1" in result.stderr
