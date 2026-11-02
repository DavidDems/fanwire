"""Bounded failure evidence crosses trusted CLI boundaries without source text.

Every external command is replaced by an offline response. These checks exercise
the real parsers, error handlers and default isolated collector adapter; they do
not contact GitHub, create commits, publish data or modify production task state.
The shared conftest autouse fixture strips GIT_* before every test, and the
subprocess environment helper below independently strips them as well.
"""

import contextlib
import io
import json
import os
import runpy
import subprocess
import sys
from pathlib import Path

import pytest
from test_metricspublish import event, pull, record, state

from agentlib import metrics, metricspublish

ROOT = Path(__file__).resolve().parents[2]
AGENTCTL = ROOT / ".ai/bin/agentctl.py"
PUBLISHER = ROOT / ".ai/bin/metrics_publish.py"
TASK = "UNIT-001"
REPO = "owner/repo"
SECRET = "PRIVATE_TOKEN_9d2 https://secret.example/path?token=PRIVATE_TOKEN_9d2"


def environment(**changes):
    return {
        **{key: value for key, value in os.environ.items() if not key.startswith("GIT_")},
        **changes,
    }


def invoke(path, arguments, monkeypatch, *, data_root=None):
    """Run the real CLI handler with captured child-style stdout and stderr."""
    if data_root is not None:
        monkeypatch.setenv("AGENTCTL_DATA_ROOT", str(data_root))
    monkeypatch.setattr(sys, "argv", [str(path), *map(str, arguments)])
    stdout, stderr = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            code = runpy.run_path(str(path))["main"]()
        except SystemExit as exc:
            code = exc.code
    return subprocess.CompletedProcess(arguments, code, stdout.getvalue(), stderr.getvalue())


def diagnostic(result):
    assert result.returncode != 0
    assert SECRET not in result.stdout + result.stderr
    assert "secret.example" not in result.stdout + result.stderr
    lines = [line for line in result.stderr.splitlines() if line.startswith("{")]
    assert len(lines) == 1, "failure must carry exactly one bounded diagnostic envelope"
    envelope = json.loads(lines[0])
    assert set(envelope) == {"metrics_error"}
    return envelope["metrics_error"]


def expected(*, source="publisher", stage="pr-detail", tool="gh", category="http", **extra):
    return {
        "stage": stage,
        "task_id": TASK,
        "pr": 17,
        "source": source,
        "tool": tool,
        "category": category,
        **extra,
    }


def collect_arguments(root, out, payload, tmp_path):
    event_path = tmp_path / "event.json"
    event_path.write_text(json.dumps(payload), encoding="utf-8")
    return [
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
    ]


@pytest.mark.parametrize(
    ("raw", "category", "status"),
    [
        (f"gh: request failed (HTTP 502) {SECRET}", "http", 502),
        (f"gh: HTTP 401 {SECRET}", "authentication", 401),
        (f"dial tcp: lookup api.github.com: no such host {SECRET}", "dns", None),
        (f"tls: failed to verify certificate: x509: unknown authority {SECRET}", "tls", None),
        (f"context deadline exceeded (Client.Timeout exceeded) {SECRET}", "timeout", None),
        (f"read tcp: connection reset by peer {SECRET}", "transport", None),
        (f"write: broken pipe {SECRET}", "pipe", None),
        (SECRET, "other", None),
    ],
    ids=["http", "authentication", "dns", "tls", "timeout", "transport", "pipe", "other"],
)
def test_outer_gh_failure_has_candidate_and_safe_category(
    tmp_path, monkeypatch, raw, category, status
):
    root, out = tmp_path / "data", tmp_path / "batch"
    state(root)
    before = (root / ".ai/tasks" / TASK / "state.json").read_bytes()
    output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    calls = []

    def run(arguments, **kwargs):
        calls.append(arguments)
        assert arguments[0] == "gh"
        assert not any(key.startswith("GIT_") for key in kwargs["env"])
        return subprocess.CompletedProcess(arguments, 1, SECRET, raw)

    monkeypatch.setattr(subprocess, "run", run)
    result = invoke(PUBLISHER, collect_arguments(root, out, event(), tmp_path), monkeypatch)
    extra = {"exit_code": 1}
    if status is not None:
        extra["http_status"] = status
    assert diagnostic(result) == expected(category=category, **extra)
    assert len(calls) == 1, "a failed source is not retried"
    assert not out.exists() and not output.exists()
    assert (root / ".ai/tasks" / TASK / "state.json").read_bytes() == before


def test_real_collector_cli_failure_survives_default_isolated_adapter(tmp_path, monkeypatch):
    root, out = tmp_path / "data", tmp_path / "batch"
    state(root)
    commands = []

    def run(arguments, **kwargs):
        arguments = list(map(str, arguments))
        commands.append(arguments)
        if arguments[0] == "git":
            assert "fetch" in arguments
            return subprocess.CompletedProcess(arguments, 0, "", "")
        if arguments[0] == "gh":
            if len([cmd for cmd in commands if cmd[0] == "gh"]) == 1:
                return subprocess.CompletedProcess(arguments, 0, json.dumps([pull()]), "")
            return subprocess.CompletedProcess(arguments, 1, SECRET, f"HTTP 503 {SECRET}")
        assert arguments[:3] == [sys.executable, "-I", str(AGENTCTL)]
        assert "--diagnostic-json" in arguments
        assert kwargs["env"]["AGENTCTL_DATA_ROOT"] == str(root)
        assert not any(key.startswith("GIT_") for key in kwargs["env"])
        with monkeypatch.context() as child_patch:
            return invoke(AGENTCTL, arguments[3:], child_patch, data_root=root)

    monkeypatch.setattr(subprocess, "run", run)
    result = invoke(PUBLISHER, collect_arguments(root, out, event(), tmp_path), monkeypatch)
    assert diagnostic(result) == expected(source="metrics", http_status=503, exit_code=1)
    assert sum(cmd[0] == sys.executable for cmd in commands) == 1
    assert not out.exists()


@pytest.mark.parametrize(
    "body",
    [
        SECRET,
        json.dumps({"metrics_error": expected(source="metrics"), "stderr": SECRET}),
        json.dumps({"metrics_error": expected(source="metrics", message=SECRET)}),
        json.dumps({"metrics_error": expected(source="metrics", stage=SECRET)}),
        json.dumps({"metrics_error": expected(source=SECRET)}),
        json.dumps({"metrics_error": expected(source="metrics", tool=SECRET)}),
        json.dumps({"metrics_error": expected(source="metrics", category=SECRET)}),
        json.dumps({"metrics_error": expected(source="metrics", task_id="UNIT-999")}),
        json.dumps({"metrics_error": expected(source="metrics", pr=999)}),
        json.dumps({"metrics_error": expected(source="metrics", pr=True)}),
        json.dumps({"metrics_error": expected(source="metrics", http_status=999)}),
        json.dumps({"metrics_error": expected(source="metrics", http_status=True)}),
        json.dumps({"metrics_error": expected(source="metrics", exit_code=999999999)}),
        json.dumps({"metrics_error": expected(source="metrics", exit_code=True)}),
        json.dumps({"metrics_error": expected(source="metrics")}) + "\n" + SECRET,
        json.dumps({"metrics_error": expected(source="metrics")})
        + "\n"
        + json.dumps({"metrics_error": expected(source="metrics")}),
        '{"metrics_error":'
        + json.dumps(expected(source="metrics"))
        + ',"metrics_error":'
        + json.dumps(expected(source="metrics"))
        + "}",
    ],
    ids=[
        "raw",
        "extra-envelope-field",
        "extra-detail-field",
        "stage",
        "source",
        "tool",
        "category",
        "task-mismatch",
        "pr-mismatch",
        "boolean-pr",
        "http-range",
        "boolean-http",
        "exit-range",
        "boolean-exit",
        "trailing-raw",
        "multiple-records",
        "duplicate-key",
    ],
)
def test_untrusted_child_failure_record_degrades_to_safe_fallback(tmp_path, monkeypatch, body):
    root, out = tmp_path / "data", tmp_path / "batch"
    state(root)

    def run(arguments, **kwargs):
        if str(arguments[0]) == sys.executable:
            return subprocess.CompletedProcess(arguments, 1, SECRET, body)
        return subprocess.CompletedProcess(arguments, 0, "", "")

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(metricspublish.PublishError) as error:
        metricspublish.collect_batch(
            root,
            out,
            repo=REPO,
            event_name="pull_request_target",
            event=event(),
            github=lambda _: pull(),
        )
    assert error.value.diagnostic == expected(
        stage="collector", tool="python", category="other", exit_code=1
    )
    assert SECRET not in str(error.value)
    assert not out.exists()


def test_later_failure_keeps_candidate_identity_and_no_publishable_output(tmp_path, monkeypatch):
    root, out = tmp_path / "data", tmp_path / "batch"
    state(root)
    state(root, "UNIT-002", 18)
    output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    collected = []

    def github(_, endpoint):
        if endpoint.endswith("/18"):
            raise RuntimeError(SECRET)
        return pull()

    def collect(_, task, *, out, **kwargs):
        collected.append(task)
        Path(out).write_text(json.dumps(record(backfilled=True)), encoding="utf-8")

    monkeypatch.setattr(metricspublish, "_github", github)
    monkeypatch.setattr(metricspublish, "_collect", collect)
    args = collect_arguments(root, out, {}, tmp_path)
    args[args.index("pull_request_target")] = "schedule"
    result = invoke(PUBLISHER, args, monkeypatch)
    assert diagnostic(result) == {
        **expected(category="other"),
        "task_id": "UNIT-002",
        "pr": 18,
    }
    assert collected == [TASK]
    assert not out.exists() and not output.exists()
    assert not list(tmp_path.glob("metrics-stage-*"))


def test_collector_opt_in_diagnostic_does_not_replace_existing_artifact(tmp_path, monkeypatch):
    root = tmp_path / "data"
    root.mkdir()
    artifact = tmp_path / "existing.json"
    artifact.write_text("previous complete artifact", encoding="utf-8")

    def run(arguments, **kwargs):
        assert arguments[0] == "gh"
        return subprocess.CompletedProcess(arguments, 1, SECRET, f"HTTP 429 {SECRET}")

    monkeypatch.setattr(subprocess, "run", run)
    result = invoke(
        AGENTCTL,
        [
            "metrics",
            "collect",
            TASK,
            "--pr",
            "17",
            "--repo",
            REPO,
            "--out",
            str(artifact),
            "--diagnostic-json",
        ],
        monkeypatch,
        data_root=root,
    )
    assert diagnostic(result) == expected(source="metrics", http_status=429, exit_code=1)
    assert artifact.read_text() == "previous complete artifact"
    assert result.stdout == ""


def test_success_output_is_unchanged_by_diagnostic_opt_in(tmp_path, monkeypatch):
    monkeypatch.setattr(metrics, "collect", lambda *args, **kwargs: record())
    results = []
    for flag in ([], ["--diagnostic-json"]):
        results.append(
            invoke(
                AGENTCTL,
                ["metrics", "collect", TASK, "--pr", "17", "--repo", REPO, *flag],
                monkeypatch,
                data_root=tmp_path,
            )
        )
    assert [result.returncode for result in results] == [0, 0]
    assert results[0].stdout == results[1].stdout
    assert json.loads(results[0].stdout) == record()
    assert results[0].stderr == results[1].stderr == ""


def test_diagnostic_cannot_be_replaced_by_secret_bearing_exception_data(tmp_path, monkeypatch):
    def failed(*args, **kwargs):
        error = metrics.MetricsError(SECRET)
        try:
            error.diagnostic = expected(stage=SECRET, category=SECRET)
        except AttributeError:
            pass  # Immutable error metadata is also acceptable.
        raise error

    monkeypatch.setattr(metrics, "collect", failed)
    result = invoke(
        AGENTCTL,
        ["metrics", "collect", TASK, "--pr", "17", "--repo", REPO, "--diagnostic-json"],
        monkeypatch,
        data_root=tmp_path,
    )
    assert diagnostic(result) == expected(
        source="metrics", stage="other", tool="none", category="other"
    )


def test_real_isolated_parser_accepts_option_without_importing_data_root_code(tmp_path):
    # A subprocess here pins isolated startup and argument parsing independently
    # of the in-process offline source adapters used by the other checks.
    (tmp_path / "agentlib.py").write_text(f"raise RuntimeError({SECRET!r})", encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-I", str(AGENTCTL), "metrics", "collect", "--help"],
        cwd=tmp_path,
        env=environment(),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "--diagnostic-json" in result.stdout
    assert SECRET not in result.stdout + result.stderr


@pytest.mark.parametrize("failure", ["pr-identity", "artifact-identity"])
def test_later_candidate_validation_keeps_identity_without_exposing_partial_batch(
    tmp_path, monkeypatch, failure
):
    root, out = tmp_path / "data", tmp_path / "batch"
    state(root)
    state(root, "UNIT-002", 18)
    output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    collected = []

    def run(arguments, **kwargs):
        arguments = list(map(str, arguments))
        assert not any(key.startswith("GIT_") for key in kwargs["env"])
        if arguments[0] == "gh":
            number = int(arguments[-1].rsplit("/", 1)[1])
            detail = pull(TASK if number == 17 else "UNIT-002", number)
            if number == 18 and failure == "pr-identity":
                detail["head"]["ref"] = "agent/UNIT-999"
            return subprocess.CompletedProcess(arguments, 0, json.dumps([detail]), "")
        if arguments[0] == "git":
            assert "fetch" in arguments
            return subprocess.CompletedProcess(arguments, 0, "", "")
        assert arguments[:3] == [sys.executable, "-I", str(AGENTCTL)]
        task = arguments[5]
        number = int(arguments[arguments.index("--pr") + 1])
        destination = Path(arguments[arguments.index("--out") + 1])
        value = record(task, 999 if number == 18 else number, backfilled=True)
        destination.write_text(json.dumps(value), encoding="utf-8")
        collected.append(task)
        return subprocess.CompletedProcess(arguments, 0, "", "")

    monkeypatch.setattr(subprocess, "run", run)
    args = collect_arguments(root, out, {}, tmp_path)
    args[args.index("pull_request_target")] = "schedule"
    result = invoke(PUBLISHER, args, monkeypatch)
    assert diagnostic(result) == expected(
        task_id="UNIT-002",
        pr=18,
        category="other",
        stage="pr-detail" if failure == "pr-identity" else "collector",
        tool="gh" if failure == "pr-identity" else "python",
    )
    assert collected == ([TASK] if failure == "pr-identity" else [TASK, "UNIT-002"])
    assert not out.exists() and not output.exists()
    assert not list(tmp_path.glob("metrics-stage-*"))


@pytest.mark.parametrize("explicit_pr", [False, True], ids=["recorded-pr", "explicit-pr"])
def test_standalone_git_failure_retains_resolved_pr(tmp_path, monkeypatch, explicit_pr):
    root, artifact = tmp_path / "data", tmp_path / "record.json"
    state(root, history=[])
    sha = "a" * 40
    commands = []

    def run(arguments, **kwargs):
        commands.append(arguments)
        assert not any(key.startswith("GIT_") for key in kwargs["env"])
        if arguments[0] == "gh":
            if "/commits?" in arguments[-1]:
                response = [[{"sha": sha}]]
            else:
                response = [pull(created_at="2026-10-01T10:00:00Z")]
            return subprocess.CompletedProcess(arguments, 0, json.dumps(response), "")
        assert arguments[0] == "git"
        if "rev-list" in arguments:
            return subprocess.CompletedProcess(arguments, 0, sha + "\n", "")
        assert "show" in arguments and "--numstat" in arguments
        return subprocess.CompletedProcess(arguments, 128, SECRET, f"connection reset {SECRET}")

    monkeypatch.setattr(subprocess, "run", run)
    args = [
        "metrics",
        "collect",
        TASK,
        "--repo",
        REPO,
        "--out",
        str(artifact),
        "--diagnostic-json",
    ]
    if explicit_pr:
        args.extend(["--pr", "17"])
    result = invoke(AGENTCTL, args, monkeypatch, data_root=root)
    assert diagnostic(result) == expected(
        source="metrics",
        stage="other",
        tool="git",
        category="transport",
        exit_code=128,
    )
    assert sum("--numstat" in command for command in commands) == 1
    assert not artifact.exists() and result.stdout == ""


def test_publisher_fetch_failure_retains_git_classification(tmp_path, monkeypatch):
    root, out = tmp_path / "data", tmp_path / "batch"
    state(root)
    commands = []

    def run(arguments, **kwargs):
        commands.append(arguments)
        if arguments[0] == "gh":
            return subprocess.CompletedProcess(arguments, 0, json.dumps([pull()]), "")
        assert arguments[0] == "git" and "fetch" in arguments
        return subprocess.CompletedProcess(arguments, 128, SECRET, f"connection reset {SECRET}")

    monkeypatch.setattr(subprocess, "run", run)
    result = invoke(PUBLISHER, collect_arguments(root, out, event(), tmp_path), monkeypatch)
    assert diagnostic(result) == expected(
        stage="collector",
        tool="git",
        category="transport",
        exit_code=128,
    )
    assert len(commands) == 2 and not out.exists()


def test_python_child_launch_failure_identifies_python_and_candidate(tmp_path, monkeypatch):
    root, out = tmp_path / "data", tmp_path / "batch"
    state(root)
    commands = []

    def run(arguments, **kwargs):
        commands.append(arguments)
        if arguments[0] == "gh":
            return subprocess.CompletedProcess(arguments, 0, json.dumps([pull()]), "")
        if arguments[0] == "git":
            assert "fetch" in arguments
            return subprocess.CompletedProcess(arguments, 0, "", "")
        assert list(map(str, arguments[:3])) == [sys.executable, "-I", str(AGENTCTL)]
        raise OSError(SECRET)

    monkeypatch.setattr(subprocess, "run", run)
    result = invoke(PUBLISHER, collect_arguments(root, out, event(), tmp_path), monkeypatch)
    assert diagnostic(result) == expected(stage="collector", tool="python", category="other")
    assert len(commands) == 3 and not out.exists()
