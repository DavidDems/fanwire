"""Telemetry: append-only, immutable, and never LLM-generated."""

import json

import pytest

from agentlib import telemetry as tm


def record(**over):
    r = {
        "task_id": "DEMO-001",
        "workflow_run_id": "1234567890",
        "role": "code_agent",
        "provider": "anthropic",
        "model": "claude-opus-5",
        "session_id": "sess-abc",
        "attempt": 2,
        "started_at": "2026-09-20T10:00:00Z",
        "ended_at": "2026-09-20T10:04:30Z",
        "input_tokens": 12000,
        "output_tokens": 3000,
        "result": "committed",
        "commit_sha": "deadbeef",
        "ci_run_id": "999",
    }
    r.update(over)
    return r


class TestRecord:
    def test_writes_one_file_per_invocation(self, tmp_path):
        p = tm.record(tmp_path, record())
        assert p.exists()
        assert p.parent.name == "DEMO-001"
        data = json.loads(p.read_text(encoding="utf-8"))
        assert data["role"] == "code_agent"

    def test_total_tokens_are_derived_not_trusted(self, tmp_path):
        p = tm.record(tmp_path, record(total_tokens=1))
        assert json.loads(p.read_text(encoding="utf-8"))["total_tokens"] == 15000

    def test_cost_is_computed_when_a_price_is_known(self, tmp_path):
        prices = {"anthropic/claude-opus-5": {"input_per_mtok": 15.0, "output_per_mtok": 75.0}}
        p = tm.record(tmp_path, record(), prices=prices)
        data = json.loads(p.read_text(encoding="utf-8"))
        assert data["estimated_cost_usd"] == pytest.approx(12000 / 1e6 * 15 + 3000 / 1e6 * 75)

    def test_cost_is_null_rather_than_guessed_for_an_unpriced_model(self, tmp_path):
        p = tm.record(tmp_path, record(model="some-new-model"), prices={})
        assert json.loads(p.read_text(encoding="utf-8"))["estimated_cost_usd"] is None

    def test_duration_is_derived(self, tmp_path):
        p = tm.record(tmp_path, record())
        assert json.loads(p.read_text(encoding="utf-8"))["duration_seconds"] == 270

    def test_a_missing_required_field_is_rejected(self, tmp_path):
        bad = record()
        del bad["role"]
        with pytest.raises(tm.TelemetryError, match="role"):
            tm.record(tmp_path, bad)

    def test_an_unknown_role_is_rejected(self, tmp_path):
        with pytest.raises(tm.TelemetryError, match="role"):
            tm.record(tmp_path, record(role="shadow_agent"))

    def test_history_is_immutable(self, tmp_path):
        p = tm.record(tmp_path, record())
        with pytest.raises(tm.TelemetryError, match="exists"):
            tm.record(tmp_path, record(), filename=p.name)


class TestAggregate:
    def test_rolls_up_per_task_and_per_role(self, tmp_path):
        tm.record(tmp_path, record(role="test_agent", input_tokens=1000, output_tokens=500))
        tm.record(tmp_path, record(role="code_agent", input_tokens=2000, output_tokens=1000))
        tm.record(
            tmp_path,
            record(task_id="OTHER-002", role="distiller", input_tokens=300, output_tokens=100),
        )
        summary = tm.aggregate(tmp_path)
        assert summary["totals"]["total_tokens"] == 4900
        assert summary["by_task"]["DEMO-001"]["total_tokens"] == 4500
        assert summary["by_role"]["distiller"]["total_tokens"] == 400
        assert summary["by_model"]["claude-opus-5"]["invocations"] == 3

    def test_counts_attempts_and_escalations(self, tmp_path):
        tm.record(tmp_path, record(attempt=1, result="committed"))
        tm.record(tmp_path, record(attempt=2, result="committed"))
        tm.record(tmp_path, record(role="manager", attempt=2, result="escalated"))
        summary = tm.aggregate(tmp_path)
        assert summary["by_task"]["DEMO-001"]["attempts"] == 2
        assert summary["totals"]["escalations"] == 1

    def test_an_empty_store_aggregates_to_zeroes_not_an_error(self, tmp_path):
        summary = tm.aggregate(tmp_path)
        assert summary["totals"]["total_tokens"] == 0
        assert summary["by_task"] == {}

    def test_a_corrupt_record_is_reported_not_silently_dropped(self, tmp_path):
        (tmp_path / "DEMO-001").mkdir()
        (tmp_path / "DEMO-001" / "broken.json").write_text("{not json", encoding="utf-8")
        summary = tm.aggregate(tmp_path)
        assert summary["unreadable"] == ["DEMO-001/broken.json"]
