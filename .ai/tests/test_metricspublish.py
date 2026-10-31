"""Metrics publication must write data to metrics, never executable state to main.

Offline sources establish candidate identity and batch atomicity. Isolated bare
remotes exercise the actual branch, hook and push boundary; every Git process
scrubs all GIT_* variables even when pytest was launched from a commit hook.
"""

import base64
import importlib
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

REPO = "owner/repo"
TASK = "UNIT-001"
ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = ROOT / ".ai/bin/metrics_publish.py"


@pytest.fixture
def publisher():
    return importlib.import_module("agentlib.metricspublish")


def git(root, *args, check=True):
    environment = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith("GIT_") and k not in {"METRICS_PUSH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"}
    }
    result = subprocess.run(
        ["git", "-c", f"core.hooksPath={root / 'disabled-hooks'}", *args],
        cwd=root,
        env=environment,
        capture_output=True,
        text=True,
        check=check,
    )
    return result.stdout.strip()


def cli(*arguments, output=None, cwd, no_tools=False):
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("GIT_")
        and key not in {"METRICS_PUSH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "GITHUB_OUTPUT"}
    }
    if output is not None:
        environment["GITHUB_OUTPUT"] = str(output)
    if no_tools:
        # An ineligible/malformed event must need no Git or GitHub source.
        environment["PATH"] = ""
    return subprocess.run(
        [sys.executable, "-I", str(ENTRYPOINT), *map(str, arguments)],
        cwd=cwd,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def record(task=TASK, pr=17, **changes):
    return {
        "schema": 2,
        "task_id": task,
        "pr": pr,
        "mode": "hand",
        "merged_at": "2026-10-01T11:00:00Z",
        "wall_time_seconds": 3600,
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
        **changes,
    }


def pull(task=TASK, pr=17, **changes):
    return {
        "number": pr,
        "merged": True,
        "state": "closed",
        "merged_at": "2026-10-01T11:00:00Z",
        "base": {"repo": {"full_name": REPO}},
        "head": {"ref": f"agent/{task}", "repo": {"full_name": REPO}},
        **changes,
    }


def event(pr=None):
    return {"action": "closed", "pull_request": pr or pull()}


def state(root, task=TASK, pr=17, **changes):
    destination = root / ".ai/tasks" / task / "state.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps({"task_id": task, "pr": pr, "mode": "hand", "state": "COMPLETE", **changes}),
        encoding="utf-8",
    )


def batch_record(directory, value):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{value['task_id']}.json").write_text(json.dumps(value), encoding="utf-8")


def sources(root):
    calls = []

    def github(endpoint):
        calls.append(("github", endpoint))
        number = int(endpoint.rsplit("/", 1)[1])
        return pull("UNIT-001" if number == 17 else "UNIT-002", number)

    def collect(source_root, task_id, *, pr, repo, out, backfilled):
        assert Path(source_root) == root
        assert repo == REPO
        calls.append(("collect", task_id, pr, backfilled))
        mode = json.loads((root / ".ai/tasks" / task_id / "state.json").read_text())["mode"]
        value = record(
            task_id,
            pr,
            backfilled=backfilled,
            mode=mode,
            cost_source="subscription" if mode == "hand" else None,
        )
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(json.dumps(value), encoding="utf-8")

    return github, collect, calls


def test_event_collects_verified_unit_through_injected_trusted_collector(publisher, tmp_path):
    root, out = tmp_path / "tools", tmp_path / "batch"
    state(root)
    github, collect, calls = sources(root)
    before = (root / ".ai/tasks" / TASK / "state.json").read_bytes()
    assert publisher.collect_batch(
        root,
        out,
        repo=REPO,
        event_name="pull_request_target",
        event=event(),
        github=github,
        collect=collect,
    ) == [TASK]
    assert json.loads((out / f"{TASK}.json").read_text()) == record()
    assert calls == [("github", f"repos/{REPO}/pulls/17"), ("collect", TASK, 17, False)]
    assert (root / ".ai/tasks" / TASK / "state.json").read_bytes() == before


def test_event_can_supply_the_pr_missing_from_legacy_auto_state(publisher, tmp_path):
    root, out = tmp_path / "tools", tmp_path / "batch"
    state(root, mode="auto")
    source = root / ".ai/tasks" / TASK / "state.json"
    value = json.loads(source.read_text())
    del value["pr"]
    source.write_text(json.dumps(value))
    github, collect, _ = sources(root)
    assert publisher.collect_batch(
        root,
        out,
        repo=REPO,
        event_name="pull_request_target",
        event=event(),
        github=github,
        collect=collect,
    ) == [TASK]
    assert json.loads((out / f"{TASK}.json").read_text())["mode"] == "auto"
    assert "pr" not in json.loads(source.read_text()), "collection never repairs task state"


@pytest.mark.parametrize("kind", ["unmerged", "fork", "director", "wrong_base", "not_closed"])
def test_ineligible_events_do_not_collect_or_query_sources(publisher, tmp_path, kind):
    root, out = tmp_path / "tools", tmp_path / "batch"
    state(root)
    payload = event()
    pr = payload["pull_request"]
    if kind == "unmerged":
        pr["merged"] = False
    elif kind == "fork":
        pr["head"]["repo"]["full_name"] = "fork/repo"
    elif kind == "director":
        pr["head"]["ref"] = "director/change"
    elif kind == "wrong_base":
        pr["base"]["repo"]["full_name"] = "other/repo"
    else:
        payload["action"] = "opened"

    def forbidden(*args, **kwargs):
        pytest.fail("an ineligible event reached a source")

    assert (
        publisher.collect_batch(
            root,
            out,
            repo=REPO,
            event_name="pull_request_target",
            event=payload,
            github=forbidden,
            collect=forbidden,
        )
        == []
    )
    assert not out.exists()


@pytest.mark.parametrize("bad_id", ["../UNIT-001", "UNIT-001/../../escape", "UNIT-001\nOTHER-001"])
def test_branch_task_identity_is_validated_before_filesystem_use(publisher, tmp_path, bad_id):
    payload = event()
    payload["pull_request"]["head"]["ref"] = "agent/" + bad_id
    with pytest.raises(publisher.PublishError):
        publisher.collect_batch(
            tmp_path, tmp_path / "batch", repo=REPO, event_name="pull_request_target", event=payload
        )


@pytest.mark.parametrize(
    "kind", ["state_pr", "state_id", "source_branch", "source_repo", "source_pr"]
)
def test_event_source_identity_cannot_disagree_with_task_state(publisher, tmp_path, kind):
    root, out = tmp_path / "tools", tmp_path / "batch"
    state(
        root,
        pr=99 if kind == "state_pr" else 17,
        task_id="OTHER-001" if kind == "state_id" else TASK,
    )
    github, collect, _ = sources(root)

    def changed(endpoint):
        value = github(endpoint)
        if kind == "source_branch":
            value["head"]["ref"] = "agent/OTHER-001"
        elif kind == "source_repo":
            value["head"]["repo"]["full_name"] = "fork/repo"
        elif kind == "source_pr":
            value["number"] = 99
        return value

    with pytest.raises(publisher.PublishError):
        publisher.collect_batch(
            root,
            out,
            repo=REPO,
            event_name="pull_request_target",
            event=event(),
            github=changed,
            collect=collect,
        )
    assert not out.exists()


@pytest.mark.parametrize("event_name", ["schedule", "workflow_dispatch"])
def test_catchup_skips_existing_records_and_unknown_units_marks_backfilled(
    publisher, tmp_path, event_name
):
    root, out, existing = tmp_path / "tools", tmp_path / "batch", tmp_path / "store"
    state(root)
    state(root, "UNIT-002", 18)
    state(root, "UNIT-003", None, state="DRAFT")
    batch_record(existing / "records", record())
    github, collect, calls = sources(root)
    assert publisher.collect_batch(
        root,
        out,
        repo=REPO,
        event_name=event_name,
        event={},
        existing_root=existing,
        github=github,
        collect=collect,
    ) == ["UNIT-002"]
    assert json.loads((out / "UNIT-002.json").read_text())["backfilled"] is True
    assert calls == [("github", f"repos/{REPO}/pulls/18"), ("collect", "UNIT-002", 18, True)]


def test_catchup_limit_bounds_attempts_even_when_no_candidate_is_merged(publisher, tmp_path):
    root, out = tmp_path / "tools", tmp_path / "batch"
    state(root)
    state(root, "UNIT-002", 18)
    called = []

    def github(endpoint):
        called.append(endpoint)
        return pull(merged=False)

    assert (
        publisher.collect_batch(
            root,
            out,
            repo=REPO,
            event_name="schedule",
            event={},
            limit=1,
            github=github,
            collect=lambda *a, **k: pytest.fail("unmerged unit collected"),
        )
        == []
    )
    assert called == [f"repos/{REPO}/pulls/17"]
    assert not out.exists()


@pytest.mark.parametrize("discovery", ["unique", "none", "unmerged", "ambiguous"])
def test_catchup_discovers_missing_auto_pr_only_from_unique_merged_same_repo_head(
    publisher, tmp_path, discovery
):
    root, out = tmp_path / "tools", tmp_path / "batch"
    state(root, pr=None, mode="auto")
    _, collect, _ = sources(root)
    calls = []

    def github(endpoint):
        calls.append(endpoint)
        parsed = urlsplit(endpoint)
        if parsed.query:
            assert parsed.path == f"repos/{REPO}/pulls"
            query = parse_qs(parsed.query)
            assert query["state"] == ["closed"]
            assert query["head"] == [f"owner:agent/{TASK}"]
            assert query["per_page"] == ["100"]
            if discovery == "none":
                return []
            if discovery == "unmerged":
                return [pull(merged=False, merged_at=None)]
            if discovery == "ambiguous":
                return [pull(), pull(pr=18)]
            return [
                pull(head={"ref": f"agent/{TASK}", "repo": {"full_name": "fork/repo"}}),
                pull("OTHER-001", 99),
                pull(),
            ]
        assert endpoint == f"repos/{REPO}/pulls/17"
        return pull()

    if discovery == "ambiguous":
        with pytest.raises(publisher.PublishError):
            publisher.collect_batch(
                root,
                out,
                repo=REPO,
                event_name="schedule",
                event={},
                github=github,
                collect=collect,
            )
        assert not out.exists()
    else:
        result = publisher.collect_batch(
            root,
            out,
            repo=REPO,
            event_name="schedule",
            event={},
            github=github,
            collect=collect,
        )
        assert result == ([TASK] if discovery == "unique" else [])
        if discovery == "unique":
            assert json.loads((out / f"{TASK}.json").read_text())["backfilled"] is True
            assert len(calls) == 2, "discovery is followed by independent PR detail validation"
        else:
            assert len(calls) == 1 and not out.exists()


@pytest.mark.parametrize("kind", ["nonrecord", "schema", "wrong_identity", "state_conflict"])
def test_existing_store_is_validated_before_skipping_a_record(publisher, tmp_path, kind):
    root, out, existing = tmp_path / "tools", tmp_path / "batch", tmp_path / "store"
    state(root, pr=99 if kind == "state_conflict" else 17)
    batch_record(existing / "records", record())
    if kind == "nonrecord":
        (existing / "run.py").write_text("raise RuntimeError('must never run')")
    elif kind == "schema":
        batch_record(existing / "records", record(schema=99))
    elif kind == "wrong_identity":
        (existing / "records/UNIT-001.json").write_text(json.dumps(record("OTHER-001")))
    with pytest.raises(publisher.PublishError):
        publisher.collect_batch(
            root,
            out,
            repo=REPO,
            event_name="schedule",
            event={},
            existing_root=existing,
            github=lambda *a: pytest.fail("invalid store queried GitHub"),
            collect=lambda *a, **k: pytest.fail("invalid store collected a unit"),
        )
    assert not out.exists()


def test_later_source_failure_exposes_no_partial_publishable_batch(publisher, tmp_path):
    root, out = tmp_path / "tools", tmp_path / "batch"
    state(root)
    state(root, "UNIT-002", 18)
    github, collect, _ = sources(root)

    def fail_later(endpoint):
        if endpoint.endswith("/18"):
            raise RuntimeError("PRIVATE_SOURCE_ERROR")
        return github(endpoint)

    with pytest.raises(publisher.PublishError) as error:
        publisher.collect_batch(
            root,
            out,
            repo=REPO,
            event_name="schedule",
            event={},
            github=fail_later,
            collect=collect,
        )
    assert "PRIVATE_SOURCE_ERROR" not in str(error.value)
    assert not out.exists()


def test_default_collector_fetches_pr_objects_then_executes_only_trusted_isolated_cli(
    publisher, tmp_path, monkeypatch
):
    root, out = tmp_path / "tools-data", tmp_path / "batch"
    state(root)
    calls = []

    def run(arguments, **kwargs):
        calls.append((list(arguments), kwargs))
        if "agentctl.py" in " ".join(map(str, arguments)):
            destination = Path(arguments[arguments.index("--out") + 1])
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(record()), encoding="utf-8")
        return subprocess.CompletedProcess(arguments, 0, stdout="", stderr="")

    # Patching the module's subprocess seam prevents every real Git/network call.
    monkeypatch.setattr(publisher.subprocess, "run", run)
    assert publisher.collect_batch(
        root,
        out,
        repo=REPO,
        event_name="pull_request_target",
        event=event(),
        github=lambda endpoint: pull(),
    ) == [TASK]
    fetches = [(i, args) for i, (args, _) in enumerate(calls) if "fetch" in args]
    assert len(fetches) == 1
    assert any("refs/pull/17/head" in str(arg) for arg in fetches[0][1])
    invocations = [
        (i, args, kw)
        for i, (args, kw) in enumerate(calls)
        if "agentctl.py" in " ".join(map(str, args))
    ]
    assert len(invocations) == 1
    at, arguments, kwargs = invocations[0]
    assert fetches[0][0] < at
    assert "-I" in arguments
    assert str(ROOT / ".ai/bin/agentctl.py") in [str(arg) for arg in arguments]
    assert arguments[arguments.index("metrics") + 1 : arguments.index("metrics") + 3] == [
        "collect",
        TASK,
    ]
    assert arguments[arguments.index("--pr") + 1] == "17"
    assert Path(kwargs["env"]["AGENTCTL_DATA_ROOT"]) == root
    assert all("checkout" not in args and "switch" not in args for args, _ in calls)


@pytest.mark.parametrize("changes", [{"task_id": "OTHER-001"}, {"pr": 99}, {"schema": 1}])
def test_collector_output_identity_and_schema_are_validated_before_batch_exposure(
    publisher, tmp_path, changes
):
    root, out = tmp_path / "tools", tmp_path / "batch"
    state(root)
    github, _, _ = sources(root)

    def collector(*args, out, **kwargs):
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(json.dumps(record(**changes)), encoding="utf-8")

    with pytest.raises(publisher.PublishError):
        publisher.collect_batch(
            root,
            out,
            repo=REPO,
            event_name="pull_request_target",
            event=event(),
            github=github,
            collect=collector,
        )
    assert not out.exists()


@pytest.fixture
def remote(tmp_path):
    bare = tmp_path / "remote.git"
    bare.mkdir()
    git(bare, "init", "--bare", "-q")
    seed = tmp_path / "seed"
    seed.mkdir()
    git(seed, "init", "-q", "--initial-branch=main")
    git(seed, "config", "user.name", "Fixture")
    git(seed, "config", "user.email", "fixture@example.test")
    (seed / "main.txt").write_text("main must remain untouched\n")
    git(seed, "add", "main.txt")
    git(seed, "commit", "-qm", "main")
    git(seed, "remote", "add", "origin", str(bare))
    git(seed, "push", "-q", "origin", "main")
    return bare, git(bare, "rev-parse", "refs/heads/main")


def test_bootstrap_append_and_idempotence_touch_only_metrics(publisher, remote, tmp_path):
    bare, main = remote
    first, batch = tmp_path / "first", tmp_path / "batch"
    publisher.prepare_store(first, str(bare))
    assert git(first, "symbolic-ref", "--short", "HEAD") == "metrics"
    batch_record(batch, record())
    assert publisher.publish(first, batch) == [TASK]
    metrics_tip = git(bare, "rev-parse", "refs/heads/metrics")
    assert git(bare, "ls-tree", "-r", "--name-only", "metrics") == f"records/{TASK}.json"
    assert git(bare, "rev-parse", "refs/heads/main") == main
    (batch / f"{TASK}.json").write_text(json.dumps(record(), sort_keys=True, indent=4))
    assert publisher.publish(first, batch) == []
    assert git(bare, "rev-parse", "refs/heads/metrics") == metrics_tip
    second, newer = tmp_path / "second", tmp_path / "newer"
    publisher.prepare_store(second, str(bare))
    batch_record(newer, record("UNIT-002", 18))
    assert publisher.publish(second, newer) == ["UNIT-002"]
    assert git(bare, "ls-tree", "-r", "--name-only", "metrics").splitlines() == [
        "records/UNIT-001.json",
        "records/UNIT-002.json",
    ]
    assert git(bare, "rev-parse", "refs/heads/main") == main


def test_divergent_record_refuses_overwrite_and_leaves_remote_unchanged(
    publisher, remote, tmp_path
):
    bare, _ = remote
    data, batch = tmp_path / "store", tmp_path / "batch"
    publisher.prepare_store(data, str(bare))
    batch_record(batch, record())
    publisher.publish(data, batch)
    before = git(bare, "rev-parse", "metrics")
    batch_record(batch, record(commits=999))
    with pytest.raises(publisher.PublishError):
        publisher.publish(data, batch)
    assert git(bare, "rev-parse", "metrics") == before
    assert json.loads((data / "records/UNIT-001.json").read_text())["commits"] == 2


@pytest.mark.parametrize(
    "kind", ["wrong_branch", "dirty", "nonrecord", "bad_filename", "bad_schema"]
)
def test_invalid_store_or_artifact_never_reaches_push(publisher, remote, tmp_path, kind):
    bare, main = remote
    data, batch = tmp_path / "store", tmp_path / "batch"
    publisher.prepare_store(data, str(bare))
    batch_record(batch, record())
    publisher.publish(data, batch)
    before = git(bare, "rev-parse", "metrics")
    if kind == "wrong_branch":
        git(data, "switch", "-qc", "main")
    elif kind == "dirty":
        (data / "untracked.txt").write_text("dirty")
    elif kind == "nonrecord":
        (data / "script.py").write_text("raise RuntimeError('must never execute')")
        git(data, "add", "script.py")
        git(
            data,
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "commit",
            "-qm",
            "bad tree",
        )
    elif kind == "bad_filename":
        (batch / "UNIT-001.json").rename(batch / "OTHER-001.json")
    else:
        batch_record(batch, record(schema=99))
    with pytest.raises(publisher.PublishError):
        publisher.publish(data, batch)
    assert git(bare, "rev-parse", "metrics") == before
    assert git(bare, "rev-parse", "main") == main


def test_symlink_artifact_is_never_followed(publisher, remote, tmp_path):
    bare, _ = remote
    data, batch = tmp_path / "store", tmp_path / "batch"
    publisher.prepare_store(data, str(bare))
    batch.mkdir()
    private = tmp_path / "outside.json"
    private.write_text(json.dumps(record()))
    try:
        (batch / "UNIT-001.json").symlink_to(private)
    except OSError:
        pytest.skip("host cannot create symlinks; CI covers the boundary")
    with pytest.raises(publisher.PublishError):
        publisher.publish(data, batch)
    assert git(bare, "show-ref", "--verify", "refs/heads/metrics", check=False) == ""


@pytest.mark.parametrize(
    "changes",
    [
        {"task_id": "../../escape"},
        {"pr": True},
        {"pr": 0},
        {"schema": True},
        {"mode": "director"},
        {"commits": -1},
        {"wall_time_seconds": "3600"},
        {"cost_usd": float("nan")},
        {"transcript": "PRIVATE_TRANSCRIPT_CONTENT"},
    ],
)
def test_invalid_record_data_never_creates_a_remote_branch(publisher, remote, tmp_path, changes):
    bare, main = remote
    data, batch = tmp_path / "store", tmp_path / "batch"
    publisher.prepare_store(data, str(bare))
    batch.mkdir()
    (batch / "UNIT-001.json").write_text(json.dumps(record(**changes)))
    with pytest.raises(publisher.PublishError) as error:
        publisher.publish(data, batch)
    assert "PRIVATE_" not in str(error.value)
    assert git(bare, "show-ref", "--verify", "refs/heads/metrics", check=False) == ""
    assert git(bare, "rev-parse", "main") == main


def test_prepare_refuses_a_nonempty_directory_instead_of_replacing_its_work(
    publisher, remote, tmp_path
):
    bare, _ = remote
    data = tmp_path / "existing"
    data.mkdir()
    marker = data / "keep.txt"
    marker.write_text("existing work")
    with pytest.raises(publisher.PublishError):
        publisher.prepare_store(data, str(bare))
    assert marker.read_text() == "existing work"


def test_store_hooks_and_inherited_git_environment_cannot_run_or_redirect_writes(
    publisher, remote, tmp_path, monkeypatch
):
    bare, main = remote
    data, batch, marker = tmp_path / "store", tmp_path / "batch", tmp_path / "hook-ran"
    publisher.prepare_store(data, str(bare))
    hook = data / ".git/hooks/pre-commit"
    hook.write_text(f'#!/bin/sh\nprintf unsafe > "{marker.as_posix()}"\nexit 1\n')
    hook.chmod(0o755)
    batch_record(batch, record())
    poison = tmp_path / "poison.git"
    poison.mkdir()
    git(poison, "init", "--bare", "-q")
    monkeypatch.setenv("GIT_DIR", str(poison))
    monkeypatch.setenv("GIT_WORK_TREE", str(tmp_path / "poison-work"))
    monkeypatch.setenv("GIT_TEST_PRIVATE_SENTINEL", "do-not-inherit")
    assert publisher.publish(data, batch) == [TASK]
    assert not marker.exists()
    assert git(bare, "rev-parse", "main") == main
    assert git(poison, "show-ref", check=False) == ""


def test_push_auth_is_transient_and_raw_tokens_reach_no_git_child(
    publisher, remote, tmp_path, monkeypatch, capsys
):
    bare, _ = remote
    data, batch = tmp_path / "store", tmp_path / "batch"
    publisher.prepare_store(data, str(bare))
    batch_record(batch, record())
    token = "PRIVATE_DUMMY_PUSH_TOKEN"
    encoded = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    for key in ("METRICS_PUSH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        monkeypatch.setenv(key, token)
    monkeypatch.setenv("GIT_TEST_PRIVATE_SENTINEL", "do-not-inherit")
    real_run, calls = publisher.subprocess.run, []

    def spy(arguments, **kwargs):
        calls.append((list(arguments), dict(kwargs.get("env", {}))))
        return real_run(arguments, **kwargs)

    monkeypatch.setattr(publisher.subprocess, "run", spy)
    assert publisher.publish(data, batch, token=token) == [TASK]
    pushes = []
    for arguments, environment in calls:
        assert token not in str(arguments) and encoded not in str(arguments)
        assert not {
            "METRICS_PUSH_TOKEN",
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "GIT_TEST_PRIVATE_SENTINEL",
        } & set(environment)
        auth = [
            value
            for key, value in environment.items()
            if key.startswith("GIT_CONFIG_VALUE_") and encoded in value
        ]
        if "push" in arguments:
            pushes.append(arguments)
            assert auth, "the push alone receives transient authentication config"
        else:
            assert not auth
    assert len(pushes) == 1
    config = (data / ".git/config").read_text(encoding="utf-8")
    assert token not in config and encoded not in config
    emitted = capsys.readouterr()
    assert token not in emitted.out + emitted.err


def test_stale_writer_cannot_force_away_another_publishers_record(publisher, remote, tmp_path):
    bare, main = remote
    seed, seed_batch = tmp_path / "store", tmp_path / "seed-batch"
    publisher.prepare_store(seed, str(bare))
    batch_record(seed_batch, record())
    publisher.publish(seed, seed_batch)
    stale = tmp_path / "stale"
    publisher.prepare_store(stale, str(bare))
    latest_batch, stale_batch = tmp_path / "latest", tmp_path / "stale-batch"
    batch_record(latest_batch, record("UNIT-002", 18))
    publisher.publish(seed, latest_batch)
    before = git(bare, "rev-parse", "metrics")
    batch_record(stale_batch, record("UNIT-003", 19))
    with pytest.raises(publisher.PublishError):
        publisher.publish(stale, stale_batch)
    assert git(bare, "rev-parse", "metrics") == before
    assert git(bare, "rev-parse", "main") == main


def test_cli_prepare_then_publish_creates_only_metrics_data(remote, tmp_path):
    bare, main = remote
    data, batch = tmp_path / "cli-store", tmp_path / "cli-batch"
    prepared = cli("prepare", "--data-root", data, "--remote", bare, cwd=tmp_path)
    assert prepared.returncode == 0, prepared.stderr
    batch_record(batch, record())
    published = cli("publish", "--data-root", data, "--records-dir", batch, cwd=tmp_path)
    assert published.returncode == 0, published.stderr
    assert git(bare, "ls-tree", "-r", "--name-only", "metrics") == f"records/{TASK}.json"
    assert json.loads(git(bare, "show", f"metrics:records/{TASK}.json")) == record()
    assert git(bare, "rev-parse", "main") == main
    assert "Traceback" not in prepared.stderr + published.stderr


def test_cli_ineligible_event_needs_no_sources_and_emits_empty_batch_output(tmp_path):
    root, out, output = tmp_path / "source", tmp_path / "batch", tmp_path / "github-output"
    state(root)
    source = root / ".ai/tasks" / TASK / "state.json"
    before = source.read_bytes()
    payload = event(pull(merged=False, state="open"))
    payload["action"] = "opened"
    event_path = tmp_path / "event.json"
    event_path.write_text(json.dumps(payload), encoding="utf-8")
    result = cli(
        "collect",
        "--root",
        root,
        "--out-dir",
        out,
        "--repo",
        REPO,
        "--event-name",
        "pull_request_target",
        "--event-path",
        event_path,
        output=output,
        cwd=tmp_path,
        no_tools=True,
    )
    assert result.returncode == 0, result.stderr
    assert "has_records=false" in output.read_text(encoding="utf-8").splitlines()
    assert source.read_bytes() == before
    assert not out.exists()
    assert "Traceback" not in result.stderr


def test_cli_invalid_event_evidence_fails_without_traceback_or_source_leak(tmp_path):
    root, out = tmp_path / "source", tmp_path / "batch"
    state(root)
    source = root / ".ai/tasks" / TASK / "state.json"
    before = source.read_bytes()
    private_path = tmp_path / "PRIVATE_EVENT_PATH.json"
    private_path.write_text("{PRIVATE_EVENT_CONTENT", encoding="utf-8")
    result = cli(
        "collect",
        "--root",
        root,
        "--out-dir",
        out,
        "--repo",
        REPO,
        "--event-name",
        "pull_request_target",
        "--event-path",
        private_path,
        cwd=tmp_path,
        no_tools=True,
    )
    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "PRIVATE_" not in result.stdout + result.stderr
    assert str(private_path) not in result.stdout + result.stderr
    assert source.read_bytes() == before and not out.exists()
