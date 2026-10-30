"""Unit metrics are measurements, not hand-authored summaries.

Fixtures supply GitHub data; Git reads real isolated commits so message labels
cannot invent test commits or human-delta line counts. No test contacts GitHub
or writes the real repository's task state/telemetry. Every Git subprocess
scrubs inherited GIT_* variables, including those exported by commit hooks.
"""

import copy
import importlib
import json
import os
import runpy
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
AGENTCTL = ROOT / ".ai/bin/agentctl.py"
TASK = "UNIT-001"
REPO = "owner/repo"
MERGED = "2026-10-01T11:00:00Z"


@pytest.fixture
def metrics():
    return importlib.import_module("agentlib.metrics")


def git(root, *args):
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    return subprocess.run(
        ["git", "-c", f"core.hooksPath={root / '.git/disabled-hooks'}", *args],
        cwd=root,
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def commit(root, message, at):
    git(root, "add", "-A")
    git(root, "commit", "-q", "--date", at, "-m", message)
    return git(root, "rev-parse", "HEAD")


@pytest.fixture
def history(tmp_path, request):
    root = tmp_path / "data"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.email", "session@example.test")
    git(root, "config", "user.name", "Session")
    (root / ".ai").mkdir()
    if getattr(request, "param", "1.2.3") is not None:
        (root / ".ai/VERSION").write_text("1.2.3\n", encoding="utf-8")
    else:
        (root / "README.md").write_text("Before pipeline versions\n", encoding="utf-8")
    commit(root, "base", "2026-10-01T09:00:00Z")
    (root / "tests").mkdir()
    (root / "tests/test_feature.py").write_text("def test_feature():\n    assert True\n")
    tests = commit(root, "regression for the interface", "2026-10-01T10:00:00Z")
    (root / "app.py").write_text("result = 1\n")
    implementation = commit(root, "test: misleading implementation label", "2026-10-01T10:10:00Z")
    (root / "app.py").write_text("result = 2\n")
    review_fix = commit(root, "review correction", "2026-10-01T10:30:00Z")
    state = {
        "task_id": TASK,
        "mode": "hand",
        "pr": 17,
        "state": "COMPLETE",
        "history": [
            {"event": "VALIDATED", "at": "2026-10-01T09:00:00Z"},
            {"event": "DISPATCH_TEST_AGENT", "at": "2026-10-01T09:50:00Z"},
            {"event": "GUARD_VIOLATION", "at": "2026-10-01T10:11:00Z"},
            {"event": "GUARD_VIOLATION", "at": "2026-10-01T10:12:00Z"},
        ],
    }
    task_dir = root / ".ai/tasks" / TASK
    task_dir.mkdir(parents=True)
    (task_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")
    # Collecting old work must not substitute today's version.
    (root / ".ai/VERSION").write_text("9.9.9\n", encoding="utf-8")
    shas = [tests, implementation, review_fix]
    dates = ["10:00:00", "10:10:00", "10:30:00"]
    commits = [
        {
            "sha": sha,
            "author": {"login": "owner", "type": "User"},
            "commit": {
                "author": {"date": f"2026-10-01T{at}Z", "email": "session@example.test"},
                "committer": {"date": f"2026-10-01T{at}Z"},
            },
        }
        for sha, at in zip(shas, dates, strict=True)
    ]
    responses = {
        f"repos/{REPO}/pulls/17": {
            "number": 17,
            "merged": True,
            "merged_at": MERGED,
            "created_at": "2026-10-01T10:20:00Z",
            "base": {"repo": {"full_name": REPO}},
            "head": {"ref": f"agent/{TASK}", "sha": review_fix},
        },
        f"repos/{REPO}/pulls/17/commits": commits,
        f"repos/{REPO}/actions/workflows/test-agent.yml/runs": {
            "workflow_runs": [
                {
                    "id": index,
                    "run_attempt": 1,
                    "head_sha": sha,
                    "head_branch": f"agent/{TASK}",
                    "status": "completed",
                    "conclusion": conclusion,
                    "created_at": "2026-10-01T10:40:00Z",
                    "pull_requests": [{"number": 17}],
                }
                for index, sha, conclusion in zip(
                    [100, 101, 102, 999],
                    [*shas, "f" * 40],
                    ["failure", "success", "success", "failure"],
                    strict=True,
                )
            ]
        },
        f"repos/{REPO}/pulls/17/reviews": [
            {
                "id": 1,
                "commit_id": implementation,
                "state": "CHANGES_REQUESTED",
                "submitted_at": "2026-10-01T10:22:00Z",
            },
            {
                "id": 2,
                "commit_id": review_fix,
                "state": "APPROVED",
                "submitted_at": "2026-10-01T10:35:00Z",
            },
            {
                "id": 3,
                "commit_id": review_fix,
                "state": "COMMENTED",
                "submitted_at": "2026-10-01T10:36:00Z",
            },
            {"id": 4, "commit_id": review_fix, "state": "PENDING", "submitted_at": None},
        ],
        f"repos/{REPO}/pulls/17/comments": [{"id": 1}, {"id": 2}],
    }
    responses[f"repos/{REPO}/actions/workflows/test-agent.yml/runs"]["workflow_runs"][-1][
        "pull_requests"
    ] = [{"number": 99}]

    def github(endpoint):
        # Pagination belongs to the real adapter; fixtures are already complete.
        return copy.deepcopy(responses[endpoint.split("?", 1)[0]])

    return SimpleNamespace(
        root=root,
        state=state,
        task_dir=task_dir,
        responses=responses,
        github=github,
        tests=tests,
        implementation=implementation,
        review_fix=review_fix,
    )


def save_state(history):
    (history.task_dir / "state.json").write_text(json.dumps(history.state), encoding="utf-8")


def invocation(history, name, **values):
    directory = history.root / ".ai/telemetry/runs" / TASK
    directory.mkdir(parents=True, exist_ok=True)
    record = {
        "task_id": TASK,
        "role": "code_agent",
        "commit_sha": history.implementation,
        "cost_usd": 1.25,
        "cost_source": "provider",
    }
    record.update(values)
    (directory / name).write_text(json.dumps(record), encoding="utf-8")


def collect(metrics, history, **overrides):
    return metrics.collect(history.root, TASK, repo=REPO, github=history.github, **overrides)


def test_schema_pins_every_measurement_and_uses_git_not_commit_subjects(metrics, history):
    assert collect(metrics, history) == {
        "schema": 1,
        "task_id": TASK,
        "pr": 17,
        "mode": "hand",
        "merged_at": MERGED,
        "wall_time_seconds": 3600,
        "commits": 3,
        "test_commits": 1,
        "ci_runs": 3,
        "red_ci_runs": 1,
        "review_rounds": 2,
        "review_comments": 2,
        "human_delta_lines": 2,
        "guard_violations": 2,
        "cost_usd": None,
        "cost_source": "subscription",
        "pipeline_version": "1.2.3",
        "backfilled": False,
    }


def test_auto_uses_dispatch_and_the_last_recorded_agent_commit(metrics, history):
    history.state["mode"] = "auto"
    save_state(history)
    invocation(history, "provider.json")
    record = collect(metrics, history, backfilled=True)
    assert record["wall_time_seconds"] == 4200
    assert record["human_delta_lines"] == 2
    assert record["cost_usd"] == 1.25 and record["cost_source"] == "provider"
    assert record["backfilled"] is True


def test_legacy_state_defaults_to_auto_but_missing_attribution_is_not_zero(metrics, history):
    del history.state["mode"]
    save_state(history)
    record = collect(metrics, history)
    assert record["mode"] == "auto"
    assert record["human_delta_lines"] is None
    assert record["cost_usd"] is None


def test_director_units_do_not_need_or_create_task_state(metrics, history):
    (history.task_dir / "state.json").unlink()
    history.responses[f"repos/{REPO}/pulls/17"]["head"]["ref"] = "director/a-unit"
    record = collect(metrics, history, pr=17)
    assert record["mode"] == "director"
    assert record["human_delta_lines"] == 2
    assert record["guard_violations"] is None
    assert record["cost_usd"] is None and record["cost_source"] == "subscription"
    assert not (history.task_dir / "state.json").exists()


@pytest.mark.parametrize("history", [None], indirect=True)
def test_absent_historical_version_stays_null(metrics, history):
    assert collect(metrics, history)["pipeline_version"] is None


def test_a_mixed_provider_and_legacy_estimate_is_labelled_estimate(metrics, history):
    history.state["mode"] = "auto"
    save_state(history)
    invocation(history, "provider.json")
    invocation(history, "legacy.json", cost_usd=None, estimated_cost_usd=0.5, cost_source=None)
    # Older telemetry had no cost_usd/cost_source keys at all.
    path = history.root / ".ai/telemetry/runs" / TASK / "legacy.json"
    record = json.loads(path.read_text())
    record.pop("cost_usd")
    record.pop("cost_source")
    path.write_text(json.dumps(record))
    result = collect(metrics, history)
    assert result["cost_usd"] == 1.75 and result["cost_source"] == "estimate"


def test_unknown_cost_does_not_become_a_partial_total(metrics, history):
    history.state["mode"] = "auto"
    save_state(history)
    invocation(history, "known.json")
    invocation(history, "unknown.json", cost_usd=None, cost_source="estimate")
    assert collect(metrics, history)["cost_usd"] is None


def test_ci_rerun_attempts_keep_the_previous_red_and_ignore_other_heads(metrics, history):
    runs = history.responses[f"repos/{REPO}/actions/workflows/test-agent.yml/runs"]["workflow_runs"]
    runs[1]["run_attempt"] = 2
    history.responses[f"repos/{REPO}/actions/runs/101/attempts/1"] = {
        **runs[1],
        "run_attempt": 1,
        "conclusion": "failure",
    }
    record = collect(metrics, history)
    assert record["ci_runs"] == 4 and record["red_ci_runs"] == 2


@pytest.mark.parametrize("invalid", ["unmerged", "wrong_pr", "wrong_repo", "wrong_task_branch"])
def test_pr_identity_and_merge_are_required(metrics, history, invalid):
    pull = history.responses[f"repos/{REPO}/pulls/17"]
    if invalid == "unmerged":
        pull["merged"], pull["merged_at"] = False, None
    elif invalid == "wrong_pr":
        pull["number"] = 18
    elif invalid == "wrong_repo":
        pull["base"]["repo"]["full_name"] = "other/project"
    else:
        pull["head"]["ref"] = "agent/OTHER-001"
    with pytest.raises(metrics.MetricsError):
        collect(metrics, history)


def test_state_identity_and_explicit_pr_cannot_silently_disagree(metrics, history):
    with pytest.raises(metrics.MetricsError):
        collect(metrics, history, pr=18)
    history.state["task_id"] = "OTHER-001"
    save_state(history)
    with pytest.raises(metrics.MetricsError):
        collect(metrics, history)


@pytest.mark.parametrize("task", ["../UNIT-001", "UNIT-001;echo injected", "--help"])
def test_invalid_task_ids_are_rejected_before_reading_or_running_tools(metrics, history, task):
    def forbidden(_):
        pytest.fail("invalid identifiers must not reach GitHub")

    with pytest.raises(metrics.MetricsError):
        metrics.collect(history.root, task, pr=17, repo=REPO, github=forbidden)


def test_source_failure_propagates_instead_of_reporting_no_activity(metrics, history):
    def failed(_):
        raise OSError("GitHub unavailable")

    with pytest.raises(metrics.MetricsError):
        metrics.collect(history.root, TASK, repo=REPO, github=failed)


def test_default_adapter_paginates_and_scrubs_git_environment(metrics, history, monkeypatch):
    real_run = subprocess.run
    calls = []
    monkeypatch.setenv("GIT_DIR", "do-not-inherit")
    monkeypatch.setenv("GIT_INDEX_FILE", "do-not-inherit")

    def run(arguments, **options):
        assert options.get("shell") is not True
        if arguments[0] == "gh":
            calls.append(arguments)
            endpoint = next(value for value in arguments if value.startswith("repos/"))
            response = history.github(endpoint)
            pages = [response] if "--slurp" in arguments else response
            return SimpleNamespace(returncode=0, stdout=json.dumps(pages), stderr="")
        if arguments[0] == "git":
            assert not any(key.startswith("GIT_") for key in options["env"])
        return real_run(arguments, **options)

    monkeypatch.setattr(subprocess, "run", run)
    result = metrics.collect(history.root, TASK, repo=REPO)
    assert result["commits"] == 3
    assert any("--paginate" in args and any("/commits" in arg for arg in args) for args in calls)


def test_cli_writes_only_the_explicit_artifact_after_success(
    metrics, history, monkeypatch, tmp_path
):
    expected = collect(metrics, history)
    calls = []

    def fake_collect(root, task, **kwargs):
        calls.append((root, task, kwargs))
        return expected

    monkeypatch.setattr(metrics, "collect", fake_collect)
    monkeypatch.setenv("AGENTCTL_DATA_ROOT", str(history.root))
    cli = runpy.run_path(str(AGENTCTL))
    output = tmp_path / "records" / f"{TASK}.json"
    assert (
        cli["main"](
            ["metrics", "collect", TASK, "--pr", "17", "--repo", REPO, "--out", str(output)]
        )
        == 0
    )
    assert json.loads(output.read_text()) == expected
    assert calls[0][0] == history.root and calls[0][1] == TASK
    assert calls[0][2]["pr"] == 17 and calls[0][2]["repo"] == REPO


def test_cli_source_error_creates_no_record(metrics, history, monkeypatch, tmp_path):
    def failed(*_, **__):
        raise metrics.MetricsError("GitHub unavailable")

    monkeypatch.setattr(metrics, "collect", failed)
    monkeypatch.setenv("AGENTCTL_DATA_ROOT", str(history.root))
    cli = runpy.run_path(str(AGENTCTL))
    output = tmp_path / "must-not-exist.json"
    with pytest.raises(SystemExit) as error:
        cli["main"](
            ["metrics", "collect", TASK, "--pr", "17", "--repo", REPO, "--out", str(output)]
        )
    assert error.value.code != 0 and not output.exists()
