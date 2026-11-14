"""CUT-11: the cutover snapshot (Prompts/25, `Architecture/repo-cutover.md`).

`cutover_snapshot.py` turns one commit of this repository into the tree the
new public repository starts from. It exports the tree without its history,
keeps `.ai/tasks/<ID>/` only for a task not in a terminal state, drops
`.ai/telemetry/runs/`, and rewrites every reference that would otherwise
point into the new repository's empty history: `archive-refs` (`#N`, commit
hashes, pull/issue/commit/compare URLs), plus the links it leaves alone by
design (`blob/<sha>`, `tree/<sha>`, `actions/runs/`) and Markdown citations of
a task folder the snapshot dropped.

It fails closed: a non-empty target, a dirty source, a ref that is not the SHA
recorded at the freeze, or a task state it cannot classify stops it before
anything is written.

Every fixture is a throwaway repository; no test names a real commit.
"""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from agentlib import state as st

AI_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = AI_ROOT / "bin" / "cutover_snapshot.py"
OLD = "https://github.com/DavidDems/fanwire"
NEW = "https://github.com/DavidDems/fanwire-archive"


def load():
    spec = importlib.util.spec_from_file_location("cutover_snapshot", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["cutover_snapshot"] = module
    spec.loader.exec_module(module)
    return module


def git(root, *args):
    return subprocess.run(
        ["git", *args],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
    ).stdout.strip()


def put(root, path, body):
    p = Path(root) / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(body.encode("utf-8") if isinstance(body, str) else body)
    return p


def task(root, task_id, state=None, raw=None):
    put(root, f".ai/tasks/{task_id}/task.json", json.dumps({"id": task_id}) + "\n")
    put(root, f".ai/tasks/{task_id}/brief.md", f"# {task_id}\n")
    if raw is not None:
        put(root, f".ai/tasks/{task_id}/state.json", raw)
    elif state is not None:
        put(root, f".ai/tasks/{task_id}/state.json", json.dumps({"state": state}) + "\n")


TASKS = {
    "DONE-001": "COMPLETE",
    "GONE-002": "CANCELLED",
    "BROKE-003": "FAILED",
    "LIVE-004": "HAND_RUNNING",
    "STUCK-005": "ESCALATED",
    "DRAFT-006": "DRAFT",
    "SPEC-007": None,
}
DROPPED = {"DONE-001", "GONE-002", "BROKE-003"}
KEPT = set(TASKS) - DROPPED


@pytest.fixture
def source(tmp_path):
    root = tmp_path / "source"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "fixture@example.invalid")
    git(root, "config", "user.name", "Fixture")
    git(root, "config", "core.autocrlf", "false")
    put(root, "README.md", "first\n")
    git(root, "add", ".")
    git(root, "commit", "-q", "-m", "first")
    first = git(root, "rev-parse", "HEAD")
    for task_id, state in TASKS.items():
        task(root, task_id, state)
    put(root, ".ai/telemetry/README.md", "Telemetry lives here.\n")
    put(root, ".ai/telemetry/runs/DONE-001/1-code_agent-a1.json", "{}\n")
    put(root, ".ai/telemetry/runs/LIVE-004/1-code_agent-a1.json", "{}\n")
    # A copy of a finished task kept as test data is not a task.
    put(root, ".ai/tests/fixtures/old/.ai/tasks/X-1/state.json", '{"state": "COMPLETE"}\n')
    put(root, "backend/app/crlf.py", b"a = 1\r\nb = 2\r\n")
    put(
        root,
        "wiki/notes.md",
        "\n".join(
            [
                "---",
                "type: reference",
                "---",
                f"Merged in #12 at {first[:7]}.",
                f"[pinned]({OLD}/blob/{first}/README.md#top)",
                f"[folder]({OLD}/tree/{first[:7]}/wiki)",
                f"[live]({OLD}/blob/main/README.md)",
                f"[run]({OLD}/actions/runs/123)",
                f"[pr]({OLD}/pull/12)",
                'Spec: `.ai/tasks/DONE-001/brief.md` "Minimums".',
                "Folder: `.ai/tasks/GONE-002/`.",
                "Live: `.ai/tasks/LIVE-004/brief.md`.",
                "Linked: [done](../.ai/tasks/DONE-001/task.json#L1).",
                "Kept: [live](../.ai/tasks/LIVE-004/brief.md).",
                "Labelled: [`.ai/tasks/DONE-001/`](../.ai/tasks/DONE-001/).",
                "```",
                "#12 and `.ai/tasks/DONE-001/` stay inside a fence",
                "```",
                "",
            ]
        ),
    )
    git(root, "add", ".")
    git(root, "commit", "-q", "-m", "second")
    return {"root": root, "first": first, "sha": git(root, "rev-parse", "HEAD")}


@pytest.fixture
def snap(source, tmp_path):
    mod = load()
    target = tmp_path / "target"
    manifest = mod.snapshot(source["root"], "main", source["sha"], target)
    return {**source, "target": target, "manifest": manifest, "mod": mod}


def text(target, path):
    return (target / path).read_bytes().decode("utf-8")


class TestExport:
    def test_the_target_is_a_tree_without_history(self, snap):
        assert not (snap["target"] / ".git").exists()
        assert (snap["target"] / "README.md").read_text(encoding="utf-8") == "first\n"

    def test_untouched_files_are_the_committed_bytes(self, snap):
        blob = subprocess.run(
            ["git", "cat-file", "blob", f"{snap['sha']}:backend/app/crlf.py"],
            cwd=snap["root"],
            capture_output=True,
            check=True,
            env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
        ).stdout
        assert (snap["target"] / "backend/app/crlf.py").read_bytes() == blob

    def test_the_manifest_names_the_commit(self, snap):
        assert snap["manifest"].sha == snap["sha"]


class TestTasks:
    def test_the_terminal_states_are_the_state_machines(self, snap):
        assert snap["mod"].TERMINAL == st.TERMINAL

    def test_only_tasks_not_in_a_terminal_state_are_kept(self, snap):
        present = {p.name for p in (snap["target"] / ".ai/tasks").iterdir()}
        assert present == KEPT
        assert set(snap["manifest"].kept_tasks) == KEPT
        assert set(snap["manifest"].dropped_tasks) == DROPPED

    def test_a_spec_with_no_state_file_is_a_draft_and_is_kept(self, snap):
        assert (snap["target"] / ".ai/tasks/SPEC-007/task.json").is_file()

    def test_hand_running_and_escalated_tasks_keep_their_state(self, snap):
        for task_id in ("LIVE-004", "STUCK-005"):
            assert (snap["target"] / f".ai/tasks/{task_id}/state.json").is_file()

    def test_test_fixtures_are_data_not_tasks(self, snap):
        assert (snap["target"] / ".ai/tests/fixtures/old/.ai/tasks/X-1/state.json").is_file()


class TestTelemetry:
    def test_run_records_are_dropped_and_the_readme_kept(self, snap):
        assert not (snap["target"] / ".ai/telemetry/runs").exists()
        assert (snap["target"] / ".ai/telemetry/README.md").is_file()
        dropped = set(snap["manifest"].dropped_paths)
        assert ".ai/telemetry/runs/DONE-001/1-code_agent-a1.json" in dropped
        assert ".ai/telemetry/runs/LIVE-004/1-code_agent-a1.json" in dropped
        assert ".ai/tasks/DONE-001/state.json" in dropped


class TestRewrites:
    def test_archive_refs_ran_against_the_source_history(self, snap):
        body = text(snap["target"], "wiki/notes.md")
        assert f"Merged in fanwire-archive#12 at fanwire-archive@{snap['first'][:7]}." in body
        assert f"[pr]({NEW}/pull/12)" in body

    def test_pinned_blob_tree_and_run_links_point_to_the_archive(self, snap):
        body = text(snap["target"], "wiki/notes.md")
        assert f"[pinned]({NEW}/blob/{snap['first']}/README.md#top)" in body
        assert f"[folder]({NEW}/tree/{snap['first'][:7]}/wiki)" in body
        assert f"[run]({NEW}/actions/runs/123)" in body

    def test_a_branch_link_stays_in_the_new_repository(self, snap):
        assert f"[live]({OLD}/blob/main/README.md)" in text(snap["target"], "wiki/notes.md")

    def test_citations_of_dropped_tasks_link_to_the_archive_at_the_snapshot(self, snap):
        body = text(snap["target"], "wiki/notes.md")
        sha = snap["sha"]
        assert (
            f"[`.ai/tasks/DONE-001/brief.md`]({NEW}/blob/{sha}/.ai/tasks/DONE-001/brief.md)" in body
        )
        assert f"[`.ai/tasks/GONE-002/`]({NEW}/tree/{sha}/.ai/tasks/GONE-002/)" in body
        assert f"[done]({NEW}/blob/{sha}/.ai/tasks/DONE-001/task.json#L1)" in body
        assert f"[`.ai/tasks/DONE-001/`]({NEW}/tree/{sha}/.ai/tasks/DONE-001/)" in body

    def test_citations_of_kept_tasks_are_unchanged(self, snap):
        body = text(snap["target"], "wiki/notes.md")
        assert "Live: `.ai/tasks/LIVE-004/brief.md`." in body
        assert "Kept: [live](../.ai/tasks/LIVE-004/brief.md)." in body

    def test_fenced_text_is_unchanged(self, snap):
        assert "#12 and `.ai/tasks/DONE-001/` stay inside a fence" in text(
            snap["target"], "wiki/notes.md"
        )

    def test_the_manifest_counts_both_rewrites(self, snap):
        assert snap["manifest"].archive_refs >= 2
        assert snap["manifest"].archive_links >= 7


class TestFailsClosed:
    def refuses(self, source, tmp_path, *, ref="main", sha=None, target=None):
        mod = load()
        target = target or tmp_path / "target"
        with pytest.raises(mod.SnapshotError):
            mod.snapshot(source["root"], ref, sha or source["sha"], target)
        assert not target.exists() or not any(target.iterdir())

    def test_a_non_empty_target(self, source, tmp_path):
        target = tmp_path / "target"
        put(target, "keep.txt", "mine\n")
        mod = load()
        with pytest.raises(mod.SnapshotError):
            mod.snapshot(source["root"], "main", source["sha"], target)
        assert [p.name for p in target.iterdir()] == ["keep.txt"]

    def test_a_dirty_source(self, source, tmp_path):
        put(source["root"], "README.md", "edited\n")
        self.refuses(source, tmp_path)

    def test_an_untracked_file_in_the_source(self, source, tmp_path):
        put(source["root"], "stray.txt", "new\n")
        self.refuses(source, tmp_path)

    def test_a_ref_that_moved_since_the_freeze(self, source, tmp_path):
        self.refuses(source, tmp_path, sha=source["first"])

    def test_an_abbreviated_sha(self, source, tmp_path):
        self.refuses(source, tmp_path, sha=source["sha"][:12])

    def test_a_ref_that_does_not_exist(self, source, tmp_path):
        self.refuses(source, tmp_path, ref="no-such-branch")

    @pytest.mark.parametrize("raw", ['{"state": "WEDGED"}\n', "not json\n", '{"attempt": 1}\n'])
    def test_a_state_it_cannot_classify(self, source, tmp_path, raw):
        task(source["root"], "ODD-008", raw=raw)
        git(source["root"], "add", ".")
        git(source["root"], "commit", "-q", "-m", "odd")
        self.refuses({**source, "sha": git(source["root"], "rev-parse", "HEAD")}, tmp_path)


class TestCommandLine:
    def run(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True,
            text=True,
            check=False,
            env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")},
        )

    def test_prints_the_manifest(self, source, tmp_path):
        target = tmp_path / "target"
        result = self.run(
            "--repo",
            str(source["root"]),
            "--ref",
            "main",
            "--expect-sha",
            source["sha"],
            "--target",
            str(target),
        )
        assert result.returncode == 0, result.stderr
        out = result.stdout
        assert f"commit {source['sha']}" in out
        for task_id in KEPT:
            assert f"kept   .ai/tasks/{task_id}/" in out
        for task_id in DROPPED:
            assert f"dropped .ai/tasks/{task_id}/" in out
        assert "dropped .ai/telemetry/runs/DONE-001/1-code_agent-a1.json" in out
        assert "archive-refs:" in out and "archive links:" in out

    def test_json_manifest(self, source, tmp_path):
        result = self.run(
            "--repo",
            str(source["root"]),
            "--ref",
            "main",
            "--expect-sha",
            source["sha"],
            "--target",
            str(tmp_path / "t"),
            "--json",
        )
        assert result.returncode == 0, result.stderr
        data = json.loads(result.stdout)
        assert set(data["kept_tasks"]) == KEPT and data["sha"] == source["sha"]

    def test_a_refusal_is_a_non_zero_exit_with_a_reason(self, source, tmp_path):
        result = self.run(
            "--repo",
            str(source["root"]),
            "--ref",
            "main",
            "--expect-sha",
            source["first"],
            "--target",
            str(tmp_path / "t"),
        )
        assert result.returncode == 1
        assert "cutover snapshot:" in result.stderr
