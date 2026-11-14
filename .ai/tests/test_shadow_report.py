"""`agentctl shadow report`: the record of jev's answers beside Haiku's.

Prompts/04 "Decided by the human", 2026-10-13: each automation's yes/no
question is asked of `jev` in shadow, and the pair is kept as hidden JSON in
the automation's own PR comment (`agentlib/shadow.py`). This report collects
them from the repository's issue comments, as `gh api` returns them, so that
whether `jev` is worth keeping is decided from a record and not from memory.

What it must keep:
  - offline and stdlib only: it reads a file (or stdin) that `gh api` wrote,
    and calls nothing itself.
  - only the bot's own comments count: a record pasted into a person's
    comment is not one of the automation's, and is ignored.
  - one row per automation per PR: a comment updated in place holds one
    record, and if a PR somehow has two for one automation the later wins.
  - a malformed record, comment or file never stops the report.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

AI_ROOT = Path(__file__).resolve().parents[1]
from agentlib import shadow

AGENTCTL = AI_ROOT / "bin" / "agentctl.py"
BOT = "github-actions[bot]"


def coverage(pr, *, all_pinned=True, choice="no", confidence=0.36, task="POSTS-001"):
    return {
        "agree": (choice == "yes") == all_pinned,
        "automation": "coverage",
        "haiku": {"all_pinned": all_pinned, "cost_usd": 0.0035, "model": "claude-haiku-5-5"},
        "jev": {
            "choice": choice,
            "confidence": confidence,
            "cost_usd": 0.0007,
            "model": "jev-1.13.0",
        },
        "pr": pr,
        "task": task,
    }


def drift(pr, *, matches=True, choice="no", confidence=0.6, task="EVENTS-006"):
    return {
        "agree": (choice == "yes") == matches,
        "automation": "spec_drift",
        "haiku": {"matches": matches, "cost_usd": 0.0073, "model": "claude-haiku-5-5"},
        "jev": {
            "choice": choice,
            "confidence": confidence,
            "cost_usd": 0.0009,
            "model": "jev-1.13.0",
        },
        "pr": pr,
        "task": task,
    }


def comment(record, *, login=BOT, updated="2026-10-15T19:00:00Z", heading="### Criteria coverage"):
    body = f"<!-- fanwire-coverage -->\n{heading}\n\ntext\n{shadow.encode(record)}\n"
    return {"user": {"login": login}, "body": body, "updated_at": updated}


class TestReadingWhatGhWrote:
    def test_one_array(self):
        page = [comment(coverage(161))]
        assert shadow.load_comments(json.dumps(page)) == page

    def test_paginate_writes_one_array_per_page_back_to_back(self):
        """`gh api --paginate` without `--slurp` prints `[...][...]`."""
        a, b = [comment(coverage(161))], [comment(drift(159))]
        assert shadow.load_comments(json.dumps(a) + "\n" + json.dumps(b)) == a + b

    def test_slurp_writes_an_array_of_pages(self):
        a, b = [comment(coverage(161))], [comment(drift(159))]
        assert shadow.load_comments(json.dumps([a, b])) == a + b

    @pytest.mark.parametrize("text", ["", "not json", '{"message": "Not Found"}', "[1, 2]"])
    def test_anything_else_is_no_comments(self, text):
        assert shadow.load_comments(text) == []


class TestCollectingTheRecords:
    def test_only_the_bots_own_comments_count(self):
        comments = [comment(coverage(161)), comment(coverage(162), login="someone")]
        assert [r["pr"] for r in shadow.collect(comments)] == [161]

    def test_one_record_per_automation_per_pr_the_later_wins(self):
        early = comment(coverage(161, confidence=0.1), updated="2026-10-15T01:00:00Z")
        late = comment(coverage(161, confidence=0.9), updated="2026-10-15T02:00:00Z")
        records = shadow.collect([late, early])
        assert len(records) == 1 and records[0]["jev"]["confidence"] == 0.9

    def test_two_automations_on_one_pr_are_two_records(self):
        records = shadow.collect([comment(coverage(161)), comment(drift(161))])
        assert sorted(r["automation"] for r in records) == ["coverage", "spec_drift"]

    @pytest.mark.parametrize(
        "bad", [None, "x", {"user": None, "body": "x"}, {"user": {"login": BOT}, "body": 3}]
    )
    def test_a_malformed_comment_is_skipped(self, bad):
        assert [r["pr"] for r in shadow.collect([bad, comment(coverage(161))])] == [161]

    def test_a_record_without_an_automation_or_a_pr_is_skipped(self):
        assert shadow.collect([comment({"automation": "coverage"}), comment({"pr": 3})]) == []


class TestTheVerdicts:
    @pytest.mark.parametrize(
        "record,expected",
        [
            (coverage(1, all_pinned=True), "yes"),
            (coverage(1, all_pinned=False), "no"),
            (drift(1, matches=True), "yes"),
            (drift(1, matches=False), "no"),
            ({"automation": "coverage", "haiku": {}}, None),
            ({"automation": "unknown", "haiku": {"all_pinned": True}}, None),
        ],
    )
    def test_haikus_answer_as_jevs_yes_or_no(self, record, expected):
        assert shadow.haiku_answer(record) == expected


class TestTheSummary:
    RECORDS = [
        coverage(159, confidence=0.10),
        coverage(161, confidence=0.36),
        coverage(162, all_pinned=True, choice="yes", confidence=0.80),
        drift(159, confidence=0.60),
    ]

    def test_counts_per_automation(self):
        s = shadow.summarize(self.RECORDS)
        cov = s["by_automation"]["coverage"]
        assert cov["records"] == 3 and cov["agree"] == 1 and cov["disagree"] == 2
        assert cov["jev"] == {"yes": 1, "no": 2, "none": 0}
        assert cov["haiku"] == {"yes": 3, "no": 0, "none": 0}
        assert cov["mean_confidence"] == pytest.approx((0.10 + 0.36 + 0.80) / 3)
        assert cov["haiku_cost_usd"] == pytest.approx(3 * 0.0035)
        assert cov["jev_cost_usd"] == pytest.approx(3 * 0.0007)
        assert s["totals"]["records"] == 4 and s["totals"]["agree"] == 1

    def test_a_jev_that_gave_no_answer_is_counted_not_dropped(self):
        record = coverage(170)
        record["jev"] = None
        record["agree"] = None
        s = shadow.summarize([record])
        cov = s["by_automation"]["coverage"]
        assert cov["records"] == 1 and cov["jev"]["none"] == 1
        assert cov["agree"] == 0 and cov["disagree"] == 0 and cov["mean_confidence"] is None

    def test_rows_are_in_pr_order(self):
        s = shadow.summarize(list(reversed(self.RECORDS)))
        assert [(r["pr"], r["automation"]) for r in s["rows"]] == [
            (159, "coverage"),
            (159, "spec_drift"),
            (161, "coverage"),
            (162, "coverage"),
        ]

    def test_empty_is_a_summary_of_nothing(self):
        s = shadow.summarize([])
        assert s["totals"]["records"] == 0 and s["by_automation"] == {} and s["rows"] == []


def agentctl(*args, stdin=None):
    return subprocess.run(
        [sys.executable, str(AGENTCTL), "shadow", "report", *args],
        input=stdin,
        capture_output=True,
        check=False,
        text=True,
        timeout=60,
    )


class TestTheCommand:
    COMMENTS = [comment(coverage(161)), comment(drift(159)), comment(coverage(162), login="x")]

    def test_it_prints_a_row_per_record_and_a_line_per_automation(self, tmp_path):
        path = tmp_path / "comments.json"
        path.write_text(json.dumps(self.COMMENTS), encoding="utf-8")
        proc = agentctl("--comments", str(path))
        assert proc.returncode == 0, proc.stderr
        out = proc.stdout
        assert "#161" in out and "POSTS-001" in out and "#159" in out
        assert "#162" not in out
        assert "coverage" in out and "spec_drift" in out
        assert "disagree" in out

    def test_json_is_the_summary(self, tmp_path):
        path = tmp_path / "comments.json"
        path.write_text(json.dumps(self.COMMENTS), encoding="utf-8")
        proc = agentctl("--comments", str(path), "--json")
        assert proc.returncode == 0, proc.stderr
        data = json.loads(proc.stdout)
        assert data["totals"]["records"] == 2
        assert set(data["by_automation"]) == {"coverage", "spec_drift"}

    def test_it_reads_stdin_with_a_dash(self):
        proc = agentctl("--comments", "-", "--json", stdin=json.dumps(self.COMMENTS))
        assert proc.returncode == 0, proc.stderr
        assert json.loads(proc.stdout)["totals"]["records"] == 2

    def test_a_missing_file_is_a_usage_error(self, tmp_path):
        proc = agentctl("--comments", str(tmp_path / "nope.json"))
        assert proc.returncode == 2
        assert "nope.json" in proc.stderr
