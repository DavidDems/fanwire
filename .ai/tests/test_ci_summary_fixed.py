"""The CI summary says when the failure it describes is fixed.

On #161 the summary of a red `backend-mypy` run stayed on the PR after the
agent's fix went green: the summary job runs only on a failure, so nothing
ever touched the comment again, and a reader saw a failure that was gone.

When `test-agent` passes on an `agent/*` PR that already has the summary
comment, that comment gains one line under its marker naming the green
commit and run. The failure below it stays, as history. No model is called:
this half holds no key at all. A later red run rewrites the whole comment,
which removes the line.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from agentlib import cisummary

AI_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = AI_ROOT / "bin" / "ci_summary_fixed.py"

SHA = "03c44ac9b1e2d3f4a5b6c7d8e9f00112233445566"[:40]
RUN = "https://github.com/DavidDems/fanwire/actions/runs/38920820201"
BODY = (
    f"{cisummary.MARKER}\n"
    "### CI failed: 1 job (`backend-mypy`)\n"
    "\n"
    "- `app/posts/service.py:280` (`type_error`): ...\n"
    "\n"
    "**Likely cause:** a nullable key.\n"
)


class TestMarkingTheCommentFixed:
    def test_one_line_under_the_marker_names_the_commit_and_the_run(self):
        text = cisummary.mark_fixed(BODY, SHA, RUN)
        assert text.startswith(cisummary.MARKER + "\n")
        first = text.split("\n")[1]
        assert first.startswith("**Fixed:**")
        assert "`03c44ac`" in first and RUN in first
        # The failure stays below, as history.
        assert "### CI failed: 1 job (`backend-mypy`)" in text
        assert "**Likely cause:** a nullable key." in text

    def test_marking_again_replaces_the_line_never_stacks_it(self):
        once = cisummary.mark_fixed(BODY, SHA, RUN)
        later = "a" * 40
        twice = cisummary.mark_fixed(once, later, RUN.replace("38920820201", "38920820999"))
        assert twice.count("**Fixed:**") == 1
        assert "`aaaaaaa`" in twice and "`03c44ac`" not in twice
        assert twice.split("**Fixed:**", 1)[1].count("### CI failed") == 1

    @pytest.mark.parametrize(
        "sha", ["", "xyz1234", "abc12", "A" * 40, "a" * 41, None, 7, "abc1234\n`x`"]
    )
    def test_a_sha_that_is_not_one_is_refused(self, sha):
        assert cisummary.mark_fixed(BODY, sha, RUN) is None

    @pytest.mark.parametrize(
        "url",
        ["", "http://github.com/x", "javascript:alert(1)", "https://x/y) [z](https://e", None],
    )
    def test_a_url_that_could_break_the_link_is_refused(self, url):
        assert cisummary.mark_fixed(BODY, SHA, url) is None

    @pytest.mark.parametrize(
        "body", ["", "### CI failed", "<!-- fanwire-coverage -->\nx", None, f" {BODY}"]
    )
    def test_a_body_that_is_not_the_summary_is_left_alone(self, body):
        assert cisummary.mark_fixed(body, SHA, RUN) is None


@pytest.fixture
def fixed():
    spec = importlib.util.spec_from_file_location("ci_summary_fixed_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(fixed, tmp_path, body=BODY, sha=SHA, url=RUN):
    old = tmp_path / "old.md"
    new = tmp_path / "new.md"
    if body is not None:
        old.write_text(body, encoding="utf-8")
    argv = ["--body-in", str(old), "--head-sha", sha, "--run-url", url, "--comment-out", str(new)]
    return fixed.main(argv), new


class TestTheScript:
    def test_it_writes_the_marked_body(self, fixed, tmp_path):
        code, new = run(fixed, tmp_path)
        assert code == fixed.OK
        assert new.read_text(encoding="utf-8").split("\n")[1].startswith("**Fixed:**")

    def test_nothing_to_mark_writes_nothing_and_says_so(self, fixed, tmp_path):
        stale = tmp_path / "new.md"
        stale.write_text("left from before", encoding="utf-8")
        code, new = run(fixed, tmp_path, body="not the summary")
        assert code == fixed.NOTHING
        assert not new.exists()

    def test_a_missing_body_file_is_a_usage_error(self, fixed, tmp_path):
        code, new = run(fixed, tmp_path, body=None)
        assert code == fixed.USAGE and not new.exists()

    def test_it_makes_no_request(self, fixed, tmp_path, monkeypatch):
        import urllib.request

        def refuse(*a, **k):
            raise AssertionError("ci_summary_fixed.py must make no request")

        monkeypatch.setattr(urllib.request, "urlopen", refuse)
        code, _ = run(fixed, tmp_path)
        assert code == fixed.OK
